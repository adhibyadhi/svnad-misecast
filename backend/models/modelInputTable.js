/**
 * Stores the flattened model feature table.
 *
 * Preserves the source composite key:
 * date + service_period + menu_variant_id.
 *
 * Actual outcome fields remain null for future dates.
 * The model adapter will explicitly select approved input features.
 */

import mongoose from "mongoose";
import {
  createMoneyField,
  createWholeNumberField,
  createDecimalField,
  createBusinessDateField,
} from "./schemaHelpers.js";

const modelInputTableSchema = new mongoose.Schema(
  {
    // Future prediction rows do not necessarily belong to a dataset split.
    data_split: {
      type: String,
      enum: {
        values: ["training", "validation", "test", null],
        message: "Data split must be training, validation, test or null.",
      },
      default: null,
    },

    date: createBusinessDateField({ required: true }),

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

    // Preserve source string representations for calendar features.
    day_of_week: {
      type: String,
      default: null,
    },

    month: {
      type: String,
      default: null,
    },

    season: {
      type: String,
      default: null,
    },

    is_weekend: {
      type: Boolean,
      default: null,
    },

    is_public_holiday: {
      type: Boolean,
      default: null,
    },

    is_school_holiday: {
      type: Boolean,
      default: null,
    },

    special_occasion: {
      type: String,
      default: null,
    },

    average_temperature_c: createDecimalField(),

    maximum_temperature_c: createDecimalField(),

    rain_probability_pct: createDecimalField({
      minimum: 0,
      maximum: 100,
    }),

    rainfall_mm: createDecimalField({ minimum: 0 }),

    weather_condition: {
      type: String,
      default: null,
    },

    is_hot_day: {
      type: Boolean,
      default: null,
    },

    is_cold_day: {
      type: Boolean,
      default: null,
    },

    confirmed_reservation_covers: createWholeNumberField(),

    event_count: createWholeNumberField(),

    // Preserve the source string representation.
    event_types: {
      type: String,
      default: null,
    },

    total_event_attendance: createWholeNumberField(),

    nearest_event_distance_km: createDecimalField({ minimum: 0 }),

    // Bounds depend on the original model's scoring definition.
    maximum_event_relevance_score: createDecimalField(),

    promotion_active: {
      type: Boolean,
      default: null,
    },

    promotion_discount_pct: createDecimalField({
      minimum: 0,
      maximum: 100,
    }),

    // Calculated from earlier sales using verified model rules.
    lag_7_day_quantity: createDecimalField({ minimum: 0 }),

    rolling_28_day_average: createDecimalField({ minimum: 0 }),

    // Training target / observed outcome, never a prediction input.
    quantity_sold_target: createWholeNumberField(),

    // Observed outcomes remain null until actual sales are available.
    dine_in_quantity_actual: createWholeNumberField(),

    takeaway_quantity_actual: createWholeNumberField(),

    delivery_quantity_actual: createWholeNumberField(),

    gross_sales_aud_actual: createMoneyField(),

    net_sales_aud_actual: createMoneyField(),

    is_synthetic: {
      type: Boolean,
      required: [true, "Synthetic data status is required."],
    },
  },
  {
    collection: "model_input_table",
    strict: "throw",
    versionKey: false,
  },
);

modelInputTableSchema.index(
  {
    date: 1,
    service_period: 1,
    menu_variant_id: 1,
  },
  { unique: true },
);

// Supports inspecting a variant's feature history.
modelInputTableSchema.index({
  menu_variant_id: 1,
  service_period: 1,
  date: 1,
});

const ModelInputTable = mongoose.model(
  "ModelInputTable",
  modelInputTableSchema,
);

export default ModelInputTable;
