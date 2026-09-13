/**
 * Reads and updates editable parent menu details.
 *
 * Category and parent baseline portions are synchronized to variants.
 * Variant prices and dietary flags remain independently managed.
 */

import mongoose from "mongoose";
import { createHash } from "node:crypto";
import { MenuItem, MenuVariant } from "../models/index.js";
import { requireDecimal } from "../utils/decimal.js";
import {
  RequestValidationError,
  requireText,
  requireBoolean,
  selectAllowedFields,
} from "../utils/requestValidation.js";

/**
 * Fixed form configuration. This contains no mutable application data.
 */
export const menuEditFields = Object.freeze([
  {
    name: "menu_item_name_clean",
    label: "Menu item name",
    type: "text",
    required: true,
    maximumLength: 200,
  },
  {
    name: "category",
    label: "Category",
    type: "text",
    maximumLength: 100,
  },
  {
    name: "active",
    label: "Active",
    type: "boolean",
    required: true,
  },
  {
    name: "sale_price_aud_small",
    label: "Small sale price (AUD)",
    type: "money",
  },
  {
    name: "sale_price_aud_large",
    label: "Large sale price (AUD)",
    type: "money",
  },
  {
    name: "estimated_food_cost_aud_small",
    label: "Small estimated food cost (AUD)",
    type: "money",
  },
  {
    name: "estimated_food_cost_aud_large",
    label: "Large estimated food cost (AUD)",
    type: "money",
  },
  {
    name: "base_lunch_portions",
    label: "Baseline lunch portions",
    type: "integer",
  },
  {
    name: "base_dinner_portions",
    label: "Baseline dinner portions",
    type: "integer",
  },
  { name: "tag_gf", label: "GF dietary flag", type: "boolean" },
  { name: "tag_v", label: "V dietary flag", type: "boolean" },
  { name: "tag_vg", label: "VG dietary flag", type: "boolean" },
  { name: "tag_a", label: "A source flag", type: "boolean" },
  { name: "tag_i", label: "I source flag", type: "boolean" },
]);

/**
 * Detects edits made after this form was loaded.
 *
 * This fingerprint is a concurrency check, not an authentication token.
 */
function buildRevision(document) {
  const values = menuEditFields.map(({ name }) => {
    const value = document[name];
    return value === null || value === undefined ? null : String(value);
  });

  return createHash("sha256").update(JSON.stringify(values)).digest("hex");
}

/**
 * Converts editable values to strings for HTML form inputs.
 */
function buildFormValues(document) {
  return Object.fromEntries(
    menuEditFields.map(({ name }) => [
      name,
      document[name] === null || document[name] === undefined
        ? ""
        : String(document[name]),
    ]),
  );
}

/**
 * Returns form data or null if the parent does not exist.
 */
export async function getMenuEditData(menuItemId) {
  const validatedId = requireText(menuItemId, "menuItemId", 200);

  const item = await MenuItem.findOne({
    menu_item_id: validatedId,
  }).lean();

  if (!item) {
    return null;
  }

  return {
    menuItemId: item.menu_item_id,
    revision: buildRevision(item),
    values: buildFormValues(item),
  };
}

/**
 * Validates one editable value.
 */
function readField(value, field) {
  if (typeof value !== "string") {
    throw new RequestValidationError(
      `${field.label} must be supplied as text.`,
    );
  }

  const text = value.trim();

  if (text === "") {
    if (field.required) {
      throw new RequestValidationError(`${field.label} is required.`);
    }

    return null;
  }

  if (field.type === "boolean") {
    return requireBoolean(text, field.label);
  }

  if (field.type === "money") {
    if (text.length > 100) {
      throw new RequestValidationError(`${field.label} is too long.`);
    }

    requireDecimal(text, field.label, { minimum: "0" });
    return text;
  }

  if (field.type === "integer") {
    if (!/^\d+$/.test(text) || !Number.isSafeInteger(Number(text))) {
      throw new RequestValidationError(
        `${field.label} must be a non-negative safe whole number.`,
      );
    }

    return Number(text);
  }

  return requireText(text, field.label, field.maximumLength);
}

/**
 * Updates a complete edit form.
 */
export async function updateMenuItem(menuItemId, input) {
  const validatedId = requireText(menuItemId, "menuItemId", 200);

  const fields = selectAllowedFields(input, [
    "revision",
    ...menuEditFields.map((field) => field.name),
  ]);

  const submittedRevision = requireText(fields.revision, "revision", 64);

  const changes = {};

  for (const field of menuEditFields) {
    changes[field.name] = readField(fields[field.name], field);
  }

  return mongoose.connection.transaction(async (session) => {
    const item = await MenuItem.findOne({
      menu_item_id: validatedId,
    }).session(session);

    if (!item) {
      throw new RequestValidationError("The menu item no longer exists.");
    }

    if (buildRevision(item) !== submittedRevision) {
      throw new RequestValidationError(
        "This item changed after you opened the form. Reload the page and review the latest values.",
      );
    }

    const categoryChanged = item.category !== changes.category;
    const lunchChanged =
      item.base_lunch_portions !== changes.base_lunch_portions;
    const dinnerChanged =
      item.base_dinner_portions !== changes.base_dinner_portions;

    item.set(changes);

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

    await item.save({ session });

    const variantChanges = {};

    if (categoryChanged) {
      variantChanges.category = item.category;
    }

    if (lunchChanged) {
      variantChanges.base_lunch_portions_parent = item.base_lunch_portions;
    }

    if (dinnerChanged) {
      variantChanges.base_dinner_portions_parent = item.base_dinner_portions;
    }

    if (Object.keys(variantChanges).length > 0) {
      await MenuVariant.updateMany(
        { menu_item_id: item.menu_item_id },
        { $set: variantChanges },
        {
          session,
          runValidators: true,
        },
      );
    }

    return item.menu_item_id;
  });
}
