/**
 * Stores suggested menu actions for ingredient batches at expiry risk.
 *
 * Recommendations do not automatically create promotions or change stock.
 * Services will allocate at-risk stock across actions to prevent
 * multiple recommendations from claiming the same waste reduction.
 */

import mongoose from "mongoose";
import {
  createMoneyField,
  createWholeNumberField,
  createDecimalField,
  createBusinessDateField,
} from "./schemaHelpers.js";

const expiryMenuActionSchema = new mongoose.Schema(
  {
    expiry_action_id: {
      type: String,
      required: [true, "Expiry action ID is required."],
      trim: true,
      immutable: true,
    },

    action_generated_date: createBusinessDateField({ required: true }),

    batch_id: {
      type: String,
      required: [true, "Batch ID is required."],
      trim: true,
    },

    ingredient_id: {
      type: String,
      required: [true, "Ingredient ID is required."],
      trim: true,
    },

    ingredient_name: {
      type: String,
      default: null,
    },

    expiry_date: createBusinessDateField({ required: true }),

    // Negative values can represent a batch that has already expired.
    // Expired stock must not be recommended for consumption.
    days_until_expiry: {
      type: Number,
      default: null,
      validate: {
        validator(value) {
          return (
            value === null || value === undefined || Number.isSafeInteger(value)
          );
        },
        message: "{PATH} must be a safe whole number.",
      },
    },

    batch_quantity_remaining: {
      ...createDecimalField({ minimum: 0 }),
      required: [true, "Remaining batch quantity is required."],
    },

    unit: {
      type: String,
      required: [true, "Expiry action unit is required."],
      trim: true,
    },

    projected_batch_usage_before_expiry: createDecimalField({ minimum: 0 }),

    projected_waste_quantity: createDecimalField({ minimum: 0 }),

    inventory_value_at_risk_aud: createMoneyField(),

    // Allowed risk labels await the original calculation rules.
    expiry_risk_level: {
      type: String,
      trim: true,
      default: null,
    },

    // A menu recommendation may be unavailable for a particular batch.
    recommended_menu_item_id: {
      type: String,
      trim: true,
      default: null,
    },

    recommended_menu_variant_id: {
      type: String,
      trim: true,
      default: null,
    },

    recommended_menu_item_name: {
      type: String,
      default: null,
    },

    ingredient_quantity_per_portion: createDecimalField({ minimum: 0 }),

    recommended_additional_portions: createWholeNumberField(),

    recommended_discount_pct: createDecimalField({
      minimum: 0,
      maximum: 100,
    }),

    promotion_start_date: createBusinessDateField(),

    promotion_end_date: createBusinessDateField(),

    estimated_incremental_revenue_aud: createMoneyField(),

    estimated_waste_value_avoided_aud: createMoneyField(),

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
    collection: "expiry_menu_actions",
    strict: "throw",
    versionKey: false,
  },
);

expiryMenuActionSchema.index({ expiry_action_id: 1 }, { unique: true });

// Supports listing actions by generation date and expiry date.
expiryMenuActionSchema.index({
  action_generated_date: 1,
  expiry_date: 1,
});

// Supports finding recommendations associated with a batch.
expiryMenuActionSchema.index({
  batch_id: 1,
  action_generated_date: 1,
});

const ExpiryMenuAction = mongoose.model(
  "ExpiryMenuAction",
  expiryMenuActionSchema,
);

export default ExpiryMenuAction;
