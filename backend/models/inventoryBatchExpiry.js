/**
 * Stores ingredient stock batches and their expiry information.
 *
 * Batch quantities are the inventory authority.
 * Services will validate ingredient references, units and date ordering.
 */

import mongoose from "mongoose";
import {
  createMoneyField,
  createWholeNumberField,
  createDecimalField,
  createBusinessDateField,
} from "./schemaHelpers.js";

const inventoryBatchExpirySchema = new mongoose.Schema(
  {
    batch_id: {
      type: String,
      required: [true, "Batch ID is required."],
      trim: true,
      immutable: true,
    },

    restaurant_id: {
      type: String,
      required: [true, "Restaurant ID is required."],
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

    received_date: createBusinessDateField({ required: true }),

    expiry_date: createBusinessDateField({ required: true }),

    // Imported snapshot only. Recalculate for the date being analyzed.
    // Negative values are valid for an expired batch.
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

    shelf_life_days: createWholeNumberField(),

    // Stock can be fractional but cannot be negative.
    quantity_remaining: {
      ...createDecimalField({ minimum: 0 }),
      required: [true, "Remaining batch quantity is required."],
    },

    unit: {
      type: String,
      required: [true, "Batch unit is required."],
      trim: true,
    },

    unit_cost_aud: createMoneyField(),

    // Services will refresh this when quantity or cost changes.
    batch_value_aud: createMoneyField(),

    storage_type: {
      type: String,
      trim: true,
      default: null,
    },

    storage_location: {
      type: String,
      trim: true,
      default: null,
    },

    // Preserve source values until their allowed vocabulary is confirmed.
    stock_rotation_priority: {
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
    collection: "inventory_batches_expiry",
    strict: "throw",
    versionKey: false,
  },
);

inventoryBatchExpirySchema.index({ batch_id: 1 }, { unique: true });

// Supports finding an ingredient's batches in expiry order.
inventoryBatchExpirySchema.index({
  restaurant_id: 1,
  ingredient_id: 1,
  expiry_date: 1,
});

// Supports expiry reports across all ingredients.
inventoryBatchExpirySchema.index({
  restaurant_id: 1,
  expiry_date: 1,
});

const InventoryBatchExpiry = mongoose.model(
  "InventoryBatchExpiry",
  inventoryBatchExpirySchema,
);

export default InventoryBatchExpiry;
