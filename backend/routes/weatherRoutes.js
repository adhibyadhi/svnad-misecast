/**
 * Weather page, refresh action and read-only JSON endpoint.
 */

import express from "express";
import { weatherConfiguration } from "../config/weather.js";
import {
  getSavedWeather,
  refreshWeather,
  WeatherRefreshError,
} from "../services/weatherService.js";

const router = express.Router();

function presentWeather(saved) {
  return {
    ...saved,
    retrievedLabel: saved.retrievedAt
      ? new Intl.DateTimeFormat("en-AU", {
          timeZone: weatherConfiguration.timezone,
          dateStyle: "medium",
          timeStyle: "short",
        }).format(new Date(saved.retrievedAt))
      : null,
  };
}

router.get("/", async (request, response) => {
  const saved = await getSavedWeather();

  response.set("Cache-Control", "no-store");

  response.render("weather/index", {
    pageTitle: "Melbourne weather",
    ...presentWeather(saved),
    errorMessage: null,
  });
});

router.post("/refresh", async (request, response) => {
  try {
    await refreshWeather();
    return response.redirect(303, "/weather");
  } catch (error) {
    if (!(error instanceof WeatherRefreshError)) {
      throw error;
    }

    const saved = await getSavedWeather();

    return response.status(502).render("weather/index", {
      pageTitle: "Melbourne weather",
      ...presentWeather(saved),
      errorMessage: error.message,
    });
  }
});

export default router;

export async function showWeatherJson(request, response) {
  response.set("Cache-Control", "no-store");
  response.json(await getSavedWeather());
}
