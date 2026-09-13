import { weatherConfiguration } from "./weather.js";

const radiusKm = Number(process.env.EVENT_SEARCH_RADIUS_KM ?? "5");

if (!Number.isFinite(radiusKm) || radiusKm <= 0 || radiusKm > 100) {
  throw new Error(
    "EVENT_SEARCH_RADIUS_KM must be greater than 0 and at most 100.",
  );
}

export const eventConfiguration = {
  latitude: weatherConfiguration.latitude,
  longitude: weatherConfiguration.longitude,
  radiusKm,
  forecastDays: 14,
  cacheDurationMilliseconds: 6 * 60 * 60 * 1000,
  pageSize: 50,
  maximumPages: 3,
};
