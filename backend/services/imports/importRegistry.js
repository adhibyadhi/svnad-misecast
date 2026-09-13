/**
 * Approved import entities and their existing business keys.
 *
 * Supporting collections cannot be imported through this registry.
 */

import * as models from "../../models/index.js";
import { RequestValidationError } from "../../utils/requestValidation.js";

/**
 * Creates immutable import configuration for one business model.
 */
function defineEntity(model, keyFields) {
  // Source fields only. MongoDB generates _id itself.
  const sourceFields = Object.keys(model.schema.paths).filter(
    (fieldName) => fieldName !== "_id" && fieldName !== "__v",
  );

  return Object.freeze({
    model,
    keyFields: Object.freeze(keyFields),
    sourceFields: Object.freeze(sourceFields),
  });
}

const importRegistry = Object.freeze({
  menu_items: defineEntity(models.MenuItem, ["menu_item_id"]),

  menu_variants: defineEntity(models.MenuVariant, ["menu_variant_id"]),

  ingredient_master: defineEntity(models.IngredientMaster, ["ingredient_id"]),

  menu_recipes: defineEntity(models.MenuRecipe, ["recipe_line_id"]),

  historical_sales: defineEntity(models.HistoricalSale, ["sales_record_id"]),

  inventory_batches_expiry: defineEntity(models.InventoryBatchExpiry, [
    "batch_id",
  ]),

  suppliers: defineEntity(models.Supplier, ["supplier_offer_id"]),

  promotion_history: defineEntity(models.PromotionHistory, ["promotion_id"]),

  weather: defineEntity(models.Weather, ["date", "record_type"]),

  reservations: defineEntity(models.Reservation, [
    "date",
    "service_period",
    "record_type",
  ]),

  local_events: defineEntity(models.LocalEvent, ["event_id"]),

  model_input_table: defineEntity(models.ModelInputTable, [
    "date",
    "service_period",
    "menu_variant_id",
  ]),

  demand_forecast: defineEntity(models.DemandForecast, ["forecast_id"]),

  ingredient_demand_forecast: defineEntity(models.IngredientDemandForecast, [
    "forecast_date",
    "ingredient_id",
  ]),

  runout_predictions: defineEntity(models.RunoutPrediction, [
    "prediction_as_of_date",
    "ingredient_id",
  ]),

  order_recommendations: defineEntity(models.OrderRecommendation, [
    "order_recommendation_id",
  ]),

  expiry_menu_actions: defineEntity(models.ExpiryMenuAction, [
    "expiry_action_id",
  ]),

  data_dictionary: defineEntity(models.DataDictionary, [
    "file_name",
    "field_order",
  ]),

  data_assumptions: defineEntity(models.DataAssumption, ["assumption_id"]),
});

/**
 * Returns approved configuration or rejects the entity name.
 */
export function getImportEntity(entityName) {
  if (
    typeof entityName !== "string" ||
    !Object.hasOwn(importRegistry, entityName)
  ) {
    throw new RequestValidationError("Unsupported import entity.");
  }

  return importRegistry[entityName];
}

/**
 * Friendly labels for the browser upload form.
 * Supported values still come from the existing import registry.
 */
const importLabels = Object.freeze({
  menu_items: "Menu items",
  menu_variants: "Menu variants",
  ingredient_master: "Ingredients",
  menu_recipes: "Menu recipes",
  historical_sales: "Historical sales",
  inventory_batches_expiry: "Inventory batches",
  suppliers: "Supplier offers",
  promotion_history: "Promotions",
  weather: "Weather",
  reservations: "Reservations",
  local_events: "Local events",
  model_input_table: "Model training data",
  demand_forecast: "Demand forecasts",
  ingredient_demand_forecast: "Ingredient demand forecasts",
  runout_predictions: "Stock runout predictions",
  order_recommendations: "Order recommendations",
  expiry_menu_actions: "Expiry menu actions",
  data_dictionary: "Data dictionary",
  data_assumptions: "Data assumptions",
});

export function listImportOptions() {
  return Object.keys(importRegistry).map((entityName) => ({
    value: entityName,
    label: importLabels[entityName] ?? entityName.replaceAll("_", " "),
  }));
}
