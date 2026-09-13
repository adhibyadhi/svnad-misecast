/**
 * Connects menu variants to their recipe ingredients.
 *
 * Preserves the existing many-to-many recipe bridge.
 * Services will verify referenced IDs and unit compatibility.
 */

import mongoose from "mongoose";
import { createDecimalField } from "./schemaHelpers.js";

const menuRecipeSchema = new mongoose.Schema(
  {
    recipe_line_id: {
      type: String,
      required: [true, "Recipe line ID is required."],
      trim: true,
      immutable: true,
    },

    menu_variant_id: {
      type: String,
      required: [true, "Menu variant ID is required."],
      trim: true,
    },

    menu_item_id: {
      type: String,
      required: [true, "Menu item ID is required."],
      trim: true,
    },

    menu_variant_name: {
      type: String,
      default: null,
    },

    portion_size: {
      type: String,
      trim: true,
      default: null,
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

    ingredient_group_code: {
      type: String,
      trim: true,
      default: null,
    },

    // Decimal precision is needed for small ingredient quantities.
    quantity_per_portion: createDecimalField({ minimum: 0 }),

    unit: {
      type: String,
      required: [true, "Recipe unit is required."],
      trim: true,
    },

    // Fraction scale: 0.10 represents 10%.
    preparation_loss_fraction: createDecimalField({
      minimum: 0,
      maximum: 1,
    }),

    // Percentage scale: 10 represents 10%.
    preparation_loss_pct: createDecimalField({
      minimum: 0,
      maximum: 100,
    }),

    // Preserve the supplied value until its calculation rule is verified.
    effective_quantity_per_portion: createDecimalField({ minimum: 0 }),

    recipe_component_status: {
      type: String,
      trim: true,
      default: null,
    },

    inventory_consumption_eligible: {
      type: Boolean,
      required: [true, "Inventory consumption eligibility is required."],
    },

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
    collection: "menu_recipes",
    strict: "throw",
    versionKey: false,
  },
);

menuRecipeSchema.index({ recipe_line_id: 1 }, { unique: true });

// Find the ingredients needed for a menu variant.
menuRecipeSchema.index({ menu_variant_id: 1 });

// Find recipes affected by an ingredient change.
menuRecipeSchema.index({ ingredient_id: 1 });

const MenuRecipe = mongoose.model("MenuRecipe", menuRecipeSchema);

export default MenuRecipe;
