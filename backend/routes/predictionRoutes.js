/**
 * What this file does:
 * Handles prediction routes.
 */

import express from "express";

import {
  getWeatherData,
  getHolidayData,
  getEventData,
} from "../utils/externalApis.js";

import {
  parseDate,
  formatDate,
  getTodayDate,
  getMinimumPredictionDate,
  getMaximumPredictionDate,
  getNumberOfDays,
  createDateArray,
} from "../utils/dateHelpers.js";

import { buildMLInputForDate } from "../utils/predictionHelpers.js";

const router = express.Router();

/**
 * Render prediction page.
 */
function renderPredictionPage(res, statusCode = 200, values = {}) {
  return res.status(statusCode).render("prediction", {
    error: values.error ?? null,

    success: values.success ?? null,

    startDate: values.startDate ?? "",

    endDate: values.endDate ?? "",

    dates: values.dates ?? [],

    mlInputs: values.mlInputs ?? [],

    minimumDate: getMinimumPredictionDate(),

    maximumDate: formatDate(getMaximumPredictionDate()),
  });
}

/**
 * GET /prediction
 *
 * app.js already adds /prediction,
 * so this route only needs "/".
 */
router.get("/", (req, res) => {
  renderPredictionPage(res);
});

/**
 * POST /prediction
 */
router.post("/", async (req, res) => {
  const { startDate, endDate } = req.body;

  if (!startDate || !endDate) {
    return renderPredictionPage(res, 400, {
      error: "Start date and end date are required.",
      startDate,
      endDate,
    });
  }

  const parsedStartDate = parseDate(startDate);
  const parsedEndDate = parseDate(endDate);

  if (
    Number.isNaN(parsedStartDate.getTime()) ||
    Number.isNaN(parsedEndDate.getTime())
  ) {
    return renderPredictionPage(res, 400, {
      error: "Please enter valid dates.",
      startDate,
      endDate,
    });
  }

  const today = getTodayDate();

  if (parsedStartDate <= today) {
    return renderPredictionPage(res, 400, {
      error: "The start date must be in the future.",
      startDate,
      endDate,
    });
  }

  if (parsedEndDate <= today) {
    return renderPredictionPage(res, 400, {
      error: "The end date must be in the future.",
      startDate,
      endDate,
    });
  }

  if (parsedEndDate < parsedStartDate) {
    return renderPredictionPage(res, 400, {
      error: "End date cannot be before start date.",
      startDate,
      endDate,
    });
  }

  const maximumPredictionDate = getMaximumPredictionDate();

  if (parsedEndDate > maximumPredictionDate) {
    return renderPredictionPage(res, 400, {
      error: `Weather forecasts are only available until ${formatDate(
        maximumPredictionDate,
      )}.`,
      startDate,
      endDate,
    });
  }

  const numberOfDays = getNumberOfDays(parsedStartDate, parsedEndDate);

  if (numberOfDays > 7) {
    return renderPredictionPage(res, 400, {
      error: "Prediction range cannot be longer than 7 days.",
      startDate,
      endDate,
    });
  }

  const dates = createDateArray(parsedStartDate, parsedEndDate);

  let weatherData = [];
  let holidayData = [];
  let eventData = [];

  try {
    weatherData = await getWeatherData(dates);

    holidayData = await getHolidayData(dates);

    eventData = await getEventData(dates);
  } catch (error) {
    console.error("External API error:", error);

    return renderPredictionPage(res, 500, {
      error: error.message,
      startDate,
      endDate,
      dates,
    });
  }

  const mlInputs = [];

  try {
    for (const date of dates) {
      const mlInput = await buildMLInputForDate(date);

      const weather = weatherData.find((item) => item.date === date);

      const holiday = holidayData.find((item) => item.date === date);

      const events = eventData.find((item) => item.date === date);

      if (!weather) {
        throw new Error(`Weather data missing for ${date}.`);
      }

      if (!holiday) {
        throw new Error(`Holiday data missing for ${date}.`);
      }

      if (!events) {
        throw new Error(`Event data missing for ${date}.`);
      }

      mlInput.avg_temp = weather.avg_temp;

      mlInput.rain = weather.rain;

      mlInput.public_holiday = holiday.public_holiday;

      mlInput.num_of_event = events.num_of_event;

      mlInputs.push(mlInput);
    }
  } catch (error) {
    return renderPredictionPage(res, 400, {
      error: error.message,
      startDate,
      endDate,
      dates,
    });
  }

  return renderPredictionPage(res, 200, {
    success: `Prepared ${numberOfDays} daily ML input(s).`,
    startDate,
    endDate,
    dates,
    mlInputs,
  });
});

export default router;
