/**
 * What this file does:
 * Handles the menu list routes.
 *
 * Shows the 15 menu items grouped by category
 * with their current selling price.
 */

import express from "express";

import Menu from "../models/Menu.js";

const router = express.Router();

/**
 * Prediction requires exactly this many items.
 */
const EXPECTED_MENU_ITEM_COUNT = 15;

/**
 * Category display order and labels.
 */
const CATEGORY_GROUPS = [
  { code: "MAIN", label: "Mains" },
  { code: "SIDE", label: "Sides" },
  { code: "HOT_DRINK", label: "Hot drinks" },
  { code: "COLD_DRINK", label: "Cold drinks" },
];

/**
 * GET /menu
 */
router.get("/", async (req, res) => {
  let menuItems = [];

  try {
    menuItems = await Menu.find({})
      .sort({
        _id: 1,
      })
      .lean();
  } catch (databaseError) {
    console.error("Failed to load the menu:", databaseError);

    return res.status(500).render("menu", {
      error: "Could not load the menu from the database.",

      groups: [],

      totals: {
        itemCount: 0,

        categoryCount: 0,

        lowestPrice: 0,

        highestPrice: 0,
      },

      expectedItemCount: EXPECTED_MENU_ITEM_COUNT,
    });
  }

  /**
   * Group the items by category,
   * keeping the display order above.
   */
  const groups = CATEGORY_GROUPS.map((group) => {
    const items = menuItems.filter((item) => item.category === group.code);

    return {
      code: group.code,

      label: group.label,

      items: items.map((item) => ({
        id: item._id,

        name: item.name,

        price: Number(item.price).toFixed(2),
      })),

      itemCount: items.length,
    };
  }).filter((group) => group.itemCount > 0);

  /**
   * Summary values shown above the list.
   */
  const prices = menuItems.map((item) => Number(item.price));

  const totals = {
    itemCount: menuItems.length,

    categoryCount: groups.length,

    lowestPrice: prices.length > 0 ? Math.min(...prices).toFixed(2) : "0.00",

    highestPrice: prices.length > 0 ? Math.max(...prices).toFixed(2) : "0.00",
  };

  /**
   * The prediction pipeline needs exactly 15 items,
   * so warn as soon as the count is wrong.
   */
  let error = null;

  if (menuItems.length > 0 && menuItems.length !== EXPECTED_MENU_ITEM_COUNT) {
    error = `The menu holds ${menuItems.length} items. Predictions require exactly ${EXPECTED_MENU_ITEM_COUNT}.`;
  }

  return res.render("menu", {
    error: error,

    groups: groups,

    totals: totals,

    expectedItemCount: EXPECTED_MENU_ITEM_COUNT,
  });
});

export default router;
