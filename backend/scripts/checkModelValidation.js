/**
 * Checks representative model validation without connecting to MongoDB.
 *
 * Run:
 * node scripts/checkModelValidation.js
 */

import assert from "node:assert/strict";
import {
  MenuItem,
  HistoricalSale,
  DemandForecast,
  Weather,
} from "../models/index.js";

/**
 * Confirms that document validation rejects a particular field.
 */
async function expectInvalidField(document, fieldName) {
  await assert.rejects(
    () => document.validate(),
    (error) =>
      error.name === "ValidationError" &&
      Object.hasOwn(error.errors, fieldName),
  );
}

// Required business identifiers must be present.
await expectInvalidField(
  new MenuItem({
    menu_item_name_clean: "Validation dish",
    active: true,
  }),
  "menu_item_id",
);

// Money supplied as a string must retain its decimal value.
const menuItem = new MenuItem({
  menu_item_id: "CHECK-MENU-001",
  menu_item_name_clean: "Validation dish",
  active: true,
  sale_price_aud_small: "12.50",
});

await menuItem.validate();

assert.equal(menuItem.sale_price_aud_small.toString(), "12.50");
assert.equal(menuItem.toJSON().sale_price_aud_small, "12.50");

// Unknown prices remain null.
assert.equal(menuItem.sale_price_aud_large, null);

// Negative prices must fail validation.
menuItem.sale_price_aud_small = "-1.00";

await expectInvalidField(menuItem, "sale_price_aud_small");

// Misspelled fields must be rejected.
assert.throws(
  () =>
    new MenuItem({
      menu_item_id: "CHECK-MENU-002",
      menu_item_name_clean: "Validation dish",
      active: true,
      sale_prce_aud_small: "12.50",
    }),
  (error) => error.name === "StrictModeError",
);

const historicalSale = new HistoricalSale({
  sales_record_id: "CHECK-SALE-001",
  restaurant_id: "CHECK-RESTAURANT",
  date: "2026-02-28",
  service_period: "lunch",
  channel: "dine_in",
  menu_item_id: "CHECK-MENU-001",
  menu_variant_id: "CHECK-VARIANT-001",
  quantity_sold: 2,
  unit_price_aud: "12.50",
  is_synthetic: true,
});

await historicalSale.validate();

// Correct formatting alone must not allow an impossible date.
historicalSale.date = "2026-02-30";

await expectInvalidField(historicalSale, "date");

// A real leap day must pass and remain the same business date.
historicalSale.date = "2028-02-29";

await historicalSale.validate();
assert.equal(historicalSale.date, "2028-02-29");

// Sales quantities must be whole numbers.
historicalSale.quantity_sold = 1.5;

await expectInvalidField(historicalSale, "quantity_sold");

const weather = new Weather({
  date: "2026-09-14",
  record_type: "forecast",
  minimum_temperature_c: "-3.5",
  rain_probability_pct: "100",
  is_synthetic: true,
});

// Negative temperatures are valid.
await weather.validate();

// Percentages above 100 are invalid.
weather.rain_probability_pct = "100.01";

await expectInvalidField(weather, "rain_probability_pct");

const demandForecast = new DemandForecast({
  forecast_id: "CHECK-FORECAST-001",
  forecast_generated_date: "2026-09-13",
  forecast_date: "2026-09-14",
  forecast_horizon_days: 1,
  service_period: "lunch",
  menu_item_id: "CHECK-MENU-001",
  menu_variant_id: "CHECK-VARIANT-001",
  predicted_portions: "12.75",
  upper_bound_portions: "18.25",
  model_version: "validation-check",
  is_synthetic: true,
});

await demandForecast.validate();

// Unavailable model outputs must stay null rather than being invented.
assert.equal(demandForecast.lower_bound_portions, null);
assert.equal(demandForecast.forecast_confidence_pct, null);
assert.equal(demandForecast.key_demand_drivers, null);

console.log("Model validation checks passed.");
