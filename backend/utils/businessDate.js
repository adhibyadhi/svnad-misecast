/**
 * Utilities for restaurant business dates.
 *
 * Business dates remain YYYY-MM-DD strings.
 * UTC is used only for calendar arithmetic, not to reinterpret
 * a restaurant business date as an actual event timestamp.
 */

import { RequestValidationError } from "./requestValidation.js";

const millisecondsPerDay = 24 * 60 * 60 * 1000;

/**
 * Validates and returns a YYYY-MM-DD calendar date.
 */
export function requireBusinessDate(value, fieldName = "date") {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new RequestValidationError(
      `${fieldName} must use YYYY-MM-DD format.`,
    );
  }

  const parsedDate = new Date(`${value}T00:00:00.000Z`);

  if (
    Number.isNaN(parsedDate.getTime()) ||
    parsedDate.toISOString().slice(0, 10) !== value
  ) {
    throw new RequestValidationError(
      `${fieldName} must be a valid calendar date.`,
    );
  }

  return value;
}

/**
 * Adds whole calendar days, including across month and year boundaries.
 */
export function addBusinessDays(businessDate, numberOfDays) {
  requireBusinessDate(businessDate);

  if (!Number.isSafeInteger(numberOfDays)) {
    throw new Error("The number of days must be a safe whole number.");
  }

  const parsedDate = new Date(`${businessDate}T00:00:00.000Z`);
  parsedDate.setUTCDate(parsedDate.getUTCDate() + numberOfDays);

  if (Number.isNaN(parsedDate.getTime())) {
    throw new Error("The resulting date is outside the supported range.");
  }

  const result = parsedDate.toISOString().slice(0, 10);

  // Keep the four-digit year contract.
  return requireBusinessDate(result, "resulting date");
}

/**
 * Returns end date minus start date in calendar days.
 *
 * The result can be negative, such as for an expired batch.
 */
export function differenceInBusinessDays(startDate, endDate) {
  requireBusinessDate(startDate, "startDate");
  requireBusinessDate(endDate, "endDate");

  const startTimestamp = Date.parse(`${startDate}T00:00:00.000Z`);
  const endTimestamp = Date.parse(`${endDate}T00:00:00.000Z`);

  return (endTimestamp - startTimestamp) / millisecondsPerDay;
}

/**
 * Converts an actual instant to a business date in the restaurant timezone.
 *
 * The timezone must come from configuration, not the computer's timezone.
 */
export function getBusinessDate(timezone, instant = new Date()) {
  if (typeof timezone !== "string" || timezone.trim() === "") {
    throw new Error("A restaurant timezone is required.");
  }

  if (!(instant instanceof Date) || Number.isNaN(instant.getTime())) {
    throw new Error("A valid Date instance is required.");
  }

  const formatter = new Intl.DateTimeFormat("en", {
    timeZone: timezone,
    calendar: "gregory",
    numberingSystem: "latn",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const dateParts = {};

  for (const part of formatter.formatToParts(instant)) {
    if (["year", "month", "day"].includes(part.type)) {
      dateParts[part.type] = part.value;
    }
  }

  return requireBusinessDate(
    `${dateParts.year.padStart(4, "0")}-${dateParts.month}-${dateParts.day}`,
  );
}

/**
 * Returns next Monday through Sunday relative to a business date.
 *
 * If the supplied date is Monday, this returns the following week.
 */
export function getNextWeekRange(businessDate) {
  requireBusinessDate(businessDate);

  const weekday = new Date(`${businessDate}T00:00:00.000Z`).getUTCDay();

  const daysUntilMonday = (8 - weekday) % 7 || 7;
  const startDate = addBusinessDays(businessDate, daysUntilMonday);

  return {
    startDate,
    endDate: addBusinessDays(startDate, 6),
  };
}
