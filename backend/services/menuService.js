/**
 * Reads parent menu items for the management screen.
 */

import { MenuItem, MenuVariant } from "../models/index.js";
import { formatAud } from "../utils/decimal.js";
import {
  readPagination,
  buildPaginationMetadata,
} from "../utils/pagination.js";
import {
  RequestValidationError,
  selectAllowedFields,
  requireText,
} from "../utils/requestValidation.js";

/**
 * Formats a nullable MongoDB monetary value for display.
 */
function displayPrice(value) {
  return value === null || value === undefined ? "—" : `A$${formatAud(value)}`;
}

/**
 * Returns a filtered page of parent menu items.
 */
export async function listMenuItems(query) {
  const allowedQuery = selectAllowedFields(query, [
    "page",
    "pageSize",
    "active",
  ]);

  const pagination = readPagination(allowedQuery);

  const activeFilter = allowedQuery.active ?? "all";

  if (!["all", "true", "false"].includes(activeFilter)) {
    throw new RequestValidationError("active must be all, true or false.");
  }

  const filter = {};

  if (activeFilter !== "all") {
    filter.active = activeFilter === "true";
  }

  const [documents, totalRecords] = await Promise.all([
    MenuItem.find(filter)
      .select({
        _id: 0,
        menu_item_id: 1,
        menu_item_name_clean: 1,
        category: 1,
        active: 1,
        sale_price_aud_small: 1,
        sale_price_aud_large: 1,
      })
      .sort({
        menu_item_name_clean: 1,
        menu_item_id: 1,
      })
      .skip(pagination.skip)
      .limit(pagination.pageSize)
      .lean(),

    MenuItem.countDocuments(filter),
  ]);

  // Convert Decimal128 explicitly because lean() skips document transforms.
  const items = documents.map((document) => ({
    menu_item_id: document.menu_item_id,
    name: document.menu_item_name_clean,
    category: document.category || "Uncategorized",
    active: document.active,
    smallPrice: displayPrice(document.sale_price_aud_small),
    largePrice: displayPrice(document.sale_price_aud_large),
  }));

  return {
    items,
    activeFilter,
    pagination: buildPaginationMetadata(totalRecords, pagination),
  };
}

/**
 * Returns a parent menu item and its variants.
 *
 * Returns null when the parent does not exist.
 */
export async function getMenuItemDetails(menuItemId) {
  const validatedId = requireText(menuItemId, "menuItemId", 200);

  const document = await MenuItem.findOne({
    menu_item_id: validatedId,
  }).lean();

  if (!document) {
    return null;
  }

  const variantDocuments = await MenuVariant.find({
    menu_item_id: document.menu_item_id,
  })
    .sort({
      portion_size: 1,
      menu_variant_id: 1,
    })
    .lean();

  return {
    item: {
      menu_item_id: document.menu_item_id,
      name: document.menu_item_name_clean,
      sourceName: document.menu_item_name_source,
      category: document.category || "Uncategorized",
      active: document.active,
      smallPrice: displayPrice(document.sale_price_aud_small),
      largePrice: displayPrice(document.sale_price_aud_large),
      smallFoodCost: displayPrice(document.estimated_food_cost_aud_small),
      largeFoodCost: displayPrice(document.estimated_food_cost_aud_large),
      lunchPortions: document.base_lunch_portions ?? "—",
      dinnerPortions: document.base_dinner_portions ?? "—",
      tagCodes: document.menu_tag_codes,
    },

    variants: variantDocuments.map((variant) => ({
      menu_variant_id: variant.menu_variant_id,
      name: variant.menu_variant_name,
      portionSize: variant.portion_size,
      active: variant.active,
      salePrice: displayPrice(variant.sale_price_aud),
      foodCost: displayPrice(variant.estimated_food_cost_aud),
      grossMargin: displayPrice(variant.gross_margin_aud),
      trainingEligible: variant.demand_model_training_eligible,
      exclusionReason: variant.exclusion_reason,
    })),
  };
}
