/**
 * What this file does:
 * Handles home page routes.
 *
 * The home dashboard uses real data from:
 *
 * - DailySales
 * - Menu
 * - Promotion
 * - RequestHistory
 * - PredictedSales
 */

import express from "express";

import DailySales from "../models/DailySales.js";
import Menu from "../models/Menu.js";
import Promotion from "../models/Promotion.js";
import RequestHistory from "../models/RequestHistory.js";
import PredictedSales from "../models/PredictedSales.js";

import { formatDate, getTodayDate } from "../utils/dateHelpers.js";

const router = express.Router();

const MENU_ITEM_COUNT = 15;

/**
 * Safely convert a value into a number.
 *
 * Invalid or missing values become 0.
 */
function safeNumber(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return 0;
  }

  return number;
}

/**
 * Safely convert a value into a Date.
 *
 * Invalid or missing dates return null.
 */
function safeDate(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}

/**
 * Add days to a UTC date.
 */
function addDays(date, numberOfDays) {
  const result = new Date(date.getTime());

  result.setUTCDate(result.getUTCDate() + numberOfDays);

  return result;
}

/**
 * Calculate menu price after discount.
 */
function calculateDiscountedPrice(price, percentageDiscount) {
  const safePrice = Math.max(0, safeNumber(price));

  const safeDiscount = Math.min(
    100,
    Math.max(0, safeNumber(percentageDiscount)),
  );

  const discount = safePrice * (safeDiscount / 100);

  return Number((safePrice - discount).toFixed(2));
}

/**
 * Create promotion lookup key.
 */
function promotionKey(dateString, menuName) {
  return `${dateString}::${menuName}`;
}

/**
 * Build a lookup containing the largest
 * promotion percentage for each menu/date.
 */
function buildPromotionMap(promotions = []) {
  const map = new Map();

  for (const promotion of promotions) {
    /**
     * Ignore missing promotion.
     */
    if (!promotion) {
      continue;
    }

    const promotionDate = safeDate(promotion.date);

    /**
     * Ignore invalid dates.
     */
    if (!promotionDate) {
      continue;
    }

    const menuName = promotion.menu_item;

    /**
     * Ignore promotion if no menu name exists.
     */
    if (!menuName) {
      continue;
    }

    const dateString = formatDate(promotionDate);

    const key = promotionKey(dateString, menuName);

    const percentage = Math.min(
      100,
      Math.max(0, safeNumber(promotion.percentage_discount)),
    );

    const existing = map.get(key) ?? 0;

    /**
     * If duplicate promotions exist,
     * use the largest discount.
     */
    if (percentage > existing) {
      map.set(key, percentage);
    }
  }

  return map;
}

/**
 * Get effective menu price for a date.
 */
function getEffectivePrice(menu, dateString, promotionMap) {
  /**
   * Missing menu means price is 0.
   */
  if (!menu) {
    return 0;
  }

  const menuName = menu.name;

  /**
   * Missing menu name means price is 0.
   */
  if (!menuName) {
    return 0;
  }

  const discount = promotionMap.get(promotionKey(dateString, menuName)) ?? 0;

  return calculateDiscountedPrice(menu.price, discount);
}

/**
 * Return true if a sales row falls
 * between two dates.
 */
function isInsideRange(row, startDate, endDate) {
  if (!row || !row.date) {
    return false;
  }

  return row.date >= startDate && row.date <= endDate;
}

/**
 * Summarise real sales for a period.
 */
function buildSalesSummary(
  salesRows = [],
  currentStart,
  currentEnd,
  previousStart,
  previousEnd,
) {
  const currentRows = salesRows.filter((row) =>
    isInsideRange(row, currentStart, currentEnd),
  );

  const previousRows = salesRows.filter((row) =>
    isInsideRange(row, previousStart, previousEnd),
  );

  /**
   * Current revenue.
   */
  const currentRevenue = currentRows.reduce(
    (total, row) => total + safeNumber(row.revenue),
    0,
  );

  /**
   * Previous revenue.
   */
  const previousRevenue = previousRows.reduce(
    (total, row) => total + safeNumber(row.revenue),
    0,
  );

  /**
   * Current items sold.
   */
  const currentItems = currentRows.reduce(
    (total, row) => total + safeNumber(row.amountSold),
    0,
  );

  /**
   * Previous items sold.
   */
  const previousItems = previousRows.reduce(
    (total, row) => total + safeNumber(row.amountSold),
    0,
  );

  /**
   * Average item value.
   *
   * Avoid dividing by zero.
   */
  const currentAverage = currentItems > 0 ? currentRevenue / currentItems : 0;

  const previousAverage =
    previousItems > 0 ? previousRevenue / previousItems : 0;

  /**
   * Revenue contribution by menu item.
   */
  const revenueByMenu = new Map();

  for (const row of currentRows) {
    if (!row.menuName) {
      continue;
    }

    const previous = revenueByMenu.get(row.menuName) ?? 0;

    revenueByMenu.set(row.menuName, previous + safeNumber(row.revenue));
  }

  const menuRevenue = [...revenueByMenu.entries()]
    .map(([name, revenue]) => ({
      name,

      revenue: Number(safeNumber(revenue).toFixed(2)),
    }))
    .sort((a, b) => b.revenue - a.revenue);

  /**
   * Always return a complete object,
   * even when there is no sales data.
   */
  return {
    startDate: formatDate(currentStart),

    endDate: formatDate(currentEnd),

    revenue: Number(currentRevenue.toFixed(2)),

    previousRevenue: Number(previousRevenue.toFixed(2)),

    itemsSold: currentItems,

    previousItemsSold: previousItems,

    averageItemValue: Number(currentAverage.toFixed(2)),

    previousAverageItemValue: Number(previousAverage.toFixed(2)),

    menuRevenue,
  };
}

/**
 * GET /
 */
router.get("/", async (req, res) => {
  try {
    const today = getTodayDate();

    /**
     * --------------------------------------------------
     * DATE RANGES
     * --------------------------------------------------
     */

    /**
     * Current 7 days.
     */
    const sevenStart = addDays(today, -6);

    const sevenPreviousStart = addDays(today, -13);

    const sevenPreviousEnd = addDays(today, -7);

    /**
     * Current 30 days.
     */
    const thirtyStart = addDays(today, -29);

    const thirtyPreviousStart = addDays(today, -59);

    const thirtyPreviousEnd = addDays(today, -30);

    /**
     * Current 12 calendar months.
     */
    const yearStart = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 11, 1),
    );

    /**
     * Previous 12 calendar months.
     */
    const previousYearStart = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 23, 1),
    );

    const previousYearEnd = addDays(yearStart, -1);

    /**
     * Forecast for next 7 days.
     */
    const forecastEnd = addDays(today, 7);

    /**
     * --------------------------------------------------
     * LOAD DATABASE DATA
     * --------------------------------------------------
     *
     * MongoDB returns [] if there are no documents.
     * That is completely safe.
     */

    const [
      menusResult,
      promotionsResult,
      dailySalesResult,
      requestHistoryResult,
    ] = await Promise.all([
      Menu.find({
        active: true,
      }).lean(),

      Promotion.find({
        date: {
          $gte: previousYearStart,

          $lte: forecastEnd,
        },
      }).lean(),

      DailySales.find({
        date: {
          $gte: previousYearStart,

          $lte: today,
        },
      }).lean(),

      RequestHistory.find({})
        .sort({
          date: -1,
        })
        .lean(),
    ]);

    /**
     * Extra safety.
     *
     * If anything unexpected is returned,
     * use an empty array instead.
     */
    const menus = Array.isArray(menusResult) ? menusResult : [];

    const promotions = Array.isArray(promotionsResult) ? promotionsResult : [];

    const dailySales = Array.isArray(dailySalesResult) ? dailySalesResult : [];

    const requestHistory = Array.isArray(requestHistoryResult)
      ? requestHistoryResult
      : [];

    /**
     * --------------------------------------------------
     * MENU LOOKUPS
     * --------------------------------------------------
     */

    const menuById = new Map();

    const menuByName = new Map();

    for (const menu of menus) {
      if (!menu) {
        continue;
      }

      if (menu._id) {
        menuById.set(String(menu._id), menu);
      }

      if (menu.name) {
        menuByName.set(menu.name, menu);
      }
    }

    const promotionMap = buildPromotionMap(promotions);

    /**
     * --------------------------------------------------
     * TURN DAILY SALES INTO REVENUE ROWS
     * --------------------------------------------------
     */

    const salesRows = [];

    for (const sale of dailySales) {
      /**
       * Missing sale.
       */
      if (!sale) {
        continue;
      }

      /**
       * Missing menu ID.
       */
      if (!sale.menu_id) {
        console.warn(
          `Skipping daily sales record ${sale._id ?? "unknown"} because menu_id is missing.`,
        );

        continue;
      }

      const menu = menuById.get(String(sale.menu_id));

      /**
       * IMPORTANT:
       *
       * Do NOT crash the page if the menu
       * item no longer exists.
       *
       * Just skip the bad sales row.
       */
      if (!menu) {
        console.warn(
          `Skipping daily sales record ${sale._id ?? "unknown"} because its menu item does not exist.`,
        );

        continue;
      }

      const saleDate = safeDate(sale.date);

      /**
       * Skip invalid date.
       */
      if (!saleDate) {
        console.warn(
          `Skipping daily sales record ${sale._id ?? "unknown"} because its date is invalid.`,
        );

        continue;
      }

      const dateString = formatDate(saleDate);

      /**
       * Missing amount sold becomes 0.
       */
      const amountSold = Math.max(0, safeNumber(sale.amount_sold));

      /**
       * Missing price becomes 0.
       */
      const unitPrice = getEffectivePrice(menu, dateString, promotionMap);

      salesRows.push({
        date: saleDate,

        dateString,

        menuName: menu.name ?? "Unknown menu item",

        amountSold,

        unitPrice,

        revenue: amountSold * unitPrice,
      });
    }

    /**
     * --------------------------------------------------
     * HISTORICAL SALES PERIODS
     * --------------------------------------------------
     */

    const periods = {
      7: buildSalesSummary(
        salesRows,
        sevenStart,
        today,
        sevenPreviousStart,
        sevenPreviousEnd,
      ),

      30: buildSalesSummary(
        salesRows,
        thirtyStart,
        today,
        thirtyPreviousStart,
        thirtyPreviousEnd,
      ),

      year: buildSalesSummary(
        salesRows,
        yearStart,
        today,
        previousYearStart,
        previousYearEnd,
      ),
    };

    /**
     * --------------------------------------------------
     * SAVED ML FORECASTS
     * --------------------------------------------------
     */

    const tomorrow = addDays(today, 1);

    /**
     * Only use valid future request history.
     */
    const futureHistory = requestHistory.filter((item) => {
      if (!item) {
        return false;
      }

      const date = safeDate(item.date);

      if (!date) {
        return false;
      }

      return date >= tomorrow && date <= forecastEnd;
    });

    /**
     * Avoid counting the same date multiple times.
     */
    const historyByDate = new Map();

    for (const history of futureHistory) {
      const historyDate = safeDate(history.date);

      if (!historyDate) {
        continue;
      }

      historyByDate.set(formatDate(historyDate), history);
    }

    const uniqueHistory = [...historyByDate.values()].sort(
      (a, b) => new Date(a.date) - new Date(b.date),
    );

    /**
     * Get valid prediction IDs only.
     */
    const predictionIds = uniqueHistory
      .map((item) => item.prediction_id)
      .filter(Boolean);

    /**
     * No prediction IDs means no database query required.
     */
    const predictions =
      predictionIds.length > 0
        ? await PredictedSales.find({
            _id: {
              $in: predictionIds,
            },
          }).lean()
        : [];

    /**
     * Prediction lookup.
     */
    const predictionById = new Map();

    for (const prediction of predictions) {
      if (prediction?._id) {
        predictionById.set(String(prediction._id), prediction);
      }
    }

    let forecastRevenue = 0;

    let forecastPortions = 0;

    let forecastDays = 0;

    /**
     * Dates that actually have
     * a valid prediction.
     */
    const forecastDates = [];

    for (const history of uniqueHistory) {
      /**
       * Missing prediction ID.
       */
      if (!history.prediction_id) {
        continue;
      }

      const prediction = predictionById.get(String(history.prediction_id));

      /**
       * Prediction was deleted or not found.
       *
       * Skip it instead of crashing.
       */
      if (!prediction) {
        continue;
      }

      const historyDate = safeDate(history.date);

      if (!historyDate) {
        continue;
      }

      const dateString = formatDate(historyDate);

      forecastDays++;

      forecastDates.push(historyDate);

      /**
       * Prediction contains 15 menu items.
       */
      for (let i = 1; i <= MENU_ITEM_COUNT; i++) {
        const menuName = prediction[`menu_${i}`];

        /**
         * Missing menu name.
         */
        if (!menuName) {
          continue;
        }

        const amount = Math.max(0, safeNumber(prediction[`menu_${i}_amount`]));

        const menu = menuByName.get(menuName);

        /**
         * Menu doesn't exist anymore.
         *
         * Skip it.
         */
        if (!menu) {
          continue;
        }

        const price = getEffectivePrice(menu, dateString, promotionMap);

        forecastPortions += amount;

        forecastRevenue += amount * price;
      }
    }

    /**
     * --------------------------------------------------
     * FORECAST RESULT
     * --------------------------------------------------
     *
     * No forecasts:
     *
     * revenue   = 0
     * portions  = 0
     * days      = 0
     * startDate = null
     * endDate   = null
     */

    const forecast = {
      revenue: Number(forecastRevenue.toFixed(2)),

      portions: forecastPortions,

      days: forecastDays,

      startDate: forecastDates.length > 0 ? formatDate(forecastDates[0]) : null,

      endDate:
        forecastDates.length > 0
          ? formatDate(forecastDates[forecastDates.length - 1])
          : null,
    };

    /**
     * --------------------------------------------------
     * SEND SAFE DATA TO HOME PAGE
     * --------------------------------------------------
     */

    return res.render("home", {
      requestHistory,

      salesDashboard: {
        today: formatDate(today),

        periods,

        forecast,
      },
    });
  } catch (error) {
    /**
     * This catch is now mainly for
     * real server/database failures,
     * not simply missing values.
     */
    console.error("Failed to load home dashboard:", error);

    return res
      .status(500)
      .send("Something went wrong while loading the dashboard.");
  }
});

export default router;
