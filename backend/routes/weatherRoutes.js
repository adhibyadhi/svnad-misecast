/**
 * What this file does:
 * Handles the weather routes.
 *
 * Shows the forecast for the days ahead and, for each
 * of those days, the menu items most likely to be in
 * demand.
 *
 * SIMULATION MODE
 *
 * The demand figures come from the ML API when it is
 * reachable. While the model is still being built they
 * are simulated using the same rules as the prediction
 * page, and every simulated source is named in the
 * interface.
 *
 * Set SIMULATION_MODE=true in .env to force simulated
 * values even when the services are available.
 */

import express from "express";

import { getWeatherData } from "../utils/externalApis.js";

import { buildMLInputForDate } from "../utils/predictionHelpers.js";

import { getSalesPrediction } from "../utils/mlApi.js";

import {
  parseDate,
  formatDate,
  getTodayDate,
  createDateArray,
} from "../utils/dateHelpers.js";

const router = express.Router();

const MENU_ITEM_COUNT = 15;

const TOP_ITEM_COUNT = 3;

/**
 * Open-Meteo returns 16 days including today.
 */
const MAXIMUM_FORECAST_DAYS = 16;

const DEFAULT_FORECAST_DAYS = 7;

const FORECAST_DAYS_OPTIONS = [3, 7, 14, 16];

/**
 * Condition thresholds in degrees Celsius.
 */
const HOT_DAY_TEMPERATURE = 28;

const COLD_DAY_TEMPERATURE = 12;

/**
 * Simulated demand settings, matching the
 * prediction page.
 */
const SIMULATED_BASE_PORTIONS = 150;

const SIMULATED_WEEKEND_UPLIFT = 1.25;

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

function isSimulationForced() {
  return String(process.env.SIMULATION_MODE).toLowerCase() === "true";
}

/**
 * Repeatable number between 0 and 1 for one key.
 */
function seededRandom(seedText) {
  let hash = 2166136261;

  for (let i = 0; i < seedText.length; i++) {
    hash ^= seedText.charCodeAt(i);

    hash = Math.imul(hash, 16777619);
  }

  return ((hash >>> 0) % 10000) / 10000;
}

function addDays(date, numberOfDays) {
  const newDate = new Date(date.getTime());

  newDate.setUTCDate(newDate.getUTCDate() + numberOfDays);

  return newDate;
}

/**
 * SIMULATION
 *
 * Stand-in forecast used when the weather API
 * cannot be reached.
 */
function simulateWeatherData(dates) {
  return dates.map((date) => ({
    date: date,

    avg_temp: Number((12 + seededRandom(`temp-${date}`) * 12).toFixed(1)),

    rain: seededRandom(`rain-${date}`) > 0.7,
  }));
}

/**
 * SIMULATION
 *
 * Stand-in ML response for one day. The shape matches
 * the real ML API: menu_1 ... menu_15 plus
 * menu_1_amount ... menu_15_amount.
 */
function simulateSalesPrediction(mlInput, dateString) {
  const date = parseDate(dateString);

  const dayOfWeek = date.getUTCDay();

  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  const dailyNoise = 0.85 + seededRandom(dateString) * 0.3;

  let totalPortions = SIMULATED_BASE_PORTIONS * dailyNoise;

  if (isWeekend) {
    totalPortions *= SIMULATED_WEEKEND_UPLIFT;
  }

  const reservations = Number(mlInput.total_reservation ?? 0);

  if (reservations > 0) {
    totalPortions *= 1 + Math.min(reservations, 80) / 300;
  }

  const weights = [];

  let weightTotal = 0;

  for (let i = 1; i <= MENU_ITEM_COUNT; i++) {
    const itemNoise = 0.6 + seededRandom(`${dateString}-${i}`) * 0.8;

    const weight = (1 / (i + 2)) * itemNoise;

    weights.push(weight);

    weightTotal += weight;
  }

  const prediction = {};

  for (let i = 1; i <= MENU_ITEM_COUNT; i++) {
    prediction[`menu_${i}`] = mlInput[`menu_${i}`];

    prediction[`menu_${i}_amount`] = Math.max(
      0,
      Math.round((weights[i - 1] / weightTotal) * totalPortions),
    );
  }

  return prediction;
}

/**
 * Describe the day in one word.
 */
function describeCondition(temperature, rain) {
  if (rain) {
    return { label: "Rain", tone: "wet" };
  }

  if (!Number.isFinite(temperature)) {
    return { label: "Unknown", tone: "plain" };
  }

  if (temperature >= HOT_DAY_TEMPERATURE) {
    return { label: "Hot", tone: "hot" };
  }

  if (temperature <= COLD_DAY_TEMPERATURE) {
    return { label: "Cold", tone: "cold" };
  }

  return { label: "Mild", tone: "mild" };
}

/**
 * Rank the menu for one day.
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

  items.sort((a, b) => b.amount - a.amount);

  const ranked = items.filter((item) => item.amount > 0).slice(0, TOP_ITEM_COUNT);

  return {
    totalPortions: totalPortions,

    topItems: ranked.map((item, index) => ({
      rank: index + 1,

      name: item.name,

      amount: item.amount,

      /**
       * Share of that day's total portions, used for
       * the small bar behind each item.
       */
      sharePct:
        totalPortions > 0
          ? Math.round((item.amount / totalPortions) * 100)
          : 0,
    })),
  };
}

/**
 * GET /weather
 *
 * Optional query value:
 *
 * days  how many forecast days to show
 */
router.get("/", async (req, res) => {
  const today = getTodayDate();

  /**
   * How many days to show.
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

  const endDate = addDays(today, numberOfDays - 1);

  const dates = createDateArray(today, endDate);

  const forceSimulation = isSimulationForced();

  const simulatedSources = new Set();

  /**
   * Forecast.
   */
  let weatherData = [];

  if (forceSimulation) {
    weatherData = simulateWeatherData(dates);

    simulatedSources.add("weather");
  } else {
    try {
      weatherData = await getWeatherData(dates);
    } catch (error) {
      console.error("Weather API error:", error);

      weatherData = simulateWeatherData(dates);

      simulatedSources.add("weather");
    }
  }

  const weatherByDate = new Map(weatherData.map((item) => [item.date, item]));

  /**
   * Menu demand for each forecast day.
   */
  const days = [];

  for (const dateString of dates) {
    const date = parseDate(dateString);

    let mlInput;

    try {
      mlInput = await buildMLInputForDate(dateString);
    } catch (error) {
      console.error(`Could not build ML input for ${dateString}:`, error);

      /**
       * Usually means the menu is not imported yet.
       */
      return res.render("weather", {
        error: error.message,

        warning: null,

        simulated: false,

        numberOfDays: numberOfDays,

        numberOfDaysOptions: FORECAST_DAYS_OPTIONS,

        rangeLabel: "",

        days: [],

        totals: null,
      });
    }

    const weather = weatherByDate.get(dateString);

    mlInput.avg_temp = weather?.avg_temp ?? null;

    mlInput.rain = weather?.rain ?? false;

    mlInput.public_holiday = false;

    mlInput.num_of_event = 0;

    let prediction = null;

    if (!forceSimulation) {
      try {
        prediction = await getSalesPrediction(mlInput);
      } catch (error) {
        console.error(`ML prediction failed for ${dateString}:`, error);
      }
    }

    if (!prediction) {
      prediction = simulateSalesPrediction(mlInput, dateString);

      simulatedSources.add("menu demand");
    }

    const demand = rankMenuDemand(mlInput, prediction);

    const temperature = Number(mlInput.avg_temp);

    const condition = describeCondition(temperature, mlInput.rain);

    let badge = null;

    if (dateString === formatDate(today)) {
      badge = "Today";
    } else if (dateString === formatDate(addDays(today, 1))) {
      badge = "Tomorrow";
    }

    days.push({
      date: dateString,

      dayNumber: date.getUTCDate(),

      monthLabel: MONTH_NAMES[date.getUTCMonth()].slice(0, 3),

      weekday: WEEKDAY_NAMES[date.getUTCDay()],

      badge: badge,

      temperature: Number.isFinite(temperature) ? temperature : null,

      rain: Boolean(mlInput.rain),

      conditionLabel: condition.label,

      conditionTone: condition.tone,

      reservations: Number(mlInput.total_reservation ?? 0),

      portions: demand.totalPortions,

      topItems: demand.topItems,
    });
  }

  /**
   * Summary strip.
   */
  const temperatures = days
    .map((day) => day.temperature)
    .filter((value) => Number.isFinite(value));

  const warmestDay = days.reduce(
    (best, day) =>
      day.temperature !== null && (!best || day.temperature > best.temperature)
        ? day
        : best,
    null,
  );

  const busiestDay = days.reduce(
    (best, day) => (!best || day.portions > best.portions ? day : best),
    null,
  );

  /**
   * Which single item leads on the most days.
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

  const totals = {
    averageTemperature:
      temperatures.length > 0
        ? (
            temperatures.reduce((sum, value) => sum + value, 0) /
            temperatures.length
          ).toFixed(1)
        : null,

    rainDays: days.filter((day) => day.rain).length,

    warmestDay: warmestDay,

    busiestDay: busiestDay,

    topItemName: topItemName,

    topItemDays: topItemDays,
  };

  let warning = null;

  if (simulatedSources.size > 0) {
    warning = `Simulated values in use for: ${[...simulatedSources].join(", ")}. Replace them by connecting the model and the weather API.`;
  }

  const firstDay = days[0];

  const lastDay = days[days.length - 1];

  return res.render("weather", {
    error: null,

    warning: warning,

    simulated: simulatedSources.size > 0,

    numberOfDays: numberOfDays,

    numberOfDaysOptions: FORECAST_DAYS_OPTIONS,

    rangeLabel:
      firstDay && lastDay ? `${firstDay.date} to ${lastDay.date}` : "",

    days: days,

    totals: totals,
  });
});

export default router;
