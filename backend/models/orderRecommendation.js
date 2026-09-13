/**
 * Stores ingredient ordering recommendations.
 *
 * Services will calculate pack rounding, supplier eligibility,
 * delivery dates and supplier-level delivery charges.
 */

import mongoose from "mongoose";
import {
  createMoneyField,
  createWholeNumberField,
  createDecimalField,
  createBusinessDateField,
  createLocalTimeField,
} from "./schemaHelpers.js";

const orderRecommendationSchema = new mongoose.Schema(
  {
    order_recommendation_id: {
      type: String,
      required: [true, "Order recommendation ID is required."],
      trim: true,
      immutable: true,
    },

    recommendation_date: createBusinessDateField({ required: true }),

    ingredient_id: {
      type: String,
      required: [true, "Ingredient ID is required."],
      trim: true,
    },

    ingredient_name: {
      type: String,
      default: null,
    },

    unit: {
      type: String,
      required: [true, "Order recommendation unit is required."],
      trim: true,
    },

    order_required: {
      type: Boolean,
      required: [true, "Order required status is required."],
    },

    forecast_demand_quantity: createDecimalField({ minimum: 0 }),

    usable_current_inventory_quantity: createDecimalField({ minimum: 0 }),

    safety_stock_quantity: createDecimalField({ minimum: 0 }),

    // Preserve signed values until the source calculation is verified.
    // A negative raw requirement may represent surplus stock.
    raw_order_requirement_quantity: createDecimalField(),

    // Final recommendations cannot contain negative order quantities.
    recommended_order_packs: createWholeNumberField(),

    pack_size: createDecimalField({ minimum: 0 }),

    recommended_order_quantity: createDecimalField({ minimum: 0 }),

    projected_end_stock_after_order: createDecimalField({ minimum: 0 }),

    // May be null when no suitable supplier has been established.
    supplier_id: {
      type: String,
      trim: true,
      default: null,
    },

    supplier_name: {
      type: String,
      default: null,
    },

    unit_cost_aud: createMoneyField(),

    line_subtotal_aud: createMoneyField(),

    // Supplier-level amounts may repeat across ingredient rows.
    // Services must apply delivery charges once per supplier order.
    supplier_delivery_fee_aud: createMoneyField(),

    estimated_total_supplier_order_aud: createMoneyField(),

    order_cutoff_time: createLocalTimeField(),

    expected_delivery_date: createBusinessDateField(),

    // Allowed urgency labels await source and calculation-rule review.
    order_urgency: {
      type: String,
      trim: true,
      default: null,
    },

    recommendation_reason: {
      type: String,
      default: null,
    },

    is_synthetic: {
      type: Boolean,
      required: [true, "Synthetic data status is required."],
    },
  },
  {
    collection: "order_recommendations",
    strict: "throw",
    versionKey: false,
  },
);

orderRecommendationSchema.index(
  { order_recommendation_id: 1 },
  { unique: true },
);

// Supports listing recommendations for a date.
orderRecommendationSchema.index({
  recommendation_date: 1,
  order_required: 1,
});

// Supports grouping recommendations by supplier.
orderRecommendationSchema.index({
  supplier_id: 1,
  recommendation_date: 1,
});

const OrderRecommendation = mongoose.model(
  "OrderRecommendation",
  orderRecommendationSchema,
);

export default OrderRecommendation;
