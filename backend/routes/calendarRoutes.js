/**
 * What this file does:
 * Handles the calendar routes.
 *
 * Shows one month at a time with the real context
 * that can affect demand:
 *
 * - Public holidays: Nager.Date
 * - Local events: Ticketmaster
 * - Reservations: MongoDB
 * - Weather: Open-Meteo
 *
 * No simulated values are used.
 */

import express from "express";

import DailyReservation from "../models/DailyReservation.js";

import {
  getWeatherData,
  getHolidayData,
  getEventData,
} from "../utils/externalApis.js";

import {
  parseDate,
  formatDate,
  getTodayDate,
  createDateArray,
} from "../utils/dateHelpers.js";

const router = express.Router();

/**
 * 0 = Sunday
 * 1 = Monday
 */
const WEEK_STARTS_ON = 0;

/**
 * Open-Meteo provides 16 forecast days
 * including today.
 *
 * Therefore:
 *
 * today + 15 days
 *
 * is the final available forecast date.
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
 * --------------------------------------------------
 * ADD DAYS
 * --------------------------------------------------
 */
function addDays(
  date,
  numberOfDays,
) {
  const newDate =
    new Date(
      date.getTime(),
    );

  newDate.setUTCDate(
    newDate.getUTCDate() +
      numberOfDays,
  );

  return newDate;
}

/**
 * --------------------------------------------------
 * BUILD MONTH LINKS
 * --------------------------------------------------
 */
function buildMonthLinks(
  year,
  month,
  today,
) {
  const previousMonth =
    new Date(
      Date.UTC(
        year,
        month - 2,
        1,
      ),
    );

  const nextMonth =
    new Date(
      Date.UTC(
        year,
        month,
        1,
      ),
    );

  return {
    previousLink:
      `/calendar?month=${
        previousMonth.getUTCMonth() + 1
      }&year=${
        previousMonth.getUTCFullYear()
      }`,

    nextLink:
      `/calendar?month=${
        nextMonth.getUTCMonth() + 1
      }&year=${
        nextMonth.getUTCFullYear()
      }`,

    todayLink:
      `/calendar?month=${
        today.getUTCMonth() + 1
      }&year=${
        today.getUTCFullYear()
      }`,
  };
}

/**
 * --------------------------------------------------
 * RENDER CALENDAR ERROR
 * --------------------------------------------------
 *
 * Keeps the existing calendar page usable if
 * a real API or database source fails.
 *
 * No fake data is inserted.
 */
function renderCalendarError(
  res,
  statusCode,
  message,
  year,
  month,
  today,
) {
  const links =
    buildMonthLinks(
      year,
      month,
      today,
    );

  return res
    .status(statusCode)
    .render(
      "calendar",
      {
        /**
         * Keep warning because the existing
         * calendar view already uses it.
         */
        warning:
          message,

        /**
         * Simulation no longer exists.
         */
        simulated:
          false,

        monthLabel:
          MONTH_NAMES[
            month - 1
          ],

        yearLabel:
          String(year),

        weekdayNames:
          WEEKDAY_NAMES,

        weeks:
          [],

        totals: {
          holidayCount:
            0,

          eventCount:
            0,

          reservationCount:
            0,

          guestCount:
            0,
        },

        previousLink:
          links.previousLink,

        nextLink:
          links.nextLink,

        todayLink:
          links.todayLink,
      },
    );
}

/**
 * ==================================================
 * GET /calendar
 * ==================================================
 *
 * Optional query values:
 *
 * month = 1 to 12
 * year  = four digits
 */
router.get(
  "/",
  async (
    req,
    res,
  ) => {
    const today =
      getTodayDate();

    /**
     * ------------------------------------------------
     * CHOOSE MONTH
     * ------------------------------------------------
     */
    let year =
      Number(
        req.query.year,
      );

    let month =
      Number(
        req.query.month,
      );

    /**
     * Invalid year:
     * use current year.
     */
    if (
      !Number.isInteger(
        year,
      ) ||
      year < 1970 ||
      year > 2100
    ) {
      year =
        today.getUTCFullYear();
    }

    /**
     * Invalid month:
     * use current month.
     */
    if (
      !Number.isInteger(
        month,
      ) ||
      month < 1 ||
      month > 12
    ) {
      month =
        today.getUTCMonth() +
        1;
    }

    /**
     * First day of selected month.
     */
    const monthStart =
      new Date(
        Date.UTC(
          year,
          month - 1,
          1,
        ),
      );

    /**
     * Last day of selected month.
     */
    const monthEnd =
      new Date(
        Date.UTC(
          year,
          month,
          0,
        ),
      );

    /**
     * Example:
     *
     * [
     *   "2026-09-01",
     *   "2026-09-02",
     *   ...
     *   "2026-09-30"
     * ]
     */
    const dates =
      createDateArray(
        monthStart,
        monthEnd,
      );

    /**
     * ==================================================
     * REAL PUBLIC HOLIDAY DATA
     * ==================================================
     */
    let holidayData;

    try {
      holidayData =
        await getHolidayData(
          dates,
        );
    } catch (error) {
      console.error(
        "Public holiday API error:",
        error,
      );

      return renderCalendarError(
        res,
        500,
        `Could not retrieve public holiday data: ${error.message}`,
        year,
        month,
        today,
      );
    }

    /**
     * ==================================================
     * REAL TICKETMASTER EVENT DATA
     * ==================================================
     */
    let eventData;

    try {
      eventData =
        await getEventData(
          dates,
        );
    } catch (error) {
      console.error(
        "Ticketmaster API error:",
        error,
      );

      return renderCalendarError(
        res,
        500,
        `Could not retrieve event data: ${error.message}`,
        year,
        month,
        today,
      );
    }

    /**
     * ==================================================
     * REAL WEATHER DATA
     * ==================================================
     *
     * Open-Meteo only provides weather forecasts
     * for the available forecast window.
     *
     * We DO NOT create fake weather for dates
     * outside that range.
     *
     * Those dates simply have:
     *
     * temperature = null
     * rain = false
     */
    const weatherWindowEnd =
      addDays(
        today,
        WEATHER_FORECAST_DAYS,
      );

    const forecastDates =
      dates.filter(
        (date) => {
          const parsed =
            parseDate(
              date,
            );

          return (
            parsed >= today &&
            parsed <=
              weatherWindowEnd
          );
        },
      );

    let weatherData = [];

    if (
      forecastDates.length >
      0
    ) {
      try {
        weatherData =
          await getWeatherData(
            forecastDates,
          );
      } catch (error) {
        console.error(
          "Weather API error:",
          error,
        );

        return renderCalendarError(
          res,
          500,
          `Could not retrieve weather data: ${error.message}`,
          year,
          month,
          today,
        );
      }
    }

    /**
     * ==================================================
     * REAL RESERVATIONS FROM MONGODB
     * ==================================================
     */
    let reservations;

    try {
      reservations =
        await DailyReservation
          .find({
            date: {
              $gte:
                monthStart,

              $lte:
                monthEnd,
            },
          })
          .lean();
    } catch (
      databaseError
    ) {
      console.error(
        "Failed to load reservations:",
        databaseError,
      );

      return renderCalendarError(
        res,
        500,
        "Could not retrieve reservation data from the database.",
        year,
        month,
        today,
      );
    }

    /**
     * ==================================================
     * CREATE DATE LOOKUPS
     * ==================================================
     *
     * This lets us quickly find information
     * belonging to one particular date.
     */
    const holidayByDate =
      new Map(
        holidayData.map(
          (item) => [
            item.date,
            item,
          ],
        ),
      );

    const eventByDate =
      new Map(
        eventData.map(
          (item) => [
            item.date,
            item,
          ],
        ),
      );

    const weatherByDate =
      new Map(
        weatherData.map(
          (item) => [
            item.date,
            item,
          ],
        ),
      );

    const reservationByDate =
      new Map(
        reservations.map(
          (item) => [
            formatDate(
              new Date(
                item.date,
              ),
            ),

            item,
          ],
        ),
      );

    const todayString =
      formatDate(
        today,
      );

    /**
     * ==================================================
     * BUILD CALENDAR GRID
     * ==================================================
     */

    /**
     * How many empty days are required
     * before the first of the month.
     */
    const leadingBlanks =
      (
        monthStart.getUTCDay() -
        WEEK_STARTS_ON +
        7
      ) %
      7;

    const gridStart =
      addDays(
        monthStart,
        -leadingBlanks,
      );

    /**
     * How many days are needed after the
     * end of the month to finish the week.
     */
    const trailingBlanks =
      (
        WEEK_STARTS_ON +
        6 -
        monthEnd.getUTCDay() +
        7
      ) %
      7;

    const gridEnd =
      addDays(
        monthEnd,
        trailingBlanks,
      );

    const weeks = [];

    let cursor =
      gridStart;

    while (
      cursor <= gridEnd
    ) {
      const week = [];

      for (
        let i = 0;
        i < 7;
        i++
      ) {
        const dateString =
          formatDate(
            cursor,
          );

        const inMonth =
          cursor >=
            monthStart &&
          cursor <=
            monthEnd;

        /**
         * Real API/database values.
         */
        const holiday =
          holidayByDate.get(
            dateString,
          );

        const events =
          eventByDate.get(
            dateString,
          );

        const weather =
          weatherByDate.get(
            dateString,
          );

        const reservation =
          reservationByDate.get(
            dateString,
          );

        /**
         * ------------------------------------------------
         * BUILD ONE CALENDAR DAY
         * ------------------------------------------------
         */
        week.push({
          date:
            dateString,

          dayNumber:
            cursor.getUTCDate(),

          inMonth:
            inMonth,

          isToday:
            dateString ===
            todayString,

          isWeekend:
            cursor.getUTCDay() ===
              0 ||
            cursor.getUTCDay() ===
              6,

          /**
           * Real Nager.Date holiday.
           */
          holidayName:
            inMonth &&
            holiday
              ?.public_holiday
              ? holiday.name
              : null,

          /**
           * Real Ticketmaster event count.
           *
           * 0 means Ticketmaster returned
           * no events for that date.
           */
          eventCount:
            inMonth
              ? Number(
                  events
                    ?.num_of_event ??
                    0,
                )
              : 0,

          /**
           * Real MongoDB reservation count.
           *
           * No reservation record means
           * zero recorded reservations.
           */
          reservationCount:
            inMonth
              ? Number(
                  reservation
                    ?.total_reservation ??
                    0,
                )
              : 0,

          /**
           * Real number of booked guests.
           */
          guestCount:
            inMonth
              ? Number(
                  reservation
                    ?.total_people ??
                    0,
                )
              : 0,

          /**
           * Real Open-Meteo forecast.
           *
           * null means the date is outside
           * the available forecast window.
           */
          temperature:
            inMonth &&
            weather
              ? Number(
                  weather.avg_temp,
                )
              : null,

          /**
           * Only meaningful when weather
           * data exists.
           */
          rain:
            inMonth &&
            weather
              ? Boolean(
                  weather.rain,
                )
              : false,

          /**
           * Allows the view to distinguish:
           *
           * "Dry"
           *
           * from:
           *
           * "Weather unavailable"
           */
          weatherAvailable:
            Boolean(
              inMonth &&
              weather,
            ),
        });

        cursor =
          addDays(
            cursor,
            1,
          );
      }

      weeks.push(
        week,
      );
    }

    /**
     * ==================================================
     * WEEKDAY HEADINGS
     * ==================================================
     */
    const weekdayNames =
      [];

    for (
      let i = 0;
      i < 7;
      i++
    ) {
      weekdayNames.push(
        WEEKDAY_NAMES[
          (
            WEEK_STARTS_ON +
            i
          ) %
            7
        ],
      );
    }

    /**
     * ==================================================
     * MONTH SUMMARY
     * ==================================================
     */
    const monthDays =
      weeks
        .flat()
        .filter(
          (day) =>
            day.inMonth,
        );

    const totals = {
      /**
       * Number of public-holiday days.
       */
      holidayCount:
        monthDays.filter(
          (day) =>
            day.holidayName,
        ).length,

      /**
       * Total Ticketmaster events
       * across the month.
       */
      eventCount:
        monthDays.reduce(
          (
            total,
            day,
          ) =>
            total +
            day.eventCount,
          0,
        ),

      /**
       * Total reservation records.
       */
      reservationCount:
        monthDays.reduce(
          (
            total,
            day,
          ) =>
            total +
            day.reservationCount,
          0,
        ),

      /**
       * Total booked guests.
       */
      guestCount:
        monthDays.reduce(
          (
            total,
            day,
          ) =>
            total +
            day.guestCount,
          0,
        ),

      /**
       * Number of days for which real
       * forecast data is available.
       */
      weatherDays:
        monthDays.filter(
          (day) =>
            day.weatherAvailable,
        ).length,

      /**
       * Number of forecast days with rain.
       */
      rainDays:
        monthDays.filter(
          (day) =>
            day.weatherAvailable &&
            day.rain,
        ).length,
    };

    /**
     * ==================================================
     * PREVIOUS / NEXT / TODAY LINKS
     * ==================================================
     */
    const links =
      buildMonthLinks(
        year,
        month,
        today,
      );

    /**
     * ==================================================
     * RENDER CALENDAR
     * ==================================================
     */
    return res.render(
      "calendar",
      {
        /**
         * No simulation warning.
         */
        warning:
          null,

        simulated:
          false,

        monthLabel:
          MONTH_NAMES[
            month - 1
          ],

        yearLabel:
          String(
            year,
          ),

        weekdayNames:
          weekdayNames,

        weeks:
          weeks,

        totals:
          totals,

        previousLink:
          links.previousLink,

        nextLink:
          links.nextLink,

        todayLink:
          links.todayLink,
      },
    );
  },
);

export default router;