/**
 * What this file does:
 * Handles the reservation list routes.
 *
 * Shows how many bookings and guests are
 * expected on each of the next following days.
 */

import express from "express";

import DailyReservation from "../models/DailyReservation.js";

import {
  parseDate,
  formatDate,
  getTodayDate,
  createDateArray,
} from "../utils/dateHelpers.js";

const router = express.Router();

/**
 * How many days are shown by default.
 */
const DEFAULT_NUMBER_OF_DAYS = 7;

/**
 * Day range options offered in the form.
 */
const NUMBER_OF_DAYS_OPTIONS = [3, 7, 14, 30];

const MINIMUM_NUMBER_OF_DAYS = 1;

const MAXIMUM_NUMBER_OF_DAYS = 30;

/**
 * Return the weekday name for a date string.
 *
 * Dates are stored at UTC midnight,
 * so the weekday is read in UTC.
 */
function getWeekdayName(dateString) {
  const date = parseDate(dateString);

  return date.toLocaleDateString("en-AU", {
    weekday: "long",

    timeZone: "UTC",
  });
}

/**
 * Add a number of days to a date.
 */
function addDays(date, numberOfDays) {
  const newDate = new Date(date.getTime());

  newDate.setUTCDate(newDate.getUTCDate() + numberOfDays);

  return newDate;
}

/**
 * Decide how busy a day is compared with
 * the busiest day in the selected range.
 *
 * This is only used for the label shown
 * to the restaurant manager.
 */
function getBusynessLevel(totalPeople, busiestDayTotalPeople) {
  if (totalPeople === 0) {
    return "none";
  }

  if (busiestDayTotalPeople === 0) {
    return "none";
  }

  const share = totalPeople / busiestDayTotalPeople;

  if (share >= 0.8) {
    return "high";
  }

  if (share >= 0.5) {
    return "medium";
  }

  return "low";
}

/**
 * GET /reservations
 *
 * Optional query values:
 *
 * startDate  first day shown, defaults to today
 * days       how many days are shown, defaults to 7
 */
router.get("/", async (req, res) => {
  const requestedStartDate = req.query.startDate;

  const requestedNumberOfDays = req.query.days;

  let error = null;

  /**
   * Work out the first day of the list.
   */
  let startDate = getTodayDate();

  if (requestedStartDate) {
    const parsedStartDate = parseDate(requestedStartDate);

    if (Number.isNaN(parsedStartDate.getTime())) {
      error = "Please enter a valid start date. Showing today instead.";
    } else {
      startDate = parsedStartDate;
    }
  }

  /**
   * Work out how many days to show.
   */
  let numberOfDays = DEFAULT_NUMBER_OF_DAYS;

  if (requestedNumberOfDays) {
    const parsedNumberOfDays = Number(requestedNumberOfDays);

    if (
      !Number.isInteger(parsedNumberOfDays) ||
      parsedNumberOfDays < MINIMUM_NUMBER_OF_DAYS ||
      parsedNumberOfDays > MAXIMUM_NUMBER_OF_DAYS
    ) {
      error = `Number of days must be between ${MINIMUM_NUMBER_OF_DAYS} and ${MAXIMUM_NUMBER_OF_DAYS}. Showing ${DEFAULT_NUMBER_OF_DAYS} days instead.`;
    } else {
      numberOfDays = parsedNumberOfDays;
    }
  }

  const endDate = addDays(startDate, numberOfDays - 1);

  /**
   * Every date in the range, including days
   * that have no reservation record.
   */
  const dates = createDateArray(startDate, endDate);

  let reservations = [];

  try {
    reservations = await DailyReservation.find({
      date: {
        $gte: startDate,

        $lte: endDate,
      },
    })
      .sort({
        date: 1,
      })
      .lean();
  } catch (databaseError) {
    console.error("Failed to load reservations:", databaseError);

    return res.status(500).render("reservations", {
      error: "Could not load reservations from the database.",

      startDate: formatDate(startDate),

      endDate: formatDate(endDate),

      numberOfDays: numberOfDays,

      numberOfDaysOptions: NUMBER_OF_DAYS_OPTIONS,

      today: formatDate(getTodayDate()),

      days: [],

      totals: {
        totalReservation: 0,

        totalPeople: 0,

        daysWithReservations: 0,

        averagePeoplePerDay: 0,
      },
    });
  }

  /**
   * Put the reservations in a lookup keyed
   * by date so each day can find its record.
   */
  const reservationByDate = new Map();

  for (const reservation of reservations) {
    reservationByDate.set(formatDate(new Date(reservation.date)), reservation);
  }

  /**
   * The busiest day is used to label the
   * relative demand of the other days.
   */
  let busiestDayTotalPeople = 0;

  for (const reservation of reservations) {
    if (reservation.total_people > busiestDayTotalPeople) {
      busiestDayTotalPeople = reservation.total_people;
    }
  }

  const todayString = formatDate(getTodayDate());

  /**
   * Build one row for every day in the range.
   */
  const days = dates.map((dateString) => {
    const reservation = reservationByDate.get(dateString);

    const totalReservation = reservation?.total_reservation ?? 0;

    const totalPeople = reservation?.total_people ?? 0;

    const averagePartySize =
      totalReservation > 0
        ? Number((totalPeople / totalReservation).toFixed(1))
        : 0;

    return {
      date: dateString,

      weekday: getWeekdayName(dateString),

      isToday: dateString === todayString,

      hasReservationRecord: Boolean(reservation),

      reservationId: reservation?._id ?? null,

      totalReservation: totalReservation,

      totalPeople: totalPeople,

      averagePartySize: averagePartySize,

      busynessLevel: getBusynessLevel(totalPeople, busiestDayTotalPeople),
    };
  });

  /**
   * Range totals shown above the table.
   */
  const totalReservation = days.reduce(
    (runningTotal, day) => runningTotal + day.totalReservation,
    0,
  );

  const totalPeople = days.reduce(
    (runningTotal, day) => runningTotal + day.totalPeople,
    0,
  );

  const daysWithReservations = days.filter(
    (day) => day.totalReservation > 0,
  ).length;

  const averagePeoplePerDay =
    daysWithReservations > 0
      ? Number((totalPeople / daysWithReservations).toFixed(1))
      : 0;

  return res.render("reservations", {
    error: error,

    startDate: formatDate(startDate),

    endDate: formatDate(endDate),

    numberOfDays: numberOfDays,

    numberOfDaysOptions: NUMBER_OF_DAYS_OPTIONS,

    today: todayString,

    days: days,

    totals: {
      totalReservation: totalReservation,

      totalPeople: totalPeople,

      daysWithReservations: daysWithReservations,

      averagePeoplePerDay: averagePeoplePerDay,
    },
  });
});

export default router;
