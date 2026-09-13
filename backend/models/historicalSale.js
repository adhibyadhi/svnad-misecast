/**
 * Stores historical sales imported from POS JSON or CSV data.
 *
 * Original business identifiers and historical prices are preserved.
 * Services will validate references and reconcile sales calculations.
 */

import mongoose from "mongoose";
import {
  createMoneyField,
  createWholeNumberField,
  createDecimalField,
  createBusinessDateField,
} from "./schemaHelpers.js";

const historicalSaleSchema = new mongoose.Schema(
  {
    sales_record_id: {
      type: String,
      required: [true, "Sales record ID is required."],
      trim: true,
      immutable: true,
    },

    restaurant_id: {
      type: String,
      required: [true, "Restaurant ID is required."],
      trim: true,
    },

    date: createBusinessDateField({ required: true }),

    // Allowed service and channel values await actual CSV inspection.
    service_period: {
      type: String,
      required: [true, "Service period is required."],
      trim: true,
    },

    channel: {
      type: String,
      required: [true, "Sales channel is required."],
      trim: true,
    },

    menu_item_id: {
      type: String,
      required: [true, "Menu item ID is required."],
      trim: true,
    },

    menu_variant_id: {
      type: String,
      required: [true, "Menu variant ID is required."],
      trim: true,
    },

    // Historical descriptions must not change when today's menu changes.
    menu_item_name: {
      type: String,
      default: null,
    },

    portion_size: {
      type: String,
      trim: true,
      default: null,
    },

    quantity_sold: {
      ...createWholeNumberField(),
      required: [true, "Quantity sold is required."],
    },

    // Use the price recorded at the time of sale.
    unit_price_aud: {
      ...createMoneyField(),
      required: [true, "Historical unit price is required."],
    },

    // Missing discounts stay unknown rather than silently becoming zero.
    discount_pct: createDecimalField({
      minimum: 0,
      maximum: 100,
    }),

    gross_sales_aud: createMoneyField(),

    net_sales_aud: createMoneyField(),

    // Null means there is no linked promotion.
    promotion_id: {
      type: String,
      trim: true,
      default: null,
    },

    // Explicitly distinguish synthetic records from observed sales.
    is_synthetic: {
      type: Boolean,
      required: [true, "Synthetic data status is required."],
    },
  },
  {
    collection: "historical_sales",
    strict: "throw",
    versionKey: false,
  },
);

// A repeated import must reuse this identifier.
historicalSaleSchema.index({ sales_record_id: 1 }, { unique: true });

// Supports restaurant sales reports over a date range.
historicalSaleSchema.index({ restaurant_id: 1, date: 1 });

// Supports variant/service history used to calculate forecast features.
historicalSaleSchema.index({
  restaurant_id: 1,
  menu_variant_id: 1,
  service_period: 1,
  date: 1,
});

const HistoricalSale = mongoose.model("HistoricalSale", historicalSaleSchema);

export default HistoricalSale;
