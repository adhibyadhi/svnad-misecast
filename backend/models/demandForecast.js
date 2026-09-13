/**
 * Stores menu-variant demand forecasts.
 *
 * Planned model mapping, subject to actual artifact verification:
 * - p50 -> predicted_portions
 * - p90 -> upper_bound_portions
 *
 * P90 is a demand quantile, not a confidence percentage.
 * Unsupported outputs remain null.
 */

import mongoose from "mongoose";
import {
  createMoneyField,
  createWholeNumberField,
  createDecimalField,
  createBusinessDateField,
} from "./schemaHelpers.js";

const demandForecastSchema = new mongoose.Schema(
  {
    forecast_id: {
      type: String,
      required: [true, "Forecast ID is required."],
      trim: true,
      immutable: true,
    },

    forecast_generated_date: createBusinessDateField({ required: true }),

    forecast_date: createBusinessDateField({ required: true }),

    forecast_horizon_days: {
      ...createWholeNumberField(),
      required: [true, "Forecast horizon is required."],
    },

    service_period: {
      type: String,
      required: [true, "Service period is required."],
      trim: true,
    },

    menu_item_id: {
      type: String,
      required: [true, "Menu item ID is required."],
      trim: true,
    },

    menu_variant_id: {
      type: String,
      required: [true, "Menu variant ID is required."],
      trim: true,
    },

    menu_item_name: {
      type: String,
      default: null,
    },

    portion_size: {
      type: String,
      trim: true,
      default: null,
    },

    category: {
      type: String,
      trim: true,
      default: null,
    },

    // Requires a documented baseline calculation.
    baseline_portions: createDecimalField({ minimum: 0 }),

    // Fractional predictions are valid; operational rounding comes later.
    predicted_portions: {
      ...createDecimalField({ minimum: 0 }),
      required: [true, "Predicted portions are required."],
    },

    // The described p50/p90 model does not supply a lower quantile.
    lower_bound_portions: createDecimalField({ minimum: 0 }),

    upper_bound_portions: createDecimalField({ minimum: 0 }),

    // Do not populate this with 90 merely because p90 exists.
    forecast_confidence_pct: createDecimalField({
      minimum: 0,
      maximum: 100,
    }),

    confirmed_reservation_covers: createWholeNumberField(),

    weather_condition: {
      type: String,
      default: null,
    },

    special_occasion: {
      type: String,
      default: null,
    },

    event_types: {
      type: String,
      default: null,
    },

    // Leave null unless supported explanations are available.
    key_demand_drivers: {
      type: String,
      default: null,
    },

    // The forecast service will document the price/discount scenario.
    predicted_revenue_aud: createMoneyField(),

    model_version: {
      type: String,
      required: [true, "Model version is required."],
      trim: true,
    },

    is_synthetic: {
      type: Boolean,
      required: [true, "Synthetic data status is required."],
    },
  },
  {
    collection: "demand_forecast",
    strict: "throw",
    versionKey: false,
  },
);

demandForecastSchema.index({ forecast_id: 1 }, { unique: true });

// Supports forecasts over a date range, optionally filtered by service.
demandForecastSchema.index({
  forecast_date: 1,
  service_period: 1,
});

// Supports inspecting forecasts for a particular variant.
demandForecastSchema.index({
  menu_variant_id: 1,
  forecast_date: 1,
});

const DemandForecast = mongoose.model("DemandForecast", demandForecastSchema);

export default DemandForecast;
