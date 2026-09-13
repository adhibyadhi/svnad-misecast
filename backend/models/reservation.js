/**
 * Stores reservation summaries by date, service and record type.
 *
 * Preserves the source composite key:
 * date + service_period + record_type.
 */

import mongoose from "mongoose";
import {
  createWholeNumberField,
  createDecimalField,
  createBusinessDateField,
} from "./schemaHelpers.js";

const reservationSchema = new mongoose.Schema(
  {
    date: createBusinessDateField({ required: true }),

    service_period: {
      type: String,
      required: [true, "Service period is required."],
      trim: true,
    },

    record_type: {
      type: String,
      required: [true, "Reservation record type is required."],
      enum: {
        values: ["actual", "forecast"],
        message: "Reservation record type must be actual or forecast.",
      },
    },

    // Booking count and cover count are different:
    // one booking can include several guests.
    bookings_count: createWholeNumberField(),

    reserved_covers: createWholeNumberField(),

    cancellation_rate_pct: createDecimalField({
      minimum: 0,
      maximum: 100,
    }),

    cancelled_covers: createWholeNumberField(),

    confirmed_covers: createWholeNumberField(),

    // Actual walk-ins are unknown for future services.
    walk_in_covers_actual: createWholeNumberField(),

    // Date when this reservation summary was captured.
    data_snapshot_date: createBusinessDateField(),

    is_synthetic: {
      type: Boolean,
      required: [true, "Synthetic data status is required."],
    },
  },
  {
    collection: "reservations",
    strict: "throw",
    versionKey: false,
  },
);

reservationSchema.index(
  {
    date: 1,
    service_period: 1,
    record_type: 1,
  },
  { unique: true },
);

const Reservation = mongoose.model("Reservation", reservationSchema);

export default Reservation;
