/**
 * Represents a parent menu item in the menu_items collection.
 *
 * Size-specific variants are stored separately in menu_variants.
 * Existing CSV field names and string business IDs are preserved.
 */

import mongoose from "mongoose";
import { createMoneyField, createWholeNumberField } from "./schemaHelpers.js";

const menuItemSchema = new mongoose.Schema(
  {
    // Existing business identifier, for example "MI-001".
    menu_item_id: {
      type: String,
      required: [true, "Menu item ID is required."],
      trim: true,
      immutable: true,
    },

    // Stored as a string to match the supplied source structure.
    source_row_number: {
      type: String,
      default: null,
    },

    menu_item_name_source: {
      type: String,
      default: null,
    },

    menu_item_name_clean: {
      type: String,
      required: [true, "Menu item name is required."],
      trim: true,
    },

    // Allowed categories will be confirmed against the actual CSV.
    category: {
      type: String,
      trim: true,
      default: null,
    },

    // Null supports items that do not offer both sizes.
    sale_price_aud_small: createMoneyField(),
    sale_price_aud_large: createMoneyField(),

    estimated_food_cost_aud_small: createMoneyField(),
    estimated_food_cost_aud_large: createMoneyField(),

    // Require an explicit choice rather than silently activating an item.
    active: {
      type: Boolean,
      required: [true, "Menu item active status is required."],
    },

    // Preserve the source's pipe-delimited string.
    menu_tag_codes: {
      type: String,
      default: null,
    },

    // Null means unknown; false means explicitly not tagged.
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

    // Meanings of source tag codes will be documented after CSV review.
    tag_a: {
      type: Boolean,
      default: null,
    },

    tag_i: {
      type: Boolean,
      default: null,
    },

    base_lunch_portions: createWholeNumberField(),
    base_dinner_portions: createWholeNumberField(),

    source_file: {
      type: String,
      default: null,
    },
  },
  {
    // Use the existing collection name exactly.
    collection: "menu_items",

    // Reject unexpected fields so spelling mistakes are visible.
    strict: "throw",

    // Preserve the supplied structure without adding a version field.
    versionKey: false,
  },
);

// Enforce uniqueness of the source business identifier.
menuItemSchema.index({ menu_item_id: 1 }, { unique: true });

const MenuItem = mongoose.model("MenuItem", menuItemSchema);

export default MenuItem;
