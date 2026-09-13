import crypto from "crypto";

import Menu from "../models/Menu.js";
import Promotion from "../models/Promotion.js";
import DailyReservation from "../models/DailyReservation.js";

import { parseDate } from "./dateHelpers.js";

/**
 * Get all 15 menu items.
 */
async function getPredictionMenus() {
  const menus = await Menu.find({}).lean();

  /**
   * Keep menu order deterministic.
   */
  menus.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, {
      numeric: true,
      sensitivity: "base",
    }),
  );

  /**
   * Prediction requires exactly 15 menu items.
   */
  if (menus.length !== 15) {
    throw new Error(
      `Prediction requires exactly 15 menu items. Currently found ${menus.length}.`,
    );
  }

  return menus;
}

/**
 * Calculate menu price after promotion.
 */
function calculateDiscountedPrice(price, percentageDiscount) {
  const discountAmount = price * (percentageDiscount / 100);

  const finalPrice = price - discountAmount;

  return Number(finalPrice.toFixed(2));
}

/**
 * Build ML input for ONE date.
 */
export async function buildMLInputForDate(dateString) {
  const date = parseDate(dateString);

  /**
   * Get all 15 menu items.
   */
  const menus = await getPredictionMenus();

  /**
   * Get reservation data for this date.
   */
  const reservation = await DailyReservation.findOne({
    date: date,
  }).lean();

  /**
   * Get promotions for this date.
   */
  const promotions = await Promotion.find({
    date: date,
  }).lean();

  /**
   * Start building ML input.
   */
  const mlInput = {
    _id: crypto.randomUUID(),

    date: date,
  };

  /**
   * Add all 15 menu items.
   */
  for (let i = 0; i < menus.length; i++) {
    const menu = menus[i];

    const menuNumber = i + 1;

    /**
     * Find promotion for this menu item.
     */
    const promotion = promotions.find((item) => item.menu_item === menu.name);

    /**
     * If no promotion exists,
     * discount is 0%.
     */
    const percentageDiscount = promotion
      ? Number(promotion.percentage_discount)
      : 0;

    /**
     * Calculate price after discount.
     */
    const priceAfterDiscount = calculateDiscountedPrice(
      Number(menu.price),
      percentageDiscount,
    );

    /**
     * Example:
     *
     * menu_1
     * menu_1_price_after_discount
     */
    mlInput[`menu_${menuNumber}`] = menu.name;

    mlInput[`menu_${menuNumber}_price_after_discount`] = priceAfterDiscount;
  }

  /**
   * Reservation input.
   */
  mlInput.total_reservation = reservation?.total_reservation ?? 0;

  /**
   * These values are filled in later
   * from external APIs.
   */
  mlInput.avg_temp = null;

  mlInput.rain = null;

  mlInput.public_holiday = null;

  mlInput.num_of_event = null;

  return mlInput;
}

/**
 * Build a predicted_sales_from_ml document from one ML input
 * and the FastAPI prediction result for that same day.
 *
 * apiResult.predictions looks like { menu_1: 33, menu_2: 24, ... } --
 * menu names come from mlInput, amounts come from apiResult.
 */
export function buildPredictionDocument(mlInput, apiResult) {
  if (!apiResult || !apiResult.predictions) {
    throw new Error("ML API response is missing a `predictions` object.");
  }

  const prediction = {};

  for (let i = 1; i <= 15; i++) {
    const menuKey = `menu_${i}`;
    const amountKey = `menu_${i}_amount`;

    const amount = apiResult.predictions[menuKey];

    if (amount === undefined) {
      throw new Error(`ML API response is missing a prediction for ${menuKey}.`);
    }

    prediction[menuKey] = mlInput[menuKey];
    prediction[amountKey] = amount;
  }

  return prediction;
}
