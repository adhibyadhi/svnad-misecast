/**
 * Creates parent menu items from explicitly allowed form fields.
 */

import { randomUUID } from "node:crypto";
import { MenuItem } from "../models/index.js";
import { requireDecimal } from "../utils/decimal.js";
import {
  RequestValidationError,
  requireText,
  requireBoolean,
  selectAllowedFields,
} from "../utils/requestValidation.js";

/**
 * Reads optional text without converting other types into strings.
 */
function readOptionalText(value, fieldName, maximumLength) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    throw new RequestValidationError(`${fieldName} must be text.`);
  }

  if (value.trim() === "") {
    return null;
  }

  return requireText(value, fieldName, maximumLength);
}

/**
 * Reads an optional non-negative monetary value.
 * Preserves the supplied decimal text without rounding.
 */
function readOptionalMoney(value, fieldName) {
  const text = readOptionalText(value, fieldName, 100);

  if (text === null) {
    return null;
  }

  requireDecimal(text, fieldName, { minimum: "0" });

  return text;
}

export async function createMenuItem(input) {
  const fields = selectAllowedFields(input, [
    "menu_item_name_clean",
    "category",
    "active",
    "sale_price_aud_small",
    "sale_price_aud_large",
    "estimated_food_cost_aud_small",
    "estimated_food_cost_aud_large",
  ]);

  const item = new MenuItem({
    // Source imports retain their original IDs.
    // Manager-created records receive collision-resistant new IDs.
    menu_item_id: `MI-${randomUUID()}`,

    menu_item_name_clean: requireText(
      fields.menu_item_name_clean,
      "Menu item name",
      200,
    ),

    category: readOptionalText(fields.category, "Category", 100),

    active: requireBoolean(fields.active, "Active status"),

    sale_price_aud_small: readOptionalMoney(
      fields.sale_price_aud_small,
      "Small sale price",
    ),

    sale_price_aud_large: readOptionalMoney(
      fields.sale_price_aud_large,
      "Large sale price",
    ),

    estimated_food_cost_aud_small: readOptionalMoney(
      fields.estimated_food_cost_aud_small,
      "Small estimated food cost",
    ),

    estimated_food_cost_aud_large: readOptionalMoney(
      fields.estimated_food_cost_aud_large,
      "Large estimated food cost",
    ),
  });

  try {
    await item.validate();
  } catch (error) {
    if (error.name === "ValidationError") {
      throw new RequestValidationError(
        `Check these fields: ${Object.keys(error.errors).join(", ")}.`,
      );
    }

    throw error;
  }

  await item.save();

  return item;
}
