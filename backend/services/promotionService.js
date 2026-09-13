import { randomUUID } from "node:crypto";

import { MenuItem, MenuVariant, PromotionHistory } from "../models/index.js";

import { restaurant } from "../config/restaurant.js";
import {
  addBusinessDays,
  getBusinessDate,
  requireBusinessDate,
} from "../utils/businessDate.js";
import {
  RequestValidationError,
  requireText,
  selectAllowedFields,
} from "../utils/requestValidation.js";
import { CalculationDecimal } from "../utils/decimal.js";

export async function getPromotionOverview() {
  const today = getBusinessDate(restaurant.timezone);
  const lastDate = addBusinessDays(today, 13);

  const activeParents = await MenuItem.find({ active: true })
    .select({ _id: 0, menu_item_id: 1 })
    .lean();

  const parentIds = activeParents.map((item) => item.menu_item_id);

  const [variants, promotions] = await Promise.all([
    MenuVariant.find({
      active: true,
      menu_item_id: { $in: parentIds },
    })
      .select({
        _id: 0,
        menu_variant_id: 1,
        menu_variant_name: 1,
      })
      .sort({ menu_variant_name: 1 })
      .lean(),

    PromotionHistory.find({
      promotion_date: { $gte: today },
    })
      .sort({
        promotion_date: 1,
        service_period: 1,
        promotion_id: 1,
      })
      .limit(100)
      .lean(),
  ]);

  return {
    today,
    lastDate,
    variants,
    promotions: promotions.map((promotion) => ({
      ...promotion,
      discount_pct: promotion.discount_pct?.toString() ?? null,
    })),
  };
}

export async function createPromotion(input) {
  const fields = selectAllowedFields(input, [
    "promotion_date",
    "service_period",
    "menu_variant_id",
    "discount_pct",
  ]);

  const date = requireBusinessDate(fields.promotion_date);

  if (date < getBusinessDate(restaurant.timezone)) {
    throw new RequestValidationError(
      "Choose today or a future date for a planned promotion.",
    );
  }

  const servicePeriod = requireText(
    fields.service_period,
    "service_period",
    80,
  );

  const variantId = requireText(fields.menu_variant_id, "menu_variant_id", 200);

  const discountText = requireText(fields.discount_pct, "discount_pct", 10);

  if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(discountText)) {
    throw new RequestValidationError(
      "Enter a discount percentage with up to two decimal places.",
    );
  }

  const discount = new CalculationDecimal(discountText);

  if (discount.lte(0) || discount.gt(100)) {
    throw new RequestValidationError(
      "The discount must be greater than 0 and at most 100.",
    );
  }

  const variant = await MenuVariant.findOne({
    menu_variant_id: variantId,
    active: true,
  }).lean();

  if (!variant) {
    throw new RequestValidationError("Choose an active menu variant.");
  }

  const parent = await MenuItem.findOne({
    menu_item_id: variant.menu_item_id,
    active: true,
  }).lean();

  if (!parent) {
    throw new RequestValidationError("The parent menu item must be active.");
  }

  return PromotionHistory.create({
    promotion_id: `PROMO-${randomUUID()}`,
    promotion_date: date,
    service_period: servicePeriod,
    menu_item_id: variant.menu_item_id,
    menu_variant_id: variant.menu_variant_id,
    menu_variant_name: variant.menu_variant_name,
    discount_pct: discount.toString(),

    targeted_ingredient_id: null,
    targeted_ingredient_name: null,
    baseline_portions: null,
    actual_portions_sold: null,
    uplift_pct: null,
    at_risk_quantity: null,
    unit: null,
    estimated_waste_avoided_quantity: null,
    is_synthetic: false,
  });
}
