/**
 * Stores daily ingredient demand and inventory projections.
 *
 * Preserves the source composite key:
 * forecast_date + ingredient_id.
 *
 * Historical run snapshots will live in supporting storage.
 */

import mongoose from "mongoose";
import {
  createDecimalField,
  createBusinessDateField,
} from "./schemaHelpers.js";

const ingredientDemandForecastSchema = new mongoose.Schema(
  {
    forecast_date: createBusinessDateField({ required: true }),

    ingredient_id: {
      type: String,
      required: [true, "Ingredient ID is required."],
      trim: true,
    },

    ingredient_name: {
      type: String,
      default: null,
    },

    // Preserve the source field without inventing a category mapping.
    category: {
      type: String,
      trim: true,
      default: null,
    },

    unit: {
      type: String,
      required: [true, "Ingredient forecast unit is required."],
      trim: true,
    },

    forecast_quantity_needed: {
      ...createDecimalField({ minimum: 0 }),
      required: [true, "Forecast ingredient quantity is required."],
    },

    // Bounds remain null when the demand model cannot support them.
    lower_bound_quantity: createDecimalField({ minimum: 0 }),

    upper_bound_quantity: createDecimalField({ minimum: 0 }),

    cumulative_forecast_quantity: createDecimalField({ minimum: 0 }),

    starting_inventory_quantity: createDecimalField({ minimum: 0 }),

    // Physical inventory cannot be negative.
    projected_inventory_end_of_day_no_order: createDecimalField({
      minimum: 0,
    }),

    projected_expired_quantity_to_date: createDecimalField({ minimum: 0 }),

    // Record shortages separately from physical stock.
    projected_unfilled_demand_quantity: createDecimalField({ minimum: 0 }),

    is_synthetic: {
      type: Boolean,
      required: [true, "Synthetic data status is required."],
    },
  },
  {
    collection: "ingredient_demand_forecast",
    strict: "throw",
    versionKey: false,
  },
);

ingredientDemandForecastSchema.index(
  {
    forecast_date: 1,
    ingredient_id: 1,
  },
  { unique: true },
);

// Supports viewing one ingredient's daily projections.
ingredientDemandForecastSchema.index({
  ingredient_id: 1,
  forecast_date: 1,
});

const IngredientDemandForecast = mongoose.model(
  "IngredientDemandForecast",
  ingredientDemandForecastSchema,
);

export default IngredientDemandForecast;
