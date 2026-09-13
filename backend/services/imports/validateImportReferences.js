/**
 * Validates import relationships using an optional transaction session.
 *
 * Input must be the final, schema-validated candidate document.
 */

import * as models from "../../models/index.js";
import { RequestValidationError } from "../../utils/requestValidation.js";
import { getImportEntity } from "./importRegistry.js";

/**
 * Validates one row's references and restaurant identity.
 */
export async function validateImportReferences(
  entityName,
  row,
  restaurantId,
  session = null,
) {
  getImportEntity(entityName);

  if (typeof restaurantId !== "string" || restaurantId.trim() === "") {
    throw new Error("A configured restaurant ID is required.");
  }

  if (
    Object.hasOwn(row, "restaurant_id") &&
    row.restaurant_id !== restaurantId
  ) {
    throw new RequestValidationError(
      "The row's restaurant_id does not match the configured restaurant.",
    );
  }

  /**
   * Reads a reference using the caller's transaction session.
   */
  async function requireReference(model, fieldName, value) {
    const document = await model
      .findOne({ [fieldName]: value })
      .session(session)
      .lean();

    if (!document) {
      throw new RequestValidationError(
        `Referenced record was not found for ${fieldName}.`,
      );
    }

    return document;
  }

  /**
   * Checks the parent menu item and variant relationship.
   */
  async function validateMenuRelationship(menuItemId, menuVariantId) {
    if (menuItemId !== null && menuItemId !== undefined) {
      await requireReference(models.MenuItem, "menu_item_id", menuItemId);
    }

    if (menuVariantId !== null && menuVariantId !== undefined) {
      const variant = await requireReference(
        models.MenuVariant,
        "menu_variant_id",
        menuVariantId,
      );

      if (
        menuItemId !== null &&
        menuItemId !== undefined &&
        variant.menu_item_id !== menuItemId
      ) {
        throw new RequestValidationError(
          "The menu variant does not belong to the stated menu item.",
        );
      }
    }
  }

  switch (entityName) {
    case "menu_variants":
      await requireReference(models.MenuItem, "menu_item_id", row.menu_item_id);
      break;

    case "menu_recipes":
      await validateMenuRelationship(row.menu_item_id, row.menu_variant_id);
      await requireReference(
        models.IngredientMaster,
        "ingredient_id",
        row.ingredient_id,
      );
      break;

    case "historical_sales":
      await validateMenuRelationship(row.menu_item_id, row.menu_variant_id);

      if (row.promotion_id !== null && row.promotion_id !== undefined) {
        const promotion = await requireReference(
          models.PromotionHistory,
          "promotion_id",
          row.promotion_id,
        );

        if (
          promotion.menu_item_id !== row.menu_item_id ||
          promotion.menu_variant_id !== row.menu_variant_id
        ) {
          throw new RequestValidationError(
            "The linked promotion belongs to a different menu item or variant.",
          );
        }
      }
      break;

    case "inventory_batches_expiry":
    case "suppliers":
    case "ingredient_demand_forecast":
    case "runout_predictions":
      await requireReference(
        models.IngredientMaster,
        "ingredient_id",
        row.ingredient_id,
      );
      break;

    case "promotion_history":
      await validateMenuRelationship(row.menu_item_id, row.menu_variant_id);

      if (
        row.targeted_ingredient_id !== null &&
        row.targeted_ingredient_id !== undefined
      ) {
        await requireReference(
          models.IngredientMaster,
          "ingredient_id",
          row.targeted_ingredient_id,
        );
      }
      break;

    case "model_input_table":
    case "demand_forecast":
      await validateMenuRelationship(row.menu_item_id, row.menu_variant_id);
      break;

    case "order_recommendations":
      await requireReference(
        models.IngredientMaster,
        "ingredient_id",
        row.ingredient_id,
      );

      if (row.supplier_id !== null && row.supplier_id !== undefined) {
        const offerExists = await models.Supplier.exists({
          supplier_id: row.supplier_id,
          ingredient_id: row.ingredient_id,
        }).session(session);

        if (!offerExists) {
          throw new RequestValidationError(
            "No supplier offer exists for the stated supplier and ingredient.",
          );
        }
      }
      break;

    case "expiry_menu_actions": {
      await requireReference(
        models.IngredientMaster,
        "ingredient_id",
        row.ingredient_id,
      );

      const batch = await requireReference(
        models.InventoryBatchExpiry,
        "batch_id",
        row.batch_id,
      );

      if (batch.restaurant_id !== restaurantId) {
        throw new RequestValidationError(
          "The referenced batch belongs to a different restaurant.",
        );
      }

      if (batch.ingredient_id !== row.ingredient_id) {
        throw new RequestValidationError(
          "The referenced batch contains a different ingredient.",
        );
      }

      await validateMenuRelationship(
        row.recommended_menu_item_id,
        row.recommended_menu_variant_id,
      );

      if (
        row.recommended_menu_variant_id !== null &&
        row.recommended_menu_variant_id !== undefined
      ) {
        const recipeExists = await models.MenuRecipe.exists({
          menu_variant_id: row.recommended_menu_variant_id,
          ingredient_id: row.ingredient_id,
        }).session(session);

        if (!recipeExists) {
          throw new RequestValidationError(
            "The recommended variant has no recipe for this ingredient.",
          );
        }
      }

      break;
    }

    case "menu_items":
    case "ingredient_master":
    case "weather":
    case "reservations":
    case "local_events":
    case "data_dictionary":
    case "data_assumptions":
      break;

    default:
      throw new Error(
        "Reference validation is not configured for this entity.",
      );
  }
}
