/**
 * Weather configuration for the configured restaurant.
 */

import { restaurant } from "./restaurant.js";

function readCoordinate(name, minimum, maximum) {
  const text = process.env[name];

  if (
    typeof text !== "string" ||
    text.trim() === "" ||
    !/^[+-]?\d+(?:\.\d+)?$/.test(text.trim())
  ) {
    throw new Error(`${name} must be a decimal coordinate.`);
  }

  const value = Number(text);

  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}.`);
  }

  return value;
}

const latitude = readCoordinate("RESTAURANT_LATITUDE", -90, 90);
const longitude = readCoordinate("RESTAURANT_LONGITUDE", -180, 180);

export const weatherConfiguration = Object.freeze({
  latitude,
  longitude,
  timezone: restaurant.timezone,
  locationKey: `${latitude},${longitude}`,
  forecastDays: 14,
  cacheDurationMilliseconds: 3 * 60 * 60 * 1000,
});
