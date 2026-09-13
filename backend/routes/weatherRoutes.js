/**
 * What this file does:
 * Handles the weather routes.
 *
 * Shows the weather forecast for the days ahead
 * and the menu items predicted to be most in demand.
 *
 * All information uses real sources:
 *
 * - Weather: Open-Meteo
 * - Public holidays: Nager.Date
 * - Events: Ticketmaster
 * - Reservations: MongoDB
 * - Menu and promotions: MongoDB
 * - Menu demand: FastAPI ML model
 *
 * No simulated values are used.
 */

import express from "express";

import {
  getWeatherData,
  getHolidayData,
  getEventData,
} from "../utils/externalApis.js";

import { buildMLInputForDate } from "../utils/predictionHelpers.js";

import { getSalesPrediction } from "../utils/mlApi.js";

import {
  parseDate,
  formatDate,
  getTodayDate,
  createDateArray,
} from "../utils/dateHelpers.js";

const router = express.Router();

/**
 * Number of menu items used by the ML model.
 */
const MENU_ITEM_COUNT = 15;

/**
 * Number of top menu items to show per day.
 */
const TOP_ITEM_COUNT = 3;

/**
 * Open-Meteo returns up to 16 forecast days
 * including today.
 */
const MAXIMUM_FORECAST_DAYS = 16;

/**
 * Default number of days shown.
 */
const DEFAULT_FORECAST_DAYS = 7;

/**
 * Options shown in the weather page.
 */
const FORECAST_DAYS_OPTIONS = [3, 7, 14, 16];

/**
 * Temperature thresholds.
 */
const HOT_DAY_TEMPERATURE = 28;

const COLD_DAY_TEMPERATURE = 12;

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
 * RENDER WEATHER PAGE
 * --------------------------------------------------
 *
 * Keeps all required EJS variables in one place.
 */
function renderWeatherPage(res, statusCode = 200, values = {}) {
  return res.status(statusCode).render("weather", {
    error: values.error ?? null,

    /**
     * Kept for compatibility with the
     * existing weather.ejs.
     *
     * Simulation is no longer used.
     */
    warning: null,

    simulated: false,

    numberOfDays: values.numberOfDays ?? DEFAULT_FORECAST_DAYS,

    numberOfDaysOptions: FORECAST_DAYS_OPTIONS,

    rangeLabel: values.rangeLabel ?? "",

    days: values.days ?? [],

    totals: values.totals ?? null,
  });
}

/**
 * --------------------------------------------------
 * DESCRIBE WEATHER CONDITION
 * --------------------------------------------------
 */
function describeCondition(temperature, rain) {
  if (rain) {
    return {
      label: "Rain",
      tone: "wet",
    };
  }

  if (!Number.isFinite(temperature)) {
    return {
      label: "Unknown",
      tone: "plain",
    };
  }

  if (temperature >= HOT_DAY_TEMPERATURE) {
    return {
      label: "Hot",
      tone: "hot",
    };
  }

  if (temperature <= COLD_DAY_TEMPERATURE) {
    return {
      label: "Cold",
      tone: "cold",
    };
  }

  return {
    label: "Mild",
    tone: "mild",
  };
}

/**
 * --------------------------------------------------
 * RANK MENU DEMAND
 * --------------------------------------------------
 *
 * Uses the real FastAPI result to find:
 *
 * - total predicted portions
 * - top three menu items
 * - percentage share for each top item
 */
function rankMenuDemand(mlInput, prediction) {
  const items = [];

  let totalPortions = 0;

  for (let i = 1; i <= MENU_ITEM_COUNT; i++) {
    const amount = Number(prediction?.[`menu_${i}_amount`] ?? 0);

    if (!Number.isFinite(amount)) {
      continue;
    }

    totalPortions += amount;

    items.push({
      name: mlInput[`menu_${i}`],

      amount: amount,
    });
  }

  /**
   * Highest predicted amount first.
   */
  items.sort((a, b) => b.amount - a.amount);

  const ranked = items
    .filter((item) => item.amount > 0)
    .slice(0, TOP_ITEM_COUNT);

  return {
    totalPortions,

    topItems: ranked.map((item, index) => ({
      rank: index + 1,

      name: item.name,

      amount: item.amount,

      /**
       * Percentage of total
       * predicted portions.
       */
      sharePct:
        totalPortions > 0 ? Math.round((item.amount / totalPortions) * 100) : 0,
    })),
  };
}

/**
 * ==================================================
 * GET /weather
 * ==================================================
 *
 * Optional query:
 *
 * /weather?days=3
 * /weather?days=7
 * /weather?days=14
 * /weather?days=16
 */
router.get("/", async (req, res) => {
  const today = getTodayDate();

  /**
   * ------------------------------------------------
   * NUMBER OF FORECAST DAYS
   * ------------------------------------------------
   */
  let numberOfDays = DEFAULT_FORECAST_DAYS;

  const requestedDays = Number(req.query.days);

  if (
    Number.isInteger(requestedDays) &&
    requestedDays >= 1 &&
    requestedDays <= MAXIMUM_FORECAST_DAYS
  ) {
    numberOfDays = requestedDays;
  }

  /**
   * Calculate forecast date range.
   */
  const endDate = addDays(today, numberOfDays - 1);

  const dates = createDateArray(today, endDate);

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

    return renderWeatherPage(res, 500, {
      error: `Could not retrieve weather data: ${error.message}`,

      numberOfDays,
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

    return renderWeatherPage(res, 500, {
      error: `Could not retrieve public holiday data: ${error.message}`,

      numberOfDays,
    });
  }

  /**
   * ==================================================
   * REAL TICKETMASTER EVENT DATA
   * ==================================================
   */
  let eventData;

  try {
    eventData = await getEventData(dates);
  } catch (error) {
    console.error("Ticketmaster API error:", error);

    return renderWeatherPage(res, 500, {
      error: `Could not retrieve event data: ${error.message}`,

      numberOfDays,
    });
  }

  /**
   * Maps make it easy to find the data
   * belonging to one particular date.
   */
  const weatherByDate = new Map(weatherData.map((item) => [item.date, item]));

  const holidayByDate = new Map(holidayData.map((item) => [item.date, item]));

  const eventByDate = new Map(eventData.map((item) => [item.date, item]));

  /**
   * ==================================================
   * BUILD EACH FORECAST DAY
   * ==================================================
   */
  const days = [];

  for (const dateString of dates) {
    const date = parseDate(dateString);

    /**
     * ------------------------------------------------
     * BUILD REAL ML INPUT
     * ------------------------------------------------
     *
     * Gets:
     *
     * - menu names
     * - menu prices
     * - promotions
     * - reservations
     *
     * from MongoDB.
     */
    let mlInput;

    try {
      mlInput = await buildMLInputForDate(dateString);
    } catch (error) {
      console.error(`Could not build ML input for ${dateString}:`, error);

      return renderWeatherPage(res, 500, {
        error: error.message,

        numberOfDays,
      });
    }

    /**
     * ------------------------------------------------
     * GET REAL CONTEXT FOR THIS DATE
     * ------------------------------------------------
     */
    const weather = weatherByDate.get(dateString);

    const holiday = holidayByDate.get(dateString);

    const events = eventByDate.get(dateString);

    /**
     * Do not invent missing data.
     */
    if (!weather) {
      return renderWeatherPage(res, 500, {
        error: `Weather data is missing for ${dateString}.`,

        numberOfDays,
      });
    }

    if (!holiday) {
      return renderWeatherPage(res, 500, {
        error: `Public holiday data is missing for ${dateString}.`,

        numberOfDays,
      });
    }

    if (!events) {
      return renderWeatherPage(res, 500, {
        error: `Event data is missing for ${dateString}.`,

        numberOfDays,
      });
    }

    /**
     * ------------------------------------------------
     * REAL OPEN-METEO VALUES
     * ------------------------------------------------
     */
    mlInput.avg_temp = weather.avg_temp;

    mlInput.rain = weather.rain;

    /**
     * ------------------------------------------------
     * REAL NAGER.DATE VALUE
     * ------------------------------------------------
     */
    mlInput.public_holiday = holiday.public_holiday;

    /**
     * ------------------------------------------------
     * REAL TICKETMASTER VALUE
     * ------------------------------------------------
     */
    mlInput.num_of_event = events.num_of_event;

    /**
     * Holiday name is useful for
     * the interface.
     *
     * It is not required by ML.
     */
    mlInput.holiday_name = holiday.name;

    /**
     * ==================================================
     * REAL FASTAPI ML PREDICTION
     * ==================================================
     */
    let prediction;

    try {
      prediction = await getSalesPrediction(mlInput);
    } catch (error) {
      console.error(`ML prediction failed for ${dateString}:`, error);

      return renderWeatherPage(res, 500, {
        error: `Could not get sales prediction for ${dateString}: ${error.message}`,

        numberOfDays,
      });
    }

    /**
     * Rank menu demand using
     * the real ML output.
     */
    const demand = rankMenuDemand(mlInput, prediction);

    const temperature = Number(mlInput.avg_temp);

    const condition = describeCondition(temperature, mlInput.rain);

    /**
     * Today / Tomorrow badge.
     */
    let badge = null;

    if (dateString === formatDate(today)) {
      badge = "Today";
    } else if (dateString === formatDate(addDays(today, 1))) {
      badge = "Tomorrow";
    }

    /**
     * ------------------------------------------------
     * BUILD DAY FOR WEATHER PAGE
     * ------------------------------------------------
     */
    days.push({
      date: dateString,

      dayNumber: date.getUTCDate(),

      monthLabel: MONTH_NAMES[date.getUTCMonth()].slice(0, 3),

      weekday: WEEKDAY_NAMES[date.getUTCDay()],

      badge: badge,

      /**
       * Real weather.
       */
      temperature: Number.isFinite(temperature) ? temperature : null,

      rain: Boolean(mlInput.rain),

      conditionLabel: condition.label,

      conditionTone: condition.tone,

      /**
       * Real reservation count
       * from MongoDB.
       *
       * If no reservation record
       * exists, predictionHelpers
       * provides 0.
       */
      reservations: Number(mlInput.total_reservation ?? 0),

      /**
       * Real ML result.
       */
      portions: demand.totalPortions,

      topItems: demand.topItems,

      /**
       * Real Ticketmaster data.
       */
      eventCount: Number(mlInput.num_of_event ?? 0),

      /**
       * Real Nager.Date data.
       */
      publicHoliday: Boolean(mlInput.public_holiday),

      holidayName: mlInput.holiday_name,
    });
  }

  /**
   * ==================================================
   * SUMMARY
   * ==================================================
   */

  /**
   * Get all valid temperatures.
   */
  const temperatures = days
    .map((day) => day.temperature)
    .filter((value) => Number.isFinite(value));

  /**
   * Find warmest forecast day.
   */
  const warmestDay = days.reduce(
    (best, day) =>
      day.temperature !== null && (!best || day.temperature > best.temperature)
        ? day
        : best,
    null,
  );

  /**
   * Find day with highest
   * predicted portions.
   */
  const busiestDay = days.reduce(
    (best, day) => (!best || day.portions > best.portions ? day : best),
    null,
  );

  /**
   * --------------------------------------------------
   * FIND ITEM THAT LEADS MOST OFTEN
   * --------------------------------------------------
   */
  const leadCounts = new Map();

  for (const day of days) {
    const leader = day.topItems[0];

    if (!leader) {
      continue;
    }

    leadCounts.set(leader.name, (leadCounts.get(leader.name) ?? 0) + 1);
  }

  let topItemName = null;

  let topItemDays = 0;

  for (const [name, count] of leadCounts) {
    if (count > topItemDays) {
      topItemName = name;

      topItemDays = count;
    }
  }

  /**
   * Count total events in
   * the displayed range.
   */
  const totalEvents = days.reduce((total, day) => total + day.eventCount, 0);

  /**
   * Count public holidays.
   */
  const publicHolidayDays = days.filter((day) => day.publicHoliday).length;

  const totals = {
    averageTemperature:
      temperatures.length > 0
        ? (
            temperatures.reduce((sum, value) => sum + value, 0) /
            temperatures.length
          ).toFixed(1)
        : null,

    rainDays: days.filter((day) => day.rain).length,

    warmestDay,

    busiestDay,

    topItemName,

    topItemDays,

    /**
     * Added real event and
     * holiday summary values.
     */
    totalEvents,

    publicHolidayDays,
  };

  /**
   * Date range label.
   */
  const firstDay = days[0];

  const lastDay = days[days.length - 1];

  /**
   * ==================================================
   * RENDER PAGE
   * ==================================================
   */
  return renderWeatherPage(res, 200, {
    numberOfDays,

    rangeLabel:
      firstDay && lastDay ? `${firstDay.date} to ${lastDay.date}` : "",

    days,

    totals,
  });
});

export default router;
