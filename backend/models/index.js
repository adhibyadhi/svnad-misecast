/**
 * Central exports for all 19 business models.
 *
 * Importing this file registers the schemas with Mongoose.
 * It does not connect to MongoDB or insert documents.
 */

// Menu and recipes
export { default as MenuItem } from "./menuItem.js";
export { default as MenuVariant } from "./menuVariant.js";
export { default as IngredientMaster } from "./ingredientMaster.js";
export { default as MenuRecipe } from "./menuRecipe.js";

// Operations
export { default as HistoricalSale } from "./historicalSale.js";
export { default as InventoryBatchExpiry } from "./inventoryBatchExpiry.js";
export { default as Supplier } from "./supplier.js";
export { default as PromotionHistory } from "./promotionHistory.js";

// External context
export { default as Weather } from "./weather.js";
export { default as Reservation } from "./reservation.js";
export { default as LocalEvent } from "./localEvent.js";

// Model input
export { default as ModelInputTable } from "./modelInputTable.js";

// Forecasts and recommendations
export { default as DemandForecast } from "./demandForecast.js";
export { default as IngredientDemandForecast } from "./ingredientDemandForecast.js";
export { default as RunoutPrediction } from "./runoutPrediction.js";
export { default as OrderRecommendation } from "./orderRecommendation.js";
export { default as ExpiryMenuAction } from "./expiryMenuAction.js";

// Source documentation
export { default as DataDictionary } from "./dataDictionary.js";
export { default as DataAssumption } from "./dataAssumption.js";
