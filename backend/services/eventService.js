import mongoose from "mongoose";
import { createHash } from "node:crypto";
import { restaurant } from "../config/restaurant.js";
import { eventConfiguration as config } from "../config/events.js";
import { LocalEvent } from "../models/index.js";
import { ExternalContextCache } from "../models/supporting/index.js";
import {
  getBusinessDate,
  addBusinessDays,
  requireBusinessDate,
} from "../utils/businessDate.js";

export class EventRefreshError extends Error {
  constructor(message) {
    super(message);
    this.name = "EventRefreshError";
  }
}

const locationKey = `${config.latitude},${config.longitude}:${config.radiusKm}km`;

const cacheKey = `ticketmaster:events-v1:${locationKey}:${restaurant.timezone}`;

function encodeGeohash(latitude, longitude, precision = 9) {
  const alphabet = "0123456789bcdefghjkmnpqrstuvwxyz";
  const latitudeRange = [-90, 90];
  const longitudeRange = [-180, 180];

  let result = "";
  let longitudeBit = true;
  let value = 0;
  let bits = 0;

  while (result.length < precision) {
    const range = longitudeBit ? longitudeRange : latitudeRange;
    const coordinate = longitudeBit ? longitude : latitude;
    const midpoint = (range[0] + range[1]) / 2;
    const bit = coordinate >= midpoint ? 1 : 0;

    value = value * 2 + bit;
    range[bit ? 0 : 1] = midpoint;
    longitudeBit = !longitudeBit;
    bits += 1;

    if (bits === 5) {
      result += alphabet[value];
      value = 0;
      bits = 0;
    }
  }

  return result;
}

function distanceKm(latitude, longitude) {
  const radians = (degrees) => (degrees * Math.PI) / 180;
  const latitudeDifference = radians(latitude - config.latitude);
  const longitudeDifference = radians(longitude - config.longitude);

  const a =
    Math.sin(latitudeDifference / 2) ** 2 +
    Math.cos(radians(config.latitude)) *
      Math.cos(radians(latitude)) *
      Math.sin(longitudeDifference / 2) ** 2;

  return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, a))));
}

async function fetchPage(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(15000),
    redirect: "error",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Provider returned HTTP ${response.status}.`);
  }

  if (!response.body) {
    throw new Error("Provider returned an empty response.");
  }

  const chunks = [];
  let bytes = 0;

  for await (const chunk of response.body) {
    bytes += chunk.length;

    if (bytes > 2 * 1024 * 1024) {
      throw new Error("Provider response exceeded the size limit.");
    }

    chunks.push(Buffer.from(chunk));
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function normalizeEvent(event, firstDate, lastDate) {
  const start = event.dates?.start;

  if (
    typeof event.id !== "string" ||
    !event.id.trim() ||
    typeof event.name !== "string" ||
    !event.name.trim() ||
    !start ||
    start.dateTBA ||
    start.dateTBD ||
    ["cancelled", "postponed"].includes(event.dates?.status?.code)
  ) {
    return null;
  }

  // Nearby Victorian venues use Melbourne local dates and times.
  if (event.dates?.timezone !== restaurant.timezone) {
    return null;
  }

  let date;

  try {
    date = requireBusinessDate(start.localDate);
  } catch {
    return null;
  }

  if (date < firstDate || date > lastDate) {
    return null;
  }

  const venues = event._embedded?.venues;

  if (!Array.isArray(venues)) {
    return null;
  }

  const candidates = venues.flatMap((venue) => {
    const rawLatitude = venue.location?.latitude;
    const rawLongitude = venue.location?.longitude;

    if (
      rawLatitude == null ||
      rawLongitude == null ||
      String(rawLatitude).trim() === "" ||
      String(rawLongitude).trim() === ""
    ) {
      return [];
    }

    const latitude = Number(rawLatitude);
    const longitude = Number(rawLongitude);

    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      Math.abs(latitude) > 90 ||
      Math.abs(longitude) > 180
    ) {
      return [];
    }

    return [{ venue, distance: distanceKm(latitude, longitude) }];
  });

  candidates.sort((a, b) => a.distance - b.distance);

  const closest = candidates[0];

  if (!closest || closest.distance > config.radiusKm) {
    return null;
  }

  const time =
    !start.timeTBA &&
    !start.noSpecificTime &&
    typeof start.localTime === "string" &&
    /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(start.localTime)
      ? start.localTime
      : null;

  const classification =
    event.classifications?.find((item) => item.primary) ??
    event.classifications?.[0];

  return {
    event_id: `TM-${event.id}`,
    event_date: date,
    event_type: classification?.segment?.name ?? null,
    event_name: event.name.trim(),
    venue_name: closest.venue.name ?? null,
    start_time: time,
    end_time: null,
    service_period_impacted: null,
    distance_from_restaurant_km: closest.distance.toFixed(3),
    estimated_attendance: null,
    demand_relevance_score: null,
    is_synthetic: false,
  };
}

export async function getSavedEvents() {
  const today = getBusinessDate(restaurant.timezone);
  const cache = await ExternalContextCache.findOne({
    cache_key: cacheKey,
    chunk_number: 0,
  }).lean();

  return {
    configured: Boolean(process.env.TICKETMASTER_API_KEY?.trim()),
    available: Boolean(cache),
    stale:
      !cache ||
      new Date(cache.fresh_until).getTime() <= Date.now() ||
      cache.source_date_start !== today,
    retrievedAt: cache?.retrieved_at ?? null,
    dateStart: cache?.source_date_start ?? null,
    dateEnd: cache?.source_date_end ?? null,
    radiusKm: config.radiusKm,
    truncated: cache?.payload?.truncated ?? false,
    fetchedCount: cache?.payload?.fetchedCount ?? 0,
    excludedCount: cache?.payload?.excludedCount ?? 0,
    events: cache?.payload?.events ?? [],
  };
}

export async function refreshEvents() {
  const apiKey = process.env.TICKETMASTER_API_KEY?.trim();

  if (!apiKey) {
    throw new EventRefreshError(
      "Add TICKETMASTER_API_KEY to .env and restart the server.",
    );
  }

  const saved = await getSavedEvents();

  if (saved.available && !saved.stale) {
    return saved;
  }

  const requestedAt = new Date();
  const firstDate = getBusinessDate(restaurant.timezone, requestedAt);
  const lastDate = addBusinessDays(firstDate, config.forecastDays - 1);

  const parameters = {
    countryCode: "AU",
    geoPoint: encodeGeohash(config.latitude, config.longitude),
    radius: String(config.radiusKm),
    unit: "km",
    localStartDateTime: `${firstDate}T00:00:00,${lastDate}T23:59:59`,
    includeTBA: "no",
    includeTBD: "no",
    includeTest: "no",
    sort: "date,asc",
    size: String(config.pageSize),
  };

  try {
    const records = new Map();
    let fetchedCount = 0;
    let excludedCount = 0;
    let truncated = false;

    for (let page = 0; page < config.maximumPages; page += 1) {
      const url = new URL(
        "https://app.ticketmaster.com/discovery/v2/events.json",
      );

      url.search = new URLSearchParams({
        ...parameters,
        page: String(page),
        apikey: apiKey,
      }).toString();

      const payload = await fetchPage(url);
      const totalPages = payload.page?.totalPages;
      const totalElements = payload.page?.totalElements;
      const events = payload._embedded?.events ?? [];

      if (
        !Number.isSafeInteger(totalPages) ||
        totalPages < 0 ||
        !Number.isSafeInteger(totalElements) ||
        totalElements < 0 ||
        !Array.isArray(events) ||
        events.length > config.pageSize ||
        (totalElements > 0 && events.length === 0)
      ) {
        throw new Error("Unexpected provider response.");
      }

      for (const event of events) {
        fetchedCount += 1;
        const normalized = normalizeEvent(event, firstDate, lastDate);

        if (normalized) {
          records.set(normalized.event_id, normalized);
        } else {
          excludedCount += 1;
        }
      }

      truncated = totalPages > page + 1;

      if (!truncated) {
        break;
      }

      // Keep sequential requests below the provider's default rate limit.
      if (page + 1 < config.maximumPages) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }

    const events = [...records.values()].sort(
      (a, b) =>
        a.event_date.localeCompare(b.event_date) ||
        (a.start_time ?? "").localeCompare(b.start_time ?? "") ||
        a.event_name.localeCompare(b.event_name),
    );

    await mongoose.connection.transaction(async (session) => {
      const current = await ExternalContextCache.findOne({
        cache_key: cacheKey,
        chunk_number: 0,
      }).session(session);

      if (
        current &&
        new Date(current.retrieved_at).getTime() >= requestedAt.getTime()
      ) {
        return;
      }

      for (const event of events) {
        await LocalEvent.updateOne(
          { event_id: event.event_id },
          { $set: event },
          { upsert: true, runValidators: true, session },
        );
      }

      await ExternalContextCache.findOneAndUpdate(
        { cache_key: cacheKey, chunk_number: 0 },
        {
          $set: {
            schema_version: 1,
            provider: "ticketmaster",
            context_type: "local_events",
            location_key: locationKey,
            request_hash: createHash("sha256")
              .update(JSON.stringify(parameters))
              .digest("hex"),
            retrieved_at: requestedAt,
            fresh_until: new Date(
              requestedAt.getTime() + config.cacheDurationMilliseconds,
            ),
            source_date_start: firstDate,
            source_date_end: lastDate,
            payload: {
              events,
              fetchedCount,
              excludedCount,
              truncated,
            },
          },
        },
        { upsert: true, runValidators: true, session },
      );
    });

    return await getSavedEvents();
  } catch {
    throw new EventRefreshError(
      "Events could not be refreshed. Check your API key and connection. " +
        "Previously saved results have been retained.",
    );
  }
}
