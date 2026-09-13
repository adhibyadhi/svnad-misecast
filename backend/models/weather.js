/**
 * Stores daily actual or forecast weather.
 *
 * Preserves the source key: date + record_type.
 * This collection supports the single configured restaurant location.
 */

import mongoose from "mongoose";
import {
  createWholeNumberField,
  createDecimalField,
  createBusinessDateField,
} from "./schemaHelpers.js";

const weatherSchema = new mongoose.Schema(
  {
    date: createBusinessDateField({ required: true }),

    // These values are explicitly defined in the supplied source schema.
    record_type: {
      type: String,
      required: [true, "Weather record type is required."],
      enum: {
        values: ["actual", "forecast"],
        message: "Weather record type must be actual or forecast.",
      },
    },

    // Temperatures may be negative.
    minimum_temperature_c: createDecimalField(),

    maximum_temperature_c: createDecimalField(),

    average_temperature_c: createDecimalField(),

    rain_probability_pct: createDecimalField({
      minimum: 0,
      maximum: 100,
    }),

    rainfall_mm: createDecimalField({ minimum: 0 }),

    // Preserve source labels until provider/model mappings are verified.
    condition: {
      type: String,
      trim: true,
      default: null,
    },

    // Unknown until the model's hot/cold thresholds are confirmed.
    is_hot_day: {
      type: Boolean,
      default: null,
    },

    is_cold_day: {
      type: Boolean,
      default: null,
    },

    forecast_horizon_days: createWholeNumberField(),

    location: {
      type: String,
      trim: true,
      default: null,
    },

    is_synthetic: {
      type: Boolean,
      required: [true, "Synthetic data status is required."],
    },
  },
  {
    collection: "weather",
    strict: "throw",
    versionKey: false,
  },
);

// Allow an actual and a forecast record on the same date,
// while preventing duplicates of either type.
weatherSchema.index({ date: 1, record_type: 1 }, { unique: true });

const Weather = mongoose.model("Weather", weatherSchema);

export default Weather;
