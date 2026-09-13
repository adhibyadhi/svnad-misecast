import { Reservation } from "../models/index.js";
import { restaurant } from "../config/restaurant.js";
import {
  addBusinessDays,
  getBusinessDate,
  requireBusinessDate,
} from "../utils/businessDate.js";
import {
  RequestValidationError,
  requireText,
  selectAllowedFields,
} from "../utils/requestValidation.js";
import mongoose from "mongoose";
import { createHash } from "node:crypto";

const editableFields = [
  "date",
  "service_period",
  "bookings_count",
  "reserved_covers",
  "cancelled_covers",
  "confirmed_covers",
];

export class ReservationConflictError extends Error {
  constructor() {
    super(
      "A forecast reservation record already exists for this date and service period.",
    );
    this.name = "ReservationConflictError";
  }
}

function readWholeNumber(value, fieldName, required = false) {
  if (value === undefined || value === "") {
    if (required) {
      throw new RequestValidationError(`${fieldName} is required.`);
    }

    return null;
  }

  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new RequestValidationError(
      `${fieldName} must be a non-negative whole number.`,
    );
  }

  const number = Number(value);

  if (!Number.isSafeInteger(number)) {
    throw new RequestValidationError(`${fieldName} is too large.`);
  }

  return number;
}

export async function getReservationOverview() {
  const today = getBusinessDate(restaurant.timezone);
  const lastDate = addBusinessDays(today, 13);

  const [rows, servicePeriods] = await Promise.all([
    Reservation.find({
      record_type: "forecast",
      date: { $gte: today, $lte: lastDate },
    })
      .sort({ date: 1, service_period: 1 })
      .lean(),

    Reservation.distinct("service_period"),
  ]);

  return {
    today,
    lastDate,
    rows,
    servicePeriods: servicePeriods
      .filter((value) => typeof value === "string" && value.trim())
      .sort(),
  };
}

export async function createReservationForecast(input) {
  const fields = selectAllowedFields(input, editableFields);
  const today = getBusinessDate(restaurant.timezone);

  const date = requireBusinessDate(fields.date);
  const servicePeriod = requireText(
    fields.service_period,
    "service_period",
    80,
  );

  if (date < today) {
    throw new RequestValidationError(
      "Use today or a future date for a forecast reservation record.",
    );
  }

  const bookingsCount = readWholeNumber(
    fields.bookings_count,
    "bookings_count",
  );

  const reservedCovers = readWholeNumber(
    fields.reserved_covers,
    "reserved_covers",
  );

  const cancelledCovers = readWholeNumber(
    fields.cancelled_covers,
    "cancelled_covers",
  );

  const confirmedCovers = readWholeNumber(
    fields.confirmed_covers,
    "confirmed_covers",
    true,
  );

  // These checks do not assume that every remaining cover is confirmed.
  if (reservedCovers !== null && confirmedCovers > reservedCovers) {
    throw new RequestValidationError(
      "Confirmed covers cannot exceed reserved covers.",
    );
  }

  if (
    reservedCovers !== null &&
    cancelledCovers !== null &&
    confirmedCovers + cancelledCovers > reservedCovers
  ) {
    throw new RequestValidationError(
      "Confirmed and cancelled covers together cannot exceed reserved covers.",
    );
  }

  try {
    return await Reservation.create({
      date,
      service_period: servicePeriod,
      record_type: "forecast",
      bookings_count: bookingsCount,
      reserved_covers: reservedCovers,
      cancellation_rate_pct: null,
      cancelled_covers: cancelledCovers,
      confirmed_covers: confirmedCovers,
      walk_in_covers_actual: null,
      data_snapshot_date: today,
      is_synthetic: false,
    });
  } catch (error) {
    if (error?.code === 11000) {
      throw new ReservationConflictError();
    }

    throw error;
  }
}

export class ReservationEditError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "ReservationEditError";
    this.status = status;
  }
}

function requireReservationId(value) {
  if (typeof value !== "string" || !/^[a-f\d]{24}$/i.test(value)) {
    throw new ReservationEditError("Reservation record not found.", 404);
  }

  return value;
}

function getReservationRevision(record) {
  const fields = [
    "_id",
    "date",
    "service_period",
    "record_type",
    "bookings_count",
    "reserved_covers",
    "cancellation_rate_pct",
    "cancelled_covers",
    "confirmed_covers",
    "walk_in_covers_actual",
    "data_snapshot_date",
    "is_synthetic",
  ];

  const values = fields.map((field) => {
    const value = record.get(field);
    return [field, value == null ? null : String(value)];
  });

  return createHash("sha256").update(JSON.stringify(values)).digest("hex");
}

function assertReservationEditable(record) {
  if (!record || record.record_type !== "forecast") {
    throw new ReservationEditError("Reservation record not found.", 404);
  }

  if (record.date < getBusinessDate(restaurant.timezone)) {
    throw new ReservationEditError(
      "Past reservation records cannot be edited through this form.",
      409,
    );
  }
}

export async function getReservationEditData(id) {
  requireReservationId(id);

  const record = await Reservation.findById(id);
  assertReservationEditable(record);

  return {
    id: String(record._id),
    date: record.date,
    service_period: record.service_period,
    is_synthetic: record.is_synthetic,
    revision: getReservationRevision(record),
    bookings_count: record.bookings_count ?? "",
    reserved_covers: record.reserved_covers ?? "",
    cancelled_covers: record.cancelled_covers ?? "",
    confirmed_covers: record.confirmed_covers ?? "",
  };
}

export async function updateReservationForecast(id, input) {
  requireReservationId(id);

  const fields = selectAllowedFields(input, [
    "revision",
    "bookings_count",
    "reserved_covers",
    "cancelled_covers",
    "confirmed_covers",
  ]);

  if (
    typeof fields.revision !== "string" ||
    !/^[a-f\d]{64}$/.test(fields.revision)
  ) {
    throw new RequestValidationError(
      "The edit revision is missing or invalid. Reload the edit page.",
    );
  }

  const bookingsCount = readWholeNumber(
    fields.bookings_count,
    "bookings_count",
  );

  const reservedCovers = readWholeNumber(
    fields.reserved_covers,
    "reserved_covers",
  );

  const cancelledCovers = readWholeNumber(
    fields.cancelled_covers,
    "cancelled_covers",
  );

  const confirmedCovers = readWholeNumber(
    fields.confirmed_covers,
    "confirmed_covers",
    true,
  );

  if (reservedCovers !== null && confirmedCovers > reservedCovers) {
    throw new RequestValidationError(
      "Confirmed covers cannot exceed reserved covers.",
    );
  }

  if (
    reservedCovers !== null &&
    cancelledCovers !== null &&
    confirmedCovers > reservedCovers - cancelledCovers
  ) {
    throw new RequestValidationError(
      "Confirmed and cancelled covers together cannot exceed reserved covers.",
    );
  }

  await mongoose.connection.transaction(async (session) => {
    const record = await Reservation.findById(id).session(session);
    assertReservationEditable(record);

    if (getReservationRevision(record) !== fields.revision) {
      throw new ReservationEditError(
        "This record changed after you opened it. Reload the latest values before editing again.",
        409,
      );
    }

    record.bookings_count = bookingsCount;
    record.reserved_covers = reservedCovers;
    record.cancelled_covers = cancelledCovers;
    record.confirmed_covers = confirmedCovers;

    // A previously imported rate may no longer match the edited totals.
    record.cancellation_rate_pct = null;

    record.data_snapshot_date = getBusinessDate(restaurant.timezone);

    await record.save({ session });
  });
}
