/**
 * Fetches and caches Victorian public holidays by year.
 *
 * Provider data is planning context. Local exceptions and school
 * holidays require separate verified rules.
 */

import mongoose from "mongoose";
import { createHash } from "node:crypto";
import { restaurant } from "../config/restaurant.js";
import { ExternalContextCache } from "../models/supporting/index.js";
import { getBusinessDate, requireBusinessDate } from "../utils/businessDate.js";
import { RequestValidationError } from "../utils/requestValidation.js";

const subdivision = "AU-VIC";
const cacheDurationMilliseconds = 24 * 60 * 60 * 1000;

export class HolidayRefreshError extends Error {
  constructor() {
    super(
      "Holiday refresh failed. Previously saved holidays have been preserved.",
    );
    this.name = "HolidayRefreshError";
  }
}

/**
 * Reads an optional year, defaulting to the restaurant's current year.
 */
export function readHolidayYear(value) {
  if (value === undefined) {
    return Number(getBusinessDate(restaurant.timezone).slice(0, 4));
  }

  if (
    typeof value !== "string" ||
    !/^\d{4}$/.test(value) ||
    Number(value) < 2000 ||
    Number(value) > 2100
  ) {
    throw new RequestValidationError(
      "year must be a four-digit year between 2000 and 2100.",
    );
  }

  return Number(value);
}

function getCacheKey(year) {
  return `nager:public-holidays-v1:${subdivision}:${year}`;
}

/**
 * Reads a bounded provider response.
 */
async function fetchHolidayData(url) {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15000),
    redirect: "error",
  });

  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error("Holiday provider request failed.");
  }

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      totalBytes += value.byteLength;

      if (totalBytes > 256 * 1024) {
        await reader.cancel();
        throw new Error("Holiday response exceeds the size limit.");
      }

      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/**
 * Validates the provider response and selects Victorian public holidays.
 */
export function normalizeVictorianHolidays(payload, year) {
  if (!Array.isArray(payload) || payload.length === 0 || payload.length > 500) {
    throw new Error("Invalid holiday response.");
  }

  const holidays = new Map();

  for (const entry of payload) {
    if (
      !entry ||
      typeof entry !== "object" ||
      entry.countryCode !== "AU" ||
      typeof entry.global !== "boolean" ||
      typeof entry.name !== "string" ||
      entry.name.trim() === "" ||
      entry.name.length > 300 ||
      !Array.isArray(entry.types) ||
      !entry.types.every((type) => typeof type === "string") ||
      (entry.counties !== null &&
        (!Array.isArray(entry.counties) ||
          !entry.counties.every((county) => typeof county === "string")))
    ) {
      throw new Error("Unexpected holiday record structure.");
    }

    const date = requireBusinessDate(entry.date, "holiday date");

    if (!date.startsWith(`${year}-`)) {
      throw new Error("Holiday date is outside the requested year.");
    }

    const appliesToVictoria =
      entry.global || entry.counties?.includes(subdivision);

    if (!appliesToVictoria || !entry.types.includes("Public")) {
      continue;
    }

    const name = entry.name.trim();

    holidays.set(`${date}:${name}`, {
      date,
      name,
      scope: entry.global ? "National" : "Victoria",
    });
  }

  if (holidays.size === 0) {
    throw new Error("No Victorian public holidays were returned.");
  }

  return [...holidays.values()].sort(
    (left, right) =>
      left.date.localeCompare(right.date) ||
      left.name.localeCompare(right.name),
  );
}

/**
 * Reads persisted holidays without calling the provider.
 */
export async function getSavedHolidays(year) {
  const cache = await ExternalContextCache.findOne({
    cache_key: getCacheKey(year),
    chunk_number: 0,
  }).lean();

  return {
    year,
    holidays: cache?.payload?.holidays || [],
    available: Boolean(cache),
    stale: Boolean(
      cache && new Date(cache.fresh_until).getTime() <= Date.now(),
    ),
    retrievedAt: cache?.retrieved_at ?? null,
  };
}

/**
 * Reuses fresh data or stores a newly validated yearly response.
 */
export async function refreshHolidays(year) {
  if (process.env.RESTAURANT_STATE !== "VIC") {
    throw new RequestValidationError(
      "This holiday integration requires RESTAURANT_STATE=VIC.",
    );
  }

  try {
    const existing = await getSavedHolidays(year);

    if (existing.available && !existing.stale) {
      return { reused: true };
    }

    const url = `https://nagerholidays.com/api/v3/publicholidays/${year}/AU`;

    const requestedAt = new Date();
    const payload = await fetchHolidayData(url);
    const holidays = normalizeVictorianHolidays(payload, year);

    await mongoose.connection.transaction(async (session) => {
      const current = await ExternalContextCache.findOne({
        cache_key: getCacheKey(year),
        chunk_number: 0,
      }).session(session);

      if (current && current.retrieved_at >= requestedAt) {
        return;
      }

      const document = current || new ExternalContextCache();

      document.set({
        cache_key: getCacheKey(year),
        chunk_number: 0,
        schema_version: 1,
        provider: "nager",
        context_type: "public_holidays",
        location_key: subdivision,
        request_hash: createHash("sha256").update(url).digest("hex"),
        retrieved_at: requestedAt,
        fresh_until: new Date(
          requestedAt.getTime() + cacheDurationMilliseconds,
        ),
        source_date_start: `${year}-01-01`,
        source_date_end: `${year}-12-31`,
        payload: {
          raw: payload,
          holidays,
        },
      });

      await document.save({ session });
    });

    return { reused: false };
  } catch {
    throw new HolidayRefreshError();
  }
}

/**
 * Provides date-specific context for the later feature service.
 *
 * Missing or stale context returns null, not a false holiday flag.
 * This is the provider's classification, pending local-rule verification.
 */
export async function getPublicHolidayContext(date) {
  requireBusinessDate(date);

  const saved = await getSavedHolidays(Number(date.slice(0, 4)));
  const matches = saved.holidays.filter((holiday) => holiday.date === date);
  const usable = saved.available && !saved.stale;

  return {
    date,
    is_public_holiday: usable ? matches.length > 0 : null,
    holiday_names: matches.map((holiday) => holiday.name),
    provider: "nager",
    available: saved.available,
    stale: saved.stale,
    retrieved_at: saved.retrievedAt,
  };
}
