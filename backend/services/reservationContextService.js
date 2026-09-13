import { HistoricalSale, Reservation } from "../models/index.js";
import { restaurant } from "../config/restaurant.js";
import {
  addBusinessDays,
  getBusinessDate,
  requireBusinessDate,
} from "../utils/businessDate.js";

function inspectRecord(record, asOfDate) {
  if (!record) {
    return {
      status: "missing",
      usable: false,
      confirmed_reservation_covers: null,
      saved_confirmed_covers: null,
      data_snapshot_date: null,
      is_synthetic: null,
    };
  }

  let snapshotValid = false;

  try {
    requireBusinessDate(record.data_snapshot_date);

    snapshotValid =
      record.data_snapshot_date <= asOfDate &&
      record.data_snapshot_date <= record.date;
  } catch {
    snapshotValid = false;
  }

  const confirmed = record.confirmed_covers;
  const reserved = record.reserved_covers;
  const cancelled = record.cancelled_covers;

  const validCount = (value) => Number.isSafeInteger(value) && value >= 0;

  const totalsValid =
    validCount(confirmed) &&
    (reserved == null || validCount(reserved)) &&
    (cancelled == null || validCount(cancelled)) &&
    (reserved == null || confirmed <= reserved) &&
    (reserved == null ||
      cancelled == null ||
      confirmed <= reserved - cancelled);

  let status;

  if (!snapshotValid || !totalsValid) {
    status = "invalid";
  } else if (record.is_synthetic !== false) {
    status = "synthetic";
  } else if (record.data_snapshot_date !== asOfDate) {
    status = "needs_review";
  } else {
    status = "fresh";
  }

  return {
    status,
    usable: status === "fresh",
    confirmed_reservation_covers: status === "fresh" ? confirmed : null,
    saved_confirmed_covers: confirmed ?? null,
    data_snapshot_date: record.data_snapshot_date ?? null,
    is_synthetic: record.is_synthetic ?? null,
  };
}

export async function getReservationContext(
  dateStart,
  dateEnd,
  asOfDate = getBusinessDate(restaurant.timezone),
) {
  requireBusinessDate(dateStart);
  requireBusinessDate(dateEnd);
  requireBusinessDate(asOfDate);

  if (dateEnd < dateStart) {
    throw new Error("Reservation context date range is invalid.");
  }

  const [records, salesServicePeriods] = await Promise.all([
    Reservation.find({
      record_type: "forecast",
      date: { $gte: dateStart, $lte: dateEnd },
    }).lean(),

    HistoricalSale.distinct("service_period", {
      restaurant_id: restaurant.restaurantId,
    }),
  ]);

  // Use existing labels instead of inventing lunch/dinner encodings.
  const servicePeriods = [
    ...new Set([
      ...salesServicePeriods,
      ...records.map((record) => record.service_period),
    ]),
  ]
    .filter((value) => typeof value === "string" && value.trim())
    .sort();

  const recordsByKey = new Map(
    records.map((record) => [
      JSON.stringify([record.date, record.service_period]),
      record,
    ]),
  );

  const days = [];

  for (let date = dateStart; date <= dateEnd; date = addBusinessDays(date, 1)) {
    days.push({
      date,
      services: servicePeriods.map((servicePeriod) => ({
        service_period: servicePeriod,
        ...inspectRecord(
          recordsByKey.get(JSON.stringify([date, servicePeriod])),
          asOfDate,
        ),
      })),
    });
  }

  return {
    as_of_date: asOfDate,
    service_periods: servicePeriods,
    service_periods_known: servicePeriods.length > 0,
    days,
  };
}
