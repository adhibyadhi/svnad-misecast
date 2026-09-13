/**
 * Represents a size-specific menu variant.
 *
 * Preserves the fields from the menu_variants source table.
 * menu_item_id links to the parent's string business identifier.
 */

import mongoose from "mongoose";
import {
  createMoneyField,
  createWholeNumberField,
  createDecimalField,
} from "./schemaHelpers.js";

const menuVariantSchema = new mongoose.Schema(
  {
    // Existing business identifier, for example "MI-001-SMALL".
    menu_variant_id: {
      type: String,
      required: [true, "Menu variant ID is required."],
      trim: true,
      immutable: true,
    },

    // Links to menu_items.menu_item_id, not MongoDB's _id.
    // The import and management services will verify that it exists.
    menu_item_id: {
      type: String,
      required: [true, "Parent menu item ID is required."],
      trim: true,
    },

    menu_variant_name: {
      type: String,
      required: [true, "Menu variant name is required."],
      trim: true,
    },

    // Allowed size names will be confirmed against the actual CSV.
    portion_size: {
      type: String,
      required: [true, "Portion size is required."],
      trim: true,
    },

    category: {
      type: String,
      trim: true,
      default: null,
    },

    sale_price_aud: createMoneyField(),

    estimated_food_cost_aud: createMoneyField(),

    // Sale price minus estimated food cost; losses are valid values.
    gross_margin_aud: createDecimalField(),

    // Margin divided by sale price. Null when the ratio is unavailable.
    // A zero sale price must not produce an infinite ratio.
    gross_margin_ratio: createDecimalField({ maximum: 1 }),

    active: {
      type: Boolean,
      required: [true, "Menu variant active status is required."],
    },

    // Eligibility is separate from whether the item is currently sold.
    demand_model_training_eligible: {
      type: Boolean,
      required: [true, "Model training eligibility is required."],
    },

    exclusion_reason: {
      type: String,
      default: null,
    },

    // Preserve pipe-delimited source tags without converting to an array.
    menu_tag_codes: {
      type: String,
      default: null,
    },

    tag_gf: {
      type: Boolean,
      default: null,
    },

    tag_v: {
      type: Boolean,
      default: null,
    },

    tag_vg: {
      type: Boolean,
      default: null,
    },

    tag_a: {
      type: Boolean,
      default: null,
    },

    tag_i: {
      type: Boolean,
      default: null,
    },

    // Parent-level baseline portions copied into the source variant row.
    base_lunch_portions_parent: createWholeNumberField(),

    base_dinner_portions_parent: createWholeNumberField(),

    // Stored as a percentage: 60 means 60%, not 0.60.
    size_mix_assumption_pct: createDecimalField({
      minimum: 0,
      maximum: 100,
    }),

    source_row_number: {
      type: String,
      default: null,
    },

    source_file: {
      type: String,
      default: null,
    },
  },
  {
    collection: "menu_variants",
    strict: "throw",
    versionKey: false,
  },
);

// Each variant has one unique business identifier.
menuVariantSchema.index({ menu_variant_id: 1 }, { unique: true });

// Supports finding all variants belonging to a parent menu item.
menuVariantSchema.index({ menu_item_id: 1 });

const MenuVariant = mongoose.model("MenuVariant", menuVariantSchema);

export default MenuVariant;
