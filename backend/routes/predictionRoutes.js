/**
 * What this file does:
 * Handles prediction routes.
 *
 * All prediction inputs use real data:
 *
 * - Weather: Open-Meteo
 * - Public holidays: Nager.Date
 * - Events: Ticketmaster
 * - Reservations: MongoDB
 * - Menu and promotions: MongoDB
 * - Sales prediction: FastAPI ML model
 *
 * No simulated values are used.
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

import {
  buildMLInputForDate,
  buildPredictionDocument,
} from "../utils/predictionHelpers.js";

import { getSalesPrediction } from "../utils/mlApi.js";

import MLModelInput from "../models/MLModelInput.js";
import PredictedSales from "../models/PredictedSales.js";
import RequestHistory from "../models/RequestHistory.js";

const router = express.Router();

/**
 * Number of menu items used by the ML model.
 */
const MENU_ITEM_COUNT = 15;

/**
 * Number of top menu items shown
 * for each prediction day.
 */
const TOP_ITEM_COUNT = 3;

/**
 * Difference from the average required
 * before a day is called Busy or Quiet.
 */
const DEMAND_THRESHOLD_PCT = 10;

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * --------------------------------------------------
 * RENDER PREDICTION PAGE
 * --------------------------------------------------
 */
function renderPredictionPage(res, statusCode = 200, values = {}) {
  return res.status(statusCode).render("prediction", {
    error: values.error ?? null,

    warning: null,

    success: values.success ?? null,

    /**
     * Kept for compatibility with prediction.ejs.
     *
     * Simulation is no longer used.
     */
    simulated: false,

    startDate: values.startDate ?? "",

    endDate: values.endDate ?? "",

    calendar: values.calendar ?? null,

    minimumDate: getMinimumPredictionDate(),

    maximumDate: formatDate(getMaximumPredictionDate()),
  });
}

/**
 * --------------------------------------------------
 * FORMAT MONEY
 * --------------------------------------------------
 *
 * Examples:
 *
 * 450  -> $450
 * 1250 -> $1.3k
 */
function formatMoney(amount) {
  if (amount >= 1000) {
    return `$${(amount / 1000).toFixed(1)}k`;
  }

  return `$${Math.round(amount)}`;
}

/**
 * --------------------------------------------------
 * ADD DAYS
 * --------------------------------------------------
 */
function addDays(date, numberOfDays) {
  const newDate = new Date(date.getTime());

  newDate.setUTCDate(newDate.getUTCDate() + numberOfDays);

  return newDate;
}

/**
 * --------------------------------------------------
 * BUILD DAY SUMMARY
 * --------------------------------------------------
 *
 * Calculates:
 *
 * - total predicted portions
 * - predicted sales revenue
 * - top 3 menu items
 */
function buildDaySummary(mlInput, prediction) {
  const items = [];

  let totalPortions = 0;

  let forecastSales = 0;

  for (let i = 1; i <= MENU_ITEM_COUNT; i++) {
    const name = mlInput[`menu_${i}`];

    const price = Number(mlInput[`menu_${i}_price_after_discount`]);

    /**
     * FastAPI returns:
     *
     * menu_1_amount
     * menu_2_amount
     * ...
     * menu_15_amount
     */
    const amount = Number(prediction?.[`menu_${i}_amount`] ?? 0);

    if (!Number.isFinite(amount)) {
      continue;
    }

    totalPortions += amount;

    if (Number.isFinite(price)) {
      forecastSales += amount * price;
    }

    items.push({
      name,
      amount,
    });
  }

  /**
   * Highest predicted sales first.
   */
  items.sort((a, b) => b.amount - a.amount);

  return {
    totalPortions,

    forecastSales,

    topItems: items
      .filter((item) => item.amount > 0)
      .slice(0, TOP_ITEM_COUNT)
      .map((item, index) => ({
        rank: index + 1,

        name: item.name,

        amount: item.amount,
      })),
  };
}

/**
 * --------------------------------------------------
 * BUILD CALENDAR
 * --------------------------------------------------
 */
function buildCalendar(days, startDate, endDate) {
  /**
   * Start calendar on Sunday.
   */
  const gridStart = addDays(startDate, -startDate.getUTCDay());

  /**
   * Finish calendar on Saturday.
   */
  const gridEnd = addDays(endDate, 6 - endDate.getUTCDay());

  /**
   * Makes finding a prediction
   * by date easier.
   */
  const dayByDate = new Map(days.map((day) => [day.date, day]));

  const weeks = [];

  let cursor = gridStart;

  while (cursor <= gridEnd) {
    const week = [];

    for (let i = 0; i < 7; i++) {
      const dateString = formatDate(cursor);

      const day = dayByDate.get(dateString);

      week.push(
        day ?? {
          inRange: false,

          date: dateString,

          dayNumber: cursor.getUTCDate(),
        },
      );

      cursor = addDays(cursor, 1);
    }

    weeks.push(week);
  }

  /**
   * Calendar heading.
   */
  const startMonth = MONTH_NAMES[startDate.getUTCMonth()];

  const endMonth = MONTH_NAMES[endDate.getUTCMonth()];

  const monthLabel =
    startMonth === endMonth ? startMonth : `${startMonth} – ${endMonth}`;

  const startYear = startDate.getUTCFullYear();

  const endYear = endDate.getUTCFullYear();

  const yearLabel =
    startYear === endYear ? String(startYear) : `${startYear} – ${endYear}`;

  return {
    monthLabel,

    yearLabel,

    weekdayNames: WEEKDAY_NAMES,

    weeks,
  };
}

/**
 * ==================================================
 * GET /prediction
 * ==================================================
 */
router.get("/", (req, res) => {
  return renderPredictionPage(res);
});

/**
 * ==================================================
 * POST /prediction
 * ==================================================
 */
router.post("/", async (req, res) => {
  const { startDate, endDate } = req.body;

  /**
   * ------------------------------------------------
   * REQUIRED DATES
   * ------------------------------------------------
   */
  if (!startDate || !endDate) {
    return renderPredictionPage(res, 400, {
      error: "Start date and end date are required.",

      startDate,

      endDate,
    });
  }

  const parsedStartDate = parseDate(startDate);

  const parsedEndDate = parseDate(endDate);

  /**
   * ------------------------------------------------
   * VALID DATE FORMAT
   * ------------------------------------------------
   */
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

  /**
   * ------------------------------------------------
   * START DATE MUST BE FUTURE
   * ------------------------------------------------
   */
  if (parsedStartDate <= today) {
    return renderPredictionPage(res, 400, {
      error: "The start date must be in the future.",

      startDate,

      endDate,
    });
  }

  /**
   * ------------------------------------------------
   * END DATE MUST BE FUTURE
   * ------------------------------------------------
   */
  if (parsedEndDate <= today) {
    return renderPredictionPage(res, 400, {
      error: "The end date must be in the future.",

      startDate,

      endDate,
    });
  }

  /**
   * ------------------------------------------------
   * END DATE CANNOT BE BEFORE START DATE
   * ------------------------------------------------
   */
  if (parsedEndDate < parsedStartDate) {
    return renderPredictionPage(res, 400, {
      error: "End date cannot be before start date.",

      startDate,

      endDate,
    });
  }

  /**
   * ------------------------------------------------
   * WEATHER FORECAST LIMIT
   * ------------------------------------------------
   */
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

  /**
   * ------------------------------------------------
   * MAXIMUM 7 DAY RANGE
   * ------------------------------------------------
   */
  const numberOfDays = getNumberOfDays(parsedStartDate, parsedEndDate);

  if (numberOfDays > 7) {
    return renderPredictionPage(res, 400, {
      error: "Prediction range cannot be longer than 7 days.",

      startDate,

      endDate,
    });
  }

  /**
   * Create all dates inside the
   * selected range.
   *
   * Example:
   *
   * [
   *   "2026-09-15",
   *   "2026-09-16",
   *   "2026-09-17"
   * ]
   */
  const dates = createDateArray(parsedStartDate, parsedEndDate);

  /**
   * ==================================================
   * REAL WEATHER DATA
   * ==================================================
   */
  let weatherData;

  try {
    weatherData = await getWeatherData(dates);
  } catch (error) {
    console.error("Weather API error:", error);

    return renderPredictionPage(res, 500, {
      error: `Could not retrieve weather data: ${error.message}`,

      startDate,

      endDate,
    });
  }

  /**
   * ==================================================
   * REAL PUBLIC HOLIDAY DATA
   * ==================================================
   */
  let holidayData;

  try {
    holidayData = await getHolidayData(dates);
  } catch (error) {
    console.error("Public holiday API error:", error);

    return renderPredictionPage(res, 500, {
      error: `Could not retrieve public holiday data: ${error.message}`,

      startDate,

      endDate,
    });
  }

  /**
   * ==================================================
   * REAL EVENT DATA
   * ==================================================
   */
  let eventData;

  try {
    eventData = await getEventData(dates);
  } catch (error) {
    console.error("Ticketmaster API error:", error);

    return renderPredictionPage(res, 500, {
      error: `Could not retrieve event data: ${error.message}`,

      startDate,

      endDate,
    });
  }

  /**
   * ==================================================
   * BUILD REAL ML INPUT
   * ==================================================
   *
   * One input object is created
   * for each prediction date.
   */
  const mlInputs = [];

  try {
    for (const date of dates) {
      /**
       * Gets real:
       *
       * - menu names
       * - menu prices
       * - promotions
       * - reservation total
       */
      const mlInput = await buildMLInputForDate(date);

      /**
       * Get API information
       * belonging to this date.
       */
      const weather = weatherData.find((item) => item.date === date);

      const holiday = holidayData.find((item) => item.date === date);

      const events = eventData.find((item) => item.date === date);

      /**
       * Do not make up missing data.
       *
       * If one of the real APIs did not
       * return the requested date,
       * stop the prediction.
       */
      if (!weather) {
        throw new Error(`Weather data is missing for ${date}.`);
      }

      if (!holiday) {
        throw new Error(`Public holiday data is missing for ${date}.`);
      }

      if (!events) {
        throw new Error(`Event data is missing for ${date}.`);
      }

      /**
       * Real weather values.
       */
      mlInput.avg_temp = weather.avg_temp;

      mlInput.rain = weather.rain;

      /**
       * Real public holiday value.
       */
      mlInput.public_holiday = holiday.public_holiday;

      /**
       * Real Ticketmaster event count.
       */
      mlInput.num_of_event = events.num_of_event;

      /**
       * Display only.
       *
       * Not required by the ML model.
       */
      mlInput.holiday_name = holiday.name;

      /**
       * IMPORTANT:
       *
       * total_reservation already comes
       * from MongoDB.
       *
       * If no reservation document exists,
       * buildMLInputForDate gives us 0.
       *
       * We DO NOT replace 0 with fake data.
       */

      mlInputs.push(mlInput);
    }
  } catch (error) {
    console.error("Failed to build ML input:", error);

    return renderPredictionPage(res, 400, {
      error: error.message,

      startDate,

      endDate,
    });
  }

  /**
   * ==================================================
   * REAL FASTAPI MACHINE LEARNING MODEL
   * ==================================================
   */
  const days = [];

  const tomorrow = formatDate(addDays(today, 1));

  const dayAfterTomorrow = formatDate(addDays(today, 2));

  try {
    for (const mlInput of mlInputs) {
      const dateString = formatDate(new Date(mlInput.date));

      /**
       * ------------------------------------------------
       * SEND INPUT TO FASTAPI
       * ------------------------------------------------
       */
      let apiResult;

      try {
        apiResult = await getSalesPrediction(mlInput);
      } catch (error) {
        console.error(`ML prediction failed for ${dateString}:`, error);

        throw new Error(
          `Could not get ML prediction for ${dateString}: ${error.message}`,
        );
      }

      /**
       * ------------------------------------------------
       * BUILD DATABASE PREDICTION DOCUMENT
       * ------------------------------------------------
       */
      const predictionData = buildPredictionDocument(mlInput, apiResult);

      /**
       * ------------------------------------------------
       * SAVE ML INPUT
       * ------------------------------------------------
       */
      const savedInput = await MLModelInput.create(mlInput);

      /**
       * ------------------------------------------------
       * SAVE ML OUTPUT
       * ------------------------------------------------
       */
      const savedPrediction = await PredictedSales.create(predictionData);

      /**
       * ------------------------------------------------
       * SAVE REQUEST HISTORY
       * ------------------------------------------------
       */
      await RequestHistory.create({
        prediction_id: savedPrediction._id,

        date: savedInput.date,
      });

      /**
       * Convert Mongoose result
       * into normal JavaScript object.
       */
      const prediction = savedPrediction.toObject();

      /**
       * Calculate totals for
       * the calendar.
       */
      const summary = buildDaySummary(mlInput, prediction);

      const cellDate = parseDate(dateString);

      let badge = null;

      if (dateString === tomorrow) {
        badge = "Tomorrow";
      } else if (dateString === dayAfterTomorrow) {
        badge = "Next day";
      }

      /**
       * ------------------------------------------------
       * BUILD CALENDAR DAY
       * ------------------------------------------------
       */
      days.push({
        inRange: true,

        date: dateString,

        dayNumber: cellDate.getUTCDate(),

        weekday: WEEKDAY_NAMES[cellDate.getUTCDay()],

        badge,

        predictionAvailable: true,

        forecastSalesLabel: formatMoney(summary.forecastSales),

        forecastSales: summary.forecastSales,

        portions: summary.totalPortions,

        /**
         * Real MongoDB reservation count.
         */
        reservations: Number(mlInput.total_reservation ?? 0),

        /**
         * Simulation is completely removed.
         *
         * Kept as false because the current
         * EJS view reads this property.
         */
        reservationIsSimulated: false,

        topItems: summary.topItems,

        /**
         * Real Open-Meteo values.
         */
        temperature: Number(mlInput.avg_temp),

        rain: Boolean(mlInput.rain),

        /**
         * Real Ticketmaster event count.
         */
        eventCount: Number(mlInput.num_of_event ?? 0),

        /**
         * Real Nager.Date holiday value.
         */
        publicHoliday: Boolean(mlInput.public_holiday),

        holidayName: mlInput.holiday_name,

        /**
         * Calculated below once
         * range average is known.
         */
        demandLabel: "Unknown",

        demandDeltaLabel: "",

        demandTone: "flat",
      });
    }
  } catch (error) {
    console.error("Prediction process failed:", error);

    return renderPredictionPage(res, 500, {
      error: error.message,

      startDate,

      endDate,
    });
  }

  /**
   * ==================================================
   * CALCULATE AVERAGE DEMAND
   * ==================================================
   */
  const averagePortions =
    days.length > 0
      ? days.reduce((total, day) => total + day.portions, 0) / days.length
      : 0;

  /**
   * ==================================================
   * BUSY / NORMAL / QUIET
   * ==================================================
   */
  for (const day of days) {
    if (averagePortions <= 0) {
      continue;
    }

    const deltaPct = Math.round(
      ((day.portions - averagePortions) / averagePortions) * 100,
    );

    day.demandDeltaLabel = `${deltaPct >= 0 ? "+" : ""}${deltaPct}%`;

    /**
     * More than 10% above average.
     */
    if (deltaPct > DEMAND_THRESHOLD_PCT) {
      day.demandLabel = "Busy";

      day.demandTone = "up";
    } else if (deltaPct < -DEMAND_THRESHOLD_PCT) {

    /**
     * More than 10% below average.
     */
      day.demandLabel = "Quiet";

      day.demandTone = "down";
    } else {

    /**
     * Within 10% of average.
     */
      day.demandLabel = "Normal";

      day.demandTone = "flat";
    }
  }

  /**
   * ==================================================
   * BUILD CALENDAR
   * ==================================================
   */
  const calendar = buildCalendar(days, parsedStartDate, parsedEndDate);

  /**
   * ==================================================
   * SHOW RESULTS
   * ==================================================
   */
  return renderPredictionPage(res, 200, {
    success: `Prediction completed for ${numberOfDays} day${
      numberOfDays === 1 ? "" : "s"
    }.`,

    startDate,

    endDate,

    calendar,
  });
});

export default router;
