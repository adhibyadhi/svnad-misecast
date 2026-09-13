/**
 * Fetches, validates and caches daily Open-Meteo forecasts.
 *
 * Only forecast weather records are updated.
 * Historical actual records remain separate.
 */

import mongoose from "mongoose";
import { createHash } from "node:crypto";
import { Weather } from "../models/index.js";
import { ExternalContextCache } from "../models/supporting/index.js";
import { weatherConfiguration as configuration } from "../config/weather.js";
import { getBusinessDate, addBusinessDays } from "../utils/businessDate.js";

const cacheKey = `open-meteo:daily-v1:${configuration.locationKey}:${configuration.timezone}`;

const dailyVariables = [
  "temperature_2m_min",
  "temperature_2m_max",
  "temperature_2m_mean",
  "precipitation_probability_max",
  "rain_sum",
  "showers_sum",
  "weather_code",
];

// Provider-code labels for display, not verified ML category mappings.
const conditionLabels = new Map([
  [0, "Clear sky"],
  [1, "Mainly clear"],
  [2, "Partly cloudy"],
  [3, "Overcast"],
  [45, "Fog"],
  [48, "Depositing rime fog"],
  [51, "Light drizzle"],
  [53, "Moderate drizzle"],
  [55, "Dense drizzle"],
  [56, "Light freezing drizzle"],
  [57, "Dense freezing drizzle"],
  [61, "Slight rain"],
  [63, "Moderate rain"],
  [65, "Heavy rain"],
  [66, "Light freezing rain"],
  [67, "Heavy freezing rain"],
  [71, "Slight snowfall"],
  [73, "Moderate snowfall"],
  [75, "Heavy snowfall"],
  [77, "Snow grains"],
  [80, "Slight rain showers"],
  [81, "Moderate rain showers"],
  [82, "Violent rain showers"],
  [85, "Slight snow showers"],
  [86, "Heavy snow showers"],
  [95, "Thunderstorm"],
  [96, "Thunderstorm with slight hail"],
  [99, "Thunderstorm with heavy hail"],
]);

export class WeatherRefreshError extends Error {
  constructor() {
    super(
      "Weather could not be refreshed. Previously saved data has been preserved.",
    );
    this.name = "WeatherRefreshError";
  }
}

/**
 * Reads a nullable finite provider number.
 */
function readNumber(value) {
  if (value === null) {
    return null;
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("Invalid weather number.");
  }

  return value;
}

function decimalString(value) {
  return value === null ? null : String(value);
}

/**
 * Fetches a bounded JSON response with a timeout.
 */
async function fetchForecast(url) {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15000),
    redirect: "error",
  });

  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error("Weather provider request failed.");
  }

  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      bytes += value.byteLength;

      if (bytes > 256 * 1024) {
        await reader.cancel();
        throw new Error("Weather response is too large.");
      }

      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/**
 * Validates all dates, arrays and mapped schema values before persistence.
 */
async function normalizeForecast(payload, today) {
  const daily = payload.daily;

  if (
    payload.error ||
    !daily ||
    !Array.isArray(daily.time) ||
    daily.time.length !== configuration.forecastDays
  ) {
    throw new Error("Incomplete daily forecast.");
  }

  for (const variable of dailyVariables) {
    if (
      !Array.isArray(daily[variable]) ||
      daily[variable].length !== daily.time.length
    ) {
      throw new Error("Weather arrays have inconsistent lengths.");
    }
  }

  const units = payload.daily_units;

  if (
    units?.temperature_2m_min !== "°C" ||
    units?.temperature_2m_max !== "°C" ||
    units?.temperature_2m_mean !== "°C" ||
    units?.precipitation_probability_max !== "%" ||
    units?.rain_sum !== "mm" ||
    units?.showers_sum !== "mm"
  ) {
    throw new Error("Unexpected weather units.");
  }

  const rows = [];

  for (let index = 0; index < daily.time.length; index += 1) {
    const date = addBusinessDays(today, index);

    if (daily.time[index] !== date) {
      throw new Error(
        "Forecast dates do not match the requested business dates.",
      );
    }

    const minimum = readNumber(daily.temperature_2m_min[index]);
    const maximum = readNumber(daily.temperature_2m_max[index]);
    const average = readNumber(daily.temperature_2m_mean[index]);
    const probability = readNumber(daily.precipitation_probability_max[index]);
    const rain = readNumber(daily.rain_sum[index]);
    const showers = readNumber(daily.showers_sum[index]);
    const code = readNumber(daily.weather_code[index]);

    if (
      (minimum !== null && maximum !== null && minimum > maximum) ||
      (average !== null && minimum !== null && average < minimum) ||
      (average !== null && maximum !== null && average > maximum) ||
      (rain !== null && rain < 0) ||
      (showers !== null && showers < 0) ||
      (code !== null && !Number.isInteger(code))
    ) {
      throw new Error("Inconsistent weather values.");
    }

    // Sum liquid rain and showers. Do not include snowfall water equivalent.
    const rainfall =
      rain === null || showers === null
        ? null
        : String(
            // Provider values are environmental measurements.
            // Round the addition to avoid floating-point display artifacts.
            Math.round((rain + showers) * 1000) / 1000,
          );

    const row = {
      date,
      record_type: "forecast",
      minimum_temperature_c: decimalString(minimum),
      maximum_temperature_c: decimalString(maximum),
      average_temperature_c: decimalString(average),
      rain_probability_pct: decimalString(probability),
      rainfall_mm: rainfall,
      condition:
        code === null
          ? null
          : conditionLabels.get(code) || `Weather code ${code}`,
      is_hot_day: null,
      is_cold_day: null,
      forecast_horizon_days: index,
      location: configuration.locationKey,
      is_synthetic: false,
    };

    await new Weather(row).validate();
    rows.push(row);
  }

  return rows;
}

/**
 * Reads saved weather without making a network request.
 */
export async function getSavedWeather() {
  const cache = await ExternalContextCache.findOne({
    cache_key: cacheKey,
    chunk_number: 0,
  }).lean();

  const today = getBusinessDate(configuration.timezone);

  const rows = (cache?.payload?.rows || []).filter((row) => row.date >= today);

  return {
    rows,
    retrievedAt: cache?.retrieved_at ?? null,
    stale: Boolean(
      cache &&
      (new Date(cache.fresh_until).getTime() <= Date.now() ||
        cache.source_date_start !== today),
    ),
    coordinates: configuration.locationKey,
  };
}

/**
 * Refreshes expired context. Fresh context is reused for three hours.
 *
 * Cache and normalized weather records are committed together.
 */
export async function refreshWeather() {
  try {
    const today = getBusinessDate(configuration.timezone);

    const existing = await ExternalContextCache.findOne({
      cache_key: cacheKey,
      chunk_number: 0,
    }).lean();

    if (
      existing &&
      existing.source_date_start === today &&
      new Date(existing.fresh_until).getTime() > Date.now()
    ) {
      return { reused: true };
    }

    const url = new URL("https://api.open-meteo.com/v1/forecast");

    url.search = new URLSearchParams({
      latitude: String(configuration.latitude),
      longitude: String(configuration.longitude),
      timezone: configuration.timezone,
      forecast_days: String(configuration.forecastDays),
      temperature_unit: "celsius",
      precipitation_unit: "mm",
      daily: dailyVariables.join(","),
    }).toString();

    const requestedAt = new Date();
    const payload = await fetchForecast(url);
    const rows = await normalizeForecast(payload, today);

    if (getBusinessDate(configuration.timezone) !== today) {
      throw new Error("The business date changed during refresh.");
    }

    await mongoose.connection.transaction(async (session) => {
      const current = await ExternalContextCache.findOne({
        cache_key: cacheKey,
        chunk_number: 0,
      }).session(session);

      // Do not overwrite a response from a newer concurrent request.
      if (current && current.retrieved_at >= requestedAt) {
        return;
      }

      const cacheValues = {
        cache_key: cacheKey,
        chunk_number: 0,
        schema_version: 1,
        provider: "open-meteo",
        context_type: "weather_forecast",
        location_key: configuration.locationKey,
        request_hash: createHash("sha256").update(url.href).digest("hex"),
        retrieved_at: requestedAt,
        fresh_until: new Date(
          requestedAt.getTime() + configuration.cacheDurationMilliseconds,
        ),
        source_date_start: rows[0].date,
        source_date_end: rows.at(-1).date,
        payload: { raw: payload, rows },
      };

      const cacheDocument = current || new ExternalContextCache();
      cacheDocument.set(cacheValues);
      await cacheDocument.save({ session });

      for (const row of rows) {
        await Weather.updateOne(
          { date: row.date, record_type: "forecast" },
          { $set: row },
          { upsert: true, runValidators: true, session },
        );
      }
    });

    return { reused: false };
  } catch {
    throw new WeatherRefreshError();
  }
}
