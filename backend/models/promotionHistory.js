/**
 * Stores promotions and their observed outcomes.
 *
 * Future promotions can have null outcome fields.
 * Services will validate references and calculate observed uplift.
 */

import mongoose from "mongoose";
import {
  createWholeNumberField,
  createDecimalField,
  createBusinessDateField,
} from "./schemaHelpers.js";

const promotionHistorySchema = new mongoose.Schema(
  {
    promotion_id: {
      type: String,
      required: [true, "Promotion ID is required."],
      trim: true,
      immutable: true,
    },

    promotion_date: createBusinessDateField({ required: true }),

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

    menu_variant_name: {
      type: String,
      default: null,
    },

    // Optional: a promotion need not target an expiring ingredient.
    targeted_ingredient_id: {
      type: String,
      trim: true,
      default: null,
    },

    targeted_ingredient_name: {
      type: String,
      default: null,
    },

    discount_pct: {
      ...createDecimalField({
        minimum: 0,
        maximum: 100,
      }),
      required: [true, "Promotion discount percentage is required."],
    },

    baseline_portions: createDecimalField({ minimum: 0 }),

    // Unknown until observed; do not default a future promotion to zero.
    actual_portions_sold: createWholeNumberField(),

    // Uplift can be negative or exceed 100%.
    // Leave null when there is no usable baseline.
    uplift_pct: createDecimalField(),

    at_risk_quantity: createDecimalField({ minimum: 0 }),

    unit: {
      type: String,
      trim: true,
      default: null,
    },

    estimated_waste_avoided_quantity: createDecimalField({ minimum: 0 }),

    is_synthetic: {
      type: Boolean,
      required: [true, "Synthetic data status is required."],
    },
  },
  {
    collection: "promotion_history",
    strict: "throw",
    versionKey: false,
  },
);

promotionHistorySchema.index({ promotion_id: 1 }, { unique: true });

// Find promotions for a date and service.
promotionHistorySchema.index({
  promotion_date: 1,
  service_period: 1,
});

// Find promotions affecting a variant during a date range.
promotionHistorySchema.index({
  menu_variant_id: 1,
  promotion_date: 1,
});

const PromotionHistory = mongoose.model(
  "PromotionHistory",
  promotionHistorySchema,
);

export default PromotionHistory;
