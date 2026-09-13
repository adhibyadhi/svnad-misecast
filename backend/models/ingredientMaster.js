/**
 * Represents an ingredient in the ingredient_master collection.
 *
 * Recipes reference ingredients through ingredient_id.
 * Stock quantities and expiry dates belong to inventory_batches_expiry.
 */

import mongoose from "mongoose";
import { createMoneyField, createWholeNumberField } from "./schemaHelpers.js";

const ingredientMasterSchema = new mongoose.Schema(
  {
    // Existing business identifier, for example "GROUP-001".
    ingredient_id: {
      type: String,
      required: [true, "Ingredient ID is required."],
      trim: true,
      immutable: true,
    },

    ingredient_name: {
      type: String,
      required: [true, "Ingredient name is required."],
      trim: true,
    },

    // Preserve the grouping codes supplied in the source data.
    ingredient_group_code: {
      type: String,
      trim: true,
      default: null,
    },

    // Preserve the source unit spelling and capitalization.
    // Unit conversions will be handled explicitly in services.
    source_unit: {
      type: String,
      required: [true, "Ingredient source unit is required."],
      trim: true,
    },

    // Allowed storage types will be confirmed against the actual CSV.
    storage_type: {
      type: String,
      trim: true,
      default: null,
    },

    // Cost per source unit. Unknown cost remains null.
    unit_cost_aud: createMoneyField(),

    // An ingredient may appear in recipes without being stock-tracked.
    inventory_tracked: {
      type: Boolean,
      required: [true, "Inventory tracking status is required."],
    },

    // Summary counts from the source data.
    // Services will refresh these when recipes or variants change.
    recipe_line_count: createWholeNumberField(),

    menu_variant_count: createWholeNumberField(),

    active_menu_variant_count: createWholeNumberField(),

    // Preserve source status values until the data dictionary is reviewed.
    operational_data_status: {
      type: String,
      trim: true,
      default: null,
    },

    inventory_setup_note: {
      type: String,
      default: null,
    },

    source_file: {
      type: String,
      default: null,
    },
  },
  {
    collection: "ingredient_master",
    strict: "throw",
    versionKey: false,
  },
);

// Enforce uniqueness of the ingredient's business identifier.
ingredientMasterSchema.index({ ingredient_id: 1 }, { unique: true });

const IngredientMaster = mongoose.model(
  "IngredientMaster",
  ingredientMasterSchema,
);

export default IngredientMaster;
