/**
 * Represents one supplier offer for an ingredient.
 *
 * supplier_offer_id uniquely identifies an offer.
 * supplier_id can appear in multiple offers.
 */

import mongoose from "mongoose";
import {
  createMoneyField,
  createWholeNumberField,
  createDecimalField,
  createLocalTimeField,
} from "./schemaHelpers.js";

const supplierSchema = new mongoose.Schema(
  {
    supplier_offer_id: {
      type: String,
      required: [true, "Supplier offer ID is required."],
      trim: true,
      immutable: true,
    },

    supplier_id: {
      type: String,
      required: [true, "Supplier ID is required."],
      trim: true,
    },

    supplier_name: {
      type: String,
      required: [true, "Supplier name is required."],
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

    is_primary_supplier: {
      type: Boolean,
      required: [true, "Primary supplier status is required."],
    },

    // Ordering services must require a positive pack size before use.
    pack_size: createDecimalField({ minimum: 0 }),

    unit: {
      type: String,
      required: [true, "Supplier offer unit is required."],
      trim: true,
    },

    minimum_order_packs: createWholeNumberField(),

    minimum_order_quantity: createDecimalField({ minimum: 0 }),

    unit_cost_aud: createMoneyField(),

    pack_cost_aud: createMoneyField(),

    delivery_fee_aud: createMoneyField(),

    // Null means unknown or unavailable, not automatically free delivery.
    free_delivery_threshold_aud: createMoneyField(),

    lead_time_days: createWholeNumberField(),

    // Preserve the pipe-delimited day list from the source.
    delivery_days: {
      type: String,
      default: null,
    },

    order_cutoff_time: createLocalTimeField(),

    reliability_score_pct: createDecimalField({
      minimum: 0,
      maximum: 100,
    }),

    is_synthetic: {
      type: Boolean,
      required: [true, "Synthetic data status is required."],
    },
  },
  {
    collection: "suppliers",
    strict: "throw",
    versionKey: false,
  },
);

supplierSchema.index({ supplier_offer_id: 1 }, { unique: true });

// Find offers belonging to a supplier and ingredient combination.
// Uniqueness is not assumed beyond the source's declared primary key.
supplierSchema.index({ supplier_id: 1, ingredient_id: 1 });

// Find available suppliers for an ingredient.
supplierSchema.index({ ingredient_id: 1, is_primary_supplier: 1 });

const Supplier = mongoose.model("Supplier", supplierSchema);

export default Supplier;
