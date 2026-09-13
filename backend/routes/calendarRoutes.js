/**
 * What this file does:
 * Handles the calendar routes.
 *
 * Shows one month at a time with the context that
 * affects demand: public holidays, local events,
 * reservations and weather.
 *
 * SIMULATION MODE
 *
 * Any source that cannot be reached is replaced with
 * a simulated value so the calendar always renders.
 * Simulated sources are named in the interface.
 *
 * Set SIMULATION_MODE=true in .env to force simulated
 * values even when the services are available.
 */

import express from "express";

import DailyReservation from "../models/DailyReservation.js";

import { getWeatherData, getEventData } from "../utils/externalApis.js";

import { getHolidayData } from "../utils/externalApis.js";

import {
  parseDate,
  formatDate,
  getTodayDate,
  createDateArray,
} from "../utils/dateHelpers.js";

const router = express.Router();

/**
 * 0 starts the week on Sunday, 1 on Monday.
 */
const WEEK_STARTS_ON = 0;

/**
 * Weather forecasts only reach this far ahead.
 */
const WEATHER_FORECAST_DAYS = 15;

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
 * GET /calendar
 *
 * Optional query values:
 *
 * month  1 to 12
 * year   four digits
 */
router.get("/", async (req, res) => {
  const today = getTodayDate();

  /**
   * Which month to show.
   */
  let year = Number(req.query.year);

  let month = Number(req.query.month);

  if (!Number.isInteger(year) || year < 1970 || year > 2100) {
    year = today.getUTCFullYear();
  }

  if (!Number.isInteger(month) || month < 1 || month > 12) {
    month = today.getUTCMonth() + 1;
  }

  const monthStart = new Date(Date.UTC(year, month - 1, 1));

  const monthEnd = new Date(Date.UTC(year, month, 0));

  const dates = createDateArray(monthStart, monthEnd);

  const forceSimulation = isSimulationForced();

  const simulatedSources = new Set();

  /**
   * Public holidays.
   */
  let holidayData = [];

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

  /**
   * Local events.
   */
  let eventData = [];

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
   * Weather, but only for the days inside the
   * forecast window.
   */
  const weatherWindowEnd = addDays(today, WEATHER_FORECAST_DAYS);

  const forecastDates = dates.filter((date) => {
    const parsed = parseDate(date);

    return parsed >= today && parsed <= weatherWindowEnd;
  });

  let weatherData = [];

  if (forecastDates.length > 0) {
    if (forceSimulation) {
      weatherData = simulateWeatherData(forecastDates);

      simulatedSources.add("weather");
    } else {
      try {
        weatherData = await getWeatherData(forecastDates);
      } catch (error) {
        console.error("Weather API error:", error);

        weatherData = simulateWeatherData(forecastDates);

        simulatedSources.add("weather");
      }
    }
  }

  /**
   * Reservations come from our own database.
   */
  let reservations = [];

  try {
    reservations = await DailyReservation.find({
      date: {
        $gte: monthStart,

        $lte: monthEnd,
      },
    }).lean();
  } catch (databaseError) {
    console.error("Failed to load reservations:", databaseError);
  }

  /**
   * Lookups keyed by date.
   */
  const holidayByDate = new Map(
    holidayData.map((item) => [item.date, item]),
  );

  const eventByDate = new Map(eventData.map((item) => [item.date, item]));

  const weatherByDate = new Map(weatherData.map((item) => [item.date, item]));

  const reservationByDate = new Map(
    reservations.map((item) => [formatDate(new Date(item.date)), item]),
  );

  const todayString = formatDate(today);

  /**
   * Build the grid, including the spill-over days
   * from the months either side.
   */
  const leadingBlanks = (monthStart.getUTCDay() - WEEK_STARTS_ON + 7) % 7;

  const gridStart = addDays(monthStart, -leadingBlanks);

  const trailingBlanks = (WEEK_STARTS_ON + 6 - monthEnd.getUTCDay() + 7) % 7;

  const gridEnd = addDays(monthEnd, trailingBlanks);

  const weeks = [];

  let cursor = gridStart;

  while (cursor <= gridEnd) {
    const week = [];

    for (let i = 0; i < 7; i++) {
      const dateString = formatDate(cursor);

      const inMonth = cursor >= monthStart && cursor <= monthEnd;

      const holiday = holidayByDate.get(dateString);

      const events = eventByDate.get(dateString);

      const weather = weatherByDate.get(dateString);

      const reservation = reservationByDate.get(dateString);

      week.push({
        date: dateString,

        dayNumber: cursor.getUTCDate(),

        inMonth: inMonth,

        isToday: dateString === todayString,

        isWeekend: cursor.getUTCDay() === 0 || cursor.getUTCDay() === 6,

        holidayName: inMonth && holiday?.public_holiday ? holiday.name : null,

        eventCount: inMonth ? Number(events?.num_of_event ?? 0) : 0,

        reservationCount: inMonth
          ? Number(reservation?.total_reservation ?? 0)
          : 0,

        guestCount: inMonth ? Number(reservation?.total_people ?? 0) : 0,

        temperature: inMonth && weather ? Number(weather.avg_temp) : null,

        rain: inMonth && weather ? Boolean(weather.rain) : false,
      });

      cursor = addDays(cursor, 1);
    }

    weeks.push(week);
  }

  /**
   * Weekday headings, rotated to the first day
   * of the week.
   */
  const weekdayNames = [];

  for (let i = 0; i < 7; i++) {
    weekdayNames.push(WEEKDAY_NAMES[(WEEK_STARTS_ON + i) % 7]);
  }

  /**
   * Month totals for the summary strip.
   */
  const monthDays = weeks.flat().filter((day) => day.inMonth);

  const totals = {
    holidayCount: monthDays.filter((day) => day.holidayName).length,

    eventCount: monthDays.reduce((total, day) => total + day.eventCount, 0),

    reservationCount: monthDays.reduce(
      (total, day) => total + day.reservationCount,
      0,
    ),

    guestCount: monthDays.reduce((total, day) => total + day.guestCount, 0),
  };

  /**
   * Previous and next month links.
   */
  const previousMonth = new Date(Date.UTC(year, month - 2, 1));

  const nextMonth = new Date(Date.UTC(year, month, 1));

  let warning = null;

  if (simulatedSources.size > 0) {
    warning = `Simulated values in use for: ${[...simulatedSources].join(", ")}. Replace them by connecting the external APIs.`;
  }

  return res.render("calendar", {
    warning: warning,

    simulated: simulatedSources.size > 0,

    monthLabel: MONTH_NAMES[month - 1],

    yearLabel: String(year),

    weekdayNames: weekdayNames,

    weeks: weeks,

    totals: totals,

    previousLink: `/calendar?month=${previousMonth.getUTCMonth() + 1}&year=${previousMonth.getUTCFullYear()}`,

    nextLink: `/calendar?month=${nextMonth.getUTCMonth() + 1}&year=${nextMonth.getUTCFullYear()}`,

    todayLink: `/calendar?month=${today.getUTCMonth() + 1}&year=${today.getUTCFullYear()}`,
  });
});

export default router;
