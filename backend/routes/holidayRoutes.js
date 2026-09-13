/**
 * Public-holiday page, refresh action and JSON endpoint.
 */

import express from "express";
import { restaurant } from "../config/restaurant.js";
import { selectAllowedFields } from "../utils/requestValidation.js";
import {
  readHolidayYear,
  getSavedHolidays,
  refreshHolidays,
  HolidayRefreshError,
} from "../services/holidayService.js";

const router = express.Router();

function readYearFromRequest(request) {
  const query = selectAllowedFields(request.query, ["year"]);
  return readHolidayYear(query.year);
}

async function renderHolidays(response, year, errorMessage = null) {
  const saved = await getSavedHolidays(year);

  return response.render("holidays/index", {
    pageTitle: "Victorian public holidays",
    ...saved,
    errorMessage,
    retrievedLabel: saved.retrievedAt
      ? new Intl.DateTimeFormat("en-AU", {
          timeZone: restaurant.timezone,
          dateStyle: "medium",
          timeStyle: "short",
        }).format(new Date(saved.retrievedAt))
      : null,
  });
}

router.use((request, response, next) => {
  response.set("Cache-Control", "no-store");
  next();
});

router.get("/", async (request, response) => {
  return renderHolidays(response, readYearFromRequest(request));
});

router.post("/refresh", async (request, response) => {
  const year = readYearFromRequest(request);

  try {
    await refreshHolidays(year);
    return response.redirect(303, `/holidays?year=${year}`);
  } catch (error) {
    if (!(error instanceof HolidayRefreshError)) {
      throw error;
    }

    response.status(502);
    return renderHolidays(response, year, error.message);
  }
});

export async function showHolidaysJson(request, response) {
  const year = readYearFromRequest(request);

  response.set("Cache-Control", "no-store");
  response.json(await getSavedHolidays(year));
}

export default router;
