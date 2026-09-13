/**
 * Stores ingredient runout and safety-stock projections.
 *
 * Preserves the source composite key:
 * prediction_as_of_date + ingredient_id.
 *
 * Unknown or unreached stockout dates remain null.
 */

import mongoose from "mongoose";
import {
  createWholeNumberField,
  createDecimalField,
  createBusinessDateField,
} from "./schemaHelpers.js";

const runoutPredictionSchema = new mongoose.Schema(
  {
    prediction_as_of_date: createBusinessDateField({ required: true }),

    ingredient_id: {
      type: String,
      required: [true, "Ingredient ID is required."],
      trim: true,
    },

    ingredient_name: {
      type: String,
      default: null,
    },

    category: {
      type: String,
      trim: true,
      default: null,
    },

    unit: {
      type: String,
      required: [true, "Runout prediction unit is required."],
      trim: true,
    },

    current_inventory_quantity: {
      ...createDecimalField({ minimum: 0 }),
      required: [true, "Current inventory quantity is required."],
    },

    // Missing settings must not silently imply zero safety stock.
    safety_stock_quantity: createDecimalField({ minimum: 0 }),

    // Only populate when a full ten-day forecast is available.
    ten_day_forecast_demand_quantity: createDecimalField({ minimum: 0 }),

    projected_expired_quantity: createDecimalField({ minimum: 0 }),

    projected_unfilled_demand_quantity: createDecimalField({ minimum: 0 }),

    projected_end_inventory_no_order: createDecimalField({ minimum: 0 }),

    // Null when cover cannot be established from the forecast horizon.
    estimated_stock_cover_days: createDecimalField({ minimum: 0 }),

    first_below_safety_date: createBusinessDateField(),

    predicted_stockout_date: createBusinessDateField(),

    // Zero can represent stockout on the prediction date.
    // Null means no stockout date has been established.
    days_until_stockout: createWholeNumberField(),

    // Allowed risk labels await the original runout rules.
    runout_risk_level: {
      type: String,
      trim: true,
      default: null,
    },

    // The source does not specify the score's range.
    priority_score: createDecimalField(),

    // Preserve the pipe-delimited menu_variant_id list.
    affected_menu_variants: {
      type: String,
      default: null,
    },

    recommended_action: {
      type: String,
      default: null,
    },

    is_synthetic: {
      type: Boolean,
      required: [true, "Synthetic data status is required."],
    },
  },
  {
    collection: "runout_predictions",
    strict: "throw",
    versionKey: false,
  },
);

runoutPredictionSchema.index(
  {
    prediction_as_of_date: 1,
    ingredient_id: 1,
  },
  { unique: true },
);

// Supports inspecting an ingredient's runout summaries by date.
runoutPredictionSchema.index({
  ingredient_id: 1,
  prediction_as_of_date: 1,
});

const RunoutPrediction = mongoose.model(
  "RunoutPrediction",
  runoutPredictionSchema,
);

export default RunoutPrediction;
