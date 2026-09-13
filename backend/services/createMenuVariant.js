/**
 * Creates a variant linked to an existing parent menu item.
 *
 * Calculates gross margin using decimal arithmetic.
 */

import { randomUUID } from "node:crypto";
import { MenuItem, MenuVariant } from "../models/index.js";
import { requireDecimal } from "../utils/decimal.js";
import {
  RequestValidationError,
  requireText,
  requireBoolean,
  selectAllowedFields,
} from "../utils/requestValidation.js";

export async function createMenuVariant(menuItemId, input) {
  const parentId = requireText(menuItemId, "menuItemId", 200);

  const fields = selectAllowedFields(input, [
    "menu_variant_name",
    "portion_size",
    "sale_price_aud",
    "estimated_food_cost_aud",
    "active",
    "demand_model_training_eligible",
    "exclusion_reason",
  ]);

  const parent = await MenuItem.findOne({
    menu_item_id: parentId,
  }).lean();

  if (!parent) {
    throw new RequestValidationError("The parent menu item no longer exists.");
  }

  const priceText = requireText(fields.sale_price_aud, "Sale price", 100);

  const salePrice = requireDecimal(priceText, "Sale price", {
    minimum: "0",
  });

  let costText = null;
  let grossMargin = null;
  let grossMarginRatio = null;

  if (
    fields.estimated_food_cost_aud !== undefined &&
    fields.estimated_food_cost_aud !== null &&
    fields.estimated_food_cost_aud !== ""
  ) {
    costText = requireText(
      fields.estimated_food_cost_aud,
      "Estimated food cost",
      100,
    );

    const foodCost = requireDecimal(costText, "Estimated food cost", {
      minimum: "0",
    });

    grossMargin = salePrice.minus(foodCost);

    if (!salePrice.isZero()) {
      // Explicit storage rounding to fit Decimal128 precision.
      grossMarginRatio = grossMargin
        .dividedBy(salePrice)
        .toSignificantDigits(34)
        .toString();
    }
  }

  const trainingEligible = requireBoolean(
    fields.demand_model_training_eligible,
    "Training eligibility",
  );

  let exclusionReason = null;

  if (!trainingEligible) {
    exclusionReason = requireText(
      fields.exclusion_reason,
      "Exclusion reason",
      500,
    );
  }

  const variant = new MenuVariant({
    menu_variant_id: `MV-${randomUUID()}`,
    menu_item_id: parent.menu_item_id,

    menu_variant_name: requireText(
      fields.menu_variant_name,
      "Variant name",
      200,
    ),

    portion_size: requireText(fields.portion_size, "Portion size", 100),

    category: parent.category,
    active: requireBoolean(fields.active, "Active status"),

    sale_price_aud: priceText,
    estimated_food_cost_aud: costText,

    gross_margin_aud: grossMargin?.toString() ?? null,
    gross_margin_ratio: grossMarginRatio,

    demand_model_training_eligible: trainingEligible,
    exclusion_reason: exclusionReason,

    // Initial snapshots of the parent's corresponding source fields.
    menu_tag_codes: parent.menu_tag_codes,
    tag_gf: parent.tag_gf,
    tag_v: parent.tag_v,
    tag_vg: parent.tag_vg,
    tag_a: parent.tag_a,
    tag_i: parent.tag_i,
    base_lunch_portions_parent: parent.base_lunch_portions,
    base_dinner_portions_parent: parent.base_dinner_portions,
  });

  try {
    await variant.validate();
  } catch (error) {
    if (error.name === "ValidationError") {
      throw new RequestValidationError(
        `Check these fields: ${Object.keys(error.errors).join(", ")}.`,
      );
    }

    throw error;
  }

  await variant.save();

  return variant;
}
