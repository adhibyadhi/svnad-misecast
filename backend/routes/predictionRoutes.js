/**
 * What this file does:
 * Handles prediction routes.
 *
 * The daily ML inputs are sent to the ML API and
 * the results are shaped into a calendar grid.
 *
 * SIMULATION MODE
 *
 * While the model and the external APIs are still
 * being built, any source that cannot be reached is
 * replaced with a simulated value so the calendar
 * always has something to show. Simulated days are
 * clearly marked in the interface.
 *
 * Set SIMULATION_MODE=true in .env to force simulated
 * values even when the services are available.
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

import { getSalesPrediction } from "../utils/mlApi.js";

const router = express.Router();

const MENU_ITEM_COUNT = 15;

const TOP_ITEM_COUNT = 3;

/**
 * A day is only called busy or quiet when it is
 * more than this far from the range average.
 */
const DEMAND_THRESHOLD_PCT = 10;

/**
 * Simulated demand settings.
 */
const SIMULATED_BASE_PORTIONS = 150;

const SIMULATED_WEEKEND_UPLIFT = 1.25;

const SIMULATED_HOLIDAY_UPLIFT = 1.12;

const SIMULATED_RESERVATION_RANGE = [24, 62];

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
 * True when simulated values are forced on.
 */
function isSimulationForced() {
  return String(process.env.SIMULATION_MODE).toLowerCase() === "true";
}

/**
 * Turn a date string into a repeatable number
 * between 0 and 1.
 *
 * The same date always produces the same value,
 * so the demo does not change on every refresh.
 */
function seededRandom(seedText) {
  let hash = 2166136261;

  for (let i = 0; i < seedText.length; i++) {
    hash ^= seedText.charCodeAt(i);

    hash = Math.imul(hash, 16777619);
  }

  /**
   * Keep it positive and scale to 0 - 1.
   */
  return ((hash >>> 0) % 10000) / 10000;
}

/**
 * Render prediction page.
 */
function renderPredictionPage(res, statusCode = 200, values = {}) {
  return res.status(statusCode).render("prediction", {
    error: values.error ?? null,

    warning: values.warning ?? null,

    success: values.success ?? null,

    simulated: values.simulated ?? false,

    startDate: values.startDate ?? "",

    endDate: values.endDate ?? "",

    calendar: values.calendar ?? null,

    minimumDate: getMinimumPredictionDate(),

    maximumDate: formatDate(getMaximumPredictionDate()),
  });
}

/**
 * Format money the way the dashboard shows it.
 */
function formatMoney(amount) {
  if (amount >= 1000) {
    return `$${(amount / 1000).toFixed(1)}k`;
  }

  return `$${Math.round(amount)}`;
}

/**
 * Move a date by a number of days.
 */
function addDays(date, numberOfDays) {
  const newDate = new Date(date.getTime());

  newDate.setUTCDate(newDate.getUTCDate() + numberOfDays);

  return newDate;
}

/**
 * SIMULATION
 *
 * Produce a stand-in ML response for one day.
 *
 * The shape matches the real ML API:
 *
 * menu_1 ... menu_15
 * menu_1_amount ... menu_15_amount
 */
function simulateSalesPrediction(mlInput, dateString) {
  const date = parseDate(dateString);

  const dayOfWeek = date.getUTCDay();

  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  /**
   * Daily variation of roughly plus or minus 15%.
   */
  const dailyNoise = 0.85 + seededRandom(dateString) * 0.3;

  let totalPortions = SIMULATED_BASE_PORTIONS * dailyNoise;

  if (isWeekend) {
    totalPortions *= SIMULATED_WEEKEND_UPLIFT;
  }

  if (mlInput.public_holiday) {
    totalPortions *= SIMULATED_HOLIDAY_UPLIFT;
  }

  /**
   * Reservations pull demand up a little.
   */
  const reservations = Number(mlInput.total_reservation ?? 0);

  if (reservations > 0) {
    totalPortions *= 1 + Math.min(reservations, 80) / 300;
  }

  /**
   * Share the portions across the menu.
   *
   * Earlier menu positions sell more, which keeps
   * the top-item list stable and believable.
   */
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
 * SIMULATION
 *
 * Stand-in weather, holiday and event context.
 */
function simulateWeatherData(dates) {
  return dates.map((date) => ({
    date: date,

    avg_temp: Number((12 + seededRandom(`temp-${date}`) * 12).toFixed(1)),

    rain: seededRandom(`rain-${date}`) > 0.7,
  }));
}

function simulateHolidayData(dates) {
  return dates.map((date) => ({
    date: date,

    public_holiday: false,

    name: null,
  }));
}

function simulateEventData(dates) {
  return dates.map((date) => ({
    date: date,

    num_of_event: seededRandom(`event-${date}`) > 0.6 ? 1 : 0,
  }));
}

/**
 * SIMULATION
 *
 * Stand-in reservation count, used only when the
 * database has no record for the day.
 */
function simulateReservationCount(dateString) {
  const [minimum, maximum] = SIMULATED_RESERVATION_RANGE;

  const spread = maximum - minimum;

  return Math.round(minimum + seededRandom(`booking-${dateString}`) * spread);
}

/**
 * Turn one ML input plus one ML result into
 * the values shown inside a calendar cell.
 */
function buildDaySummary(mlInput, prediction) {
  const items = [];

  let totalPortions = 0;

  let forecastSales = 0;

  for (let i = 1; i <= MENU_ITEM_COUNT; i++) {
    const name = mlInput[`menu_${i}`];

    const price = Number(mlInput[`menu_${i}_price_after_discount`]);

    /**
     * The ML API returns menu_1_amount ... menu_15_amount.
     */
    const amount = Number(prediction?.[`menu_${i}_amount`] ?? 0);

    if (!Number.isFinite(amount)) {
      continue;
    }

    totalPortions += amount;

    forecastSales += amount * price;

    items.push({
      name: name,

      amount: amount,
    });
  }

  /**
   * Highest predicted items first.
   */
  items.sort((a, b) => b.amount - a.amount);

  return {
    totalPortions: totalPortions,

    forecastSales: forecastSales,

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
 * Build the weekly grid that the page draws.
 *
 * Every week holds seven cells. Days outside the
 * prediction range are empty placeholders.
 */
function buildCalendar(days, startDate, endDate) {
  /**
   * Start on the Sunday of the first week and
   * finish on the Saturday of the last week.
   */
  const gridStart = addDays(startDate, -startDate.getUTCDay());

  const gridEnd = addDays(endDate, 6 - endDate.getUTCDay());

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
   * Heading above the grid.
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
    monthLabel: monthLabel,

    yearLabel: yearLabel,

    weekdayNames: WEEKDAY_NAMES,

    weeks: weeks,
  };
}

/**
 * GET /prediction
 */
router.get("/", (req, res) => {
  renderPredictionPage(res, 200, {
    simulated: isSimulationForced(),
  });
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

  const forceSimulation = isSimulationForced();

  /**
   * Which parts of this page are standing in
   * for a service that is not ready yet.
   */
  const simulatedSources = new Set();

  /**
   * External context.
   *
   * Each source falls back on its own so one
   * missing API key does not blank the page.
   */
  let weatherData;
  let holidayData;
  let eventData;

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

  if (forceSimulation) {
    holidayData = simulateHolidayData(dates);

    simulatedSources.add("holidays");
  } else {
    try {
      holidayData = await getHolidayData(dates);
    } catch (error) {
      console.error("Holiday API error:", error);

      holidayData = simulateHolidayData(dates);

      simulatedSources.add("holidays");
    }
  }

  if (forceSimulation) {
    eventData = simulateEventData(dates);

    simulatedSources.add("events");
  } else {
    try {
      eventData = await getEventData(dates);
    } catch (error) {
      console.error("Event API error:", error);

      eventData = simulateEventData(dates);

      simulatedSources.add("events");
    }
  }

  /**
   * Build one ML input per day.
   */
  const mlInputs = [];

  for (const date of dates) {
    const mlInput = await buildMLInputForDate(date);

    const weather = weatherData.find((item) => item.date === date);

    const holiday = holidayData.find((item) => item.date === date);

    const events = eventData.find((item) => item.date === date);

    mlInput.avg_temp = weather?.avg_temp ?? null;

    mlInput.rain = weather?.rain ?? false;

    mlInput.public_holiday = holiday?.public_holiday ?? false;

    mlInput.num_of_event = events?.num_of_event ?? 0;

    /**
     * Display only. The ML model does not
     * receive the holiday name.
     */
    mlInput.holiday_name = holiday?.name ?? null;

    /**
     * Stand in for a missing reservation record so
     * the demo is not full of zeros.
     */
    if (!mlInput.total_reservation) {
      mlInput.total_reservation = simulateReservationCount(date);

      mlInput.reservation_is_simulated = true;

      simulatedSources.add("reservations");
    }

    mlInputs.push(mlInput);
  }

  /**
   * Ask the ML API for each day, or simulate
   * the answer while the model is being built.
   */
  const days = [];

  const tomorrow = formatDate(addDays(today, 1));

  const dayAfterTomorrow = formatDate(addDays(today, 2));

  for (const mlInput of mlInputs) {
    const dateString = formatDate(new Date(mlInput.date));

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

      simulatedSources.add("sales");
    }

    const summary = buildDaySummary(mlInput, prediction);

    const cellDate = parseDate(dateString);

    let badge = null;

    if (dateString === tomorrow) {
      badge = "Tomorrow";
    } else if (dateString === dayAfterTomorrow) {
      badge = "Next day";
    }

    days.push({
      inRange: true,

      date: dateString,

      dayNumber: cellDate.getUTCDate(),

      weekday: WEEKDAY_NAMES[cellDate.getUTCDay()],

      badge: badge,

      predictionAvailable: true,

      forecastSalesLabel: formatMoney(summary.forecastSales),

      forecastSales: summary.forecastSales,

      portions: summary.totalPortions,

      reservations: Number(mlInput.total_reservation ?? 0),

      reservationIsSimulated: Boolean(mlInput.reservation_is_simulated),

      topItems: summary.topItems,

      temperature: Number(mlInput.avg_temp),

      rain: Boolean(mlInput.rain),

      eventCount: Number(mlInput.num_of_event ?? 0),

      publicHoliday: Boolean(mlInput.public_holiday),

      holidayName: mlInput.holiday_name,

      /**
       * Filled in below, once the range
       * average is known.
       */
      demandLabel: "Unknown",

      demandDeltaLabel: "",

      demandTone: "flat",
    });
  }

  /**
   * Compare each day with the range average so the
   * manager can see which services stand out.
   */
  const averagePortions =
    days.length > 0
      ? days.reduce((total, day) => total + day.portions, 0) / days.length
      : 0;

  for (const day of days) {
    if (averagePortions <= 0) {
      continue;
    }

    const deltaPct = Math.round(
      ((day.portions - averagePortions) / averagePortions) * 100,
    );

    day.demandDeltaLabel = `${deltaPct >= 0 ? "+" : ""}${deltaPct}%`;

    if (deltaPct > DEMAND_THRESHOLD_PCT) {
      day.demandLabel = "Busy";

      day.demandTone = "up";
    } else if (deltaPct < -DEMAND_THRESHOLD_PCT) {
      day.demandLabel = "Quiet";

      day.demandTone = "down";
    } else {
      day.demandLabel = "Normal";

      day.demandTone = "flat";
    }
  }

  const calendar = buildCalendar(days, parsedStartDate, parsedEndDate);

  /**
   * Tell the user exactly which figures are
   * still stand-in values.
   */
  let warning = null;

  if (simulatedSources.size > 0) {
    warning = `Simulated values in use for: ${[...simulatedSources].join(", ")}. Replace them by connecting the model and the external APIs.`;
  }

  return renderPredictionPage(res, 200, {
    success: `Prepared ${numberOfDays} day${numberOfDays === 1 ? "" : "s"} of prediction.`,
    warning,
    simulated: simulatedSources.size > 0,
    startDate,
    endDate,
    calendar,
  });
});

export default router;