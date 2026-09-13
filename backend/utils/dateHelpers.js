/**
 * Date helper functions.
 */

export function parseDate(dateString) {
  if (!dateString) {
    return new Date(NaN);
  }

  const parts = dateString.split("-");

  if (parts.length !== 3) {
    return new Date(NaN);
  }

  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);

  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return new Date(NaN);
  }

  return date;
}

export function formatDate(date) {
  const year = date.getUTCFullYear();

  const month = String(date.getUTCMonth() + 1).padStart(2, "0");

  const day = String(date.getUTCDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export function getTodayDate() {
  const now = new Date();

  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

export function getMinimumPredictionDate() {
  const tomorrow = getTodayDate();

  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

  return formatDate(tomorrow);
}

export function getMaximumPredictionDate() {
  const maximumDate = getTodayDate();

  maximumDate.setUTCDate(maximumDate.getUTCDate() + 15);

  return maximumDate;
}

export function getNumberOfDays(startDate, endDate) {
  const millisecondsPerDay = 1000 * 60 * 60 * 24;

  return (
    Math.floor((endDate.getTime() - startDate.getTime()) / millisecondsPerDay) +
    1
  );
}

export function createDateArray(startDate, endDate) {
  const dates = [];

  const currentDate = new Date(startDate.getTime());

  while (currentDate <= endDate) {
    dates.push(formatDate(currentDate));

    currentDate.setUTCDate(currentDate.getUTCDate() + 1);
  }

  return dates;
}
