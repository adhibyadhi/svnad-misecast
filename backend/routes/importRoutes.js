/**
 * What this file does:
 * Handles CSV import routes.
 */

import express from "express";
import crypto from "crypto";

import Menu from "../models/Menu.js";
import Promotion from "../models/Promotion.js";
import DailyReservation from "../models/DailyReservation.js";
import DailySales from "../models/DailySales.js";

import { parseDate } from "../utils/dateHelpers.js";

import { handleMongooseError } from "../utils/mongooseHelpers.js";

const router = express.Router();

const validMenuNames = [
  "Chicken Teriyaki Bowl",
  "Sashimi Poke Bowl",
  "Wagyu Beef Bowl",
  "Miso Falafel Bowl",
  "Karaage Chicken Bowl",
  "Tofu Bowl",
  "Salmon Aburi Bowl",
  "Miso soup",
  "Bone Broth soup",
  "Coconut water",
  "Sparkling water",
  "Yuzu tea",
  "Specialty Soda",
  "Hot Chocolate",
  "Still waterr",
];

const validCategories = ["HOT_DRINK", "COLD_DRINK", "MAIN", "SIDE"];

/**
 * GET /import
 */
router.get("/", (req, res) => {
  return res.render("import");
});

/**
 * POST /import/menu
 */
router.post("/menu", async (req, res) => {
  try {
    const { filename, rows } = req.body;

    if (filename !== "menu.csv") {
      return res.status(400).json({
        error: "Only menu.csv can be imported here.",
      });
    }

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({
        error: "menu.csv contains no data.",
      });
    }

    let importedCount = 0;

    for (const row of rows) {
      const name = row.name?.trim();

      const category = row.category?.trim();

      const price = Number(row.price);

      if (!name || !category || row.price === undefined || row.price === "") {
        return res.status(400).json({
          error: "menu.csv requires name, category and price.",
        });
      }

      if (!validMenuNames.includes(name)) {
        return res.status(400).json({
          error: `Invalid menu name: ${name}`,
        });
      }

      if (!validCategories.includes(category)) {
        return res.status(400).json({
          error: `Invalid category for ${name}.`,
        });
      }

      if (!Number.isFinite(price) || price < 0) {
        return res.status(400).json({
          error: `Invalid price for ${name}.`,
        });
      }

      const existingMenu = await Menu.findOne({
        name: name,
      });

      if (existingMenu) {
        existingMenu.category = category;

        existingMenu.price = price;

        await existingMenu.save();
      } else {
        await Menu.create({
          _id: crypto.randomUUID(),

          name: name,

          category: category,

          price: price,
        });
      }

      importedCount++;
    }

    return res.json({
      imported: importedCount,
    });
  } catch (error) {
    return handleMongooseError(res, error, "Menu import failed.");
  }
});

/**
 * POST /import/promotions
 */
router.post("/promotions", async (req, res) => {
  try {
    const { filename, rows } = req.body;

    if (filename !== "promotion.csv") {
      return res.status(400).json({
        error: "Only promotion.csv can be imported here.",
      });
    }

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({
        error: "promotion.csv contains no data.",
      });
    }

    let importedCount = 0;

    for (const row of rows) {
      const menuItem = row.menu_item?.trim();

      const percentageDiscount = Number(row.percentage_discount);

      const dateString = row.date?.trim();

      if (
        !menuItem ||
        !dateString ||
        row.percentage_discount === undefined ||
        row.percentage_discount === ""
      ) {
        return res.status(400).json({
          error:
            "promotion.csv requires menu_item, percentage_discount and date.",
        });
      }

      const menu = await Menu.findOne({
        name: menuItem,
      });

      if (!menu) {
        return res.status(400).json({
          error: `Menu item ${menuItem} does not exist.`,
        });
      }

      if (
        !Number.isFinite(percentageDiscount) ||
        percentageDiscount < 0 ||
        percentageDiscount > 100
      ) {
        return res.status(400).json({
          error: `Invalid discount for ${menuItem}.`,
        });
      }

      const parsedDate = parseDate(dateString);

      if (Number.isNaN(parsedDate.getTime())) {
        return res.status(400).json({
          error: `Invalid date: ${dateString}`,
        });
      }

      const existingPromotion = await Promotion.findOne({
        menu_item: menuItem,
        date: parsedDate,
      });

      if (existingPromotion) {
        existingPromotion.percentage_discount = percentageDiscount;

        await existingPromotion.save();
      } else {
        await Promotion.create({
          _id: crypto.randomUUID(),
          menu_item: menuItem,
          percentage_discount: percentageDiscount,
          date: parsedDate,
        });
      }

      importedCount++;
    }

    return res.json({
      imported: importedCount,
    });
  } catch (error) {
    return handleMongooseError(res, error, "Promotion import failed.");
  }
});

/**
 * POST /import/reservations
 */
router.post("/reservations", async (req, res) => {
  try {
    const { filename, rows } = req.body;

    if (filename !== "daily_reservation.csv") {
      return res.status(400).json({
        error: "Only daily_reservation.csv can be imported here.",
      });
    }

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({
        error: "daily_reservation.csv contains no data.",
      });
    }

    let importedCount = 0;

    for (const row of rows) {
      const dateString = row.date?.trim();

      const totalReservation = Number(row.total_reservation);

      const totalPeople = Number(row.total_people);

      if (
        !dateString ||
        row.total_reservation === undefined ||
        row.total_reservation === "" ||
        row.total_people === undefined ||
        row.total_people === ""
      ) {
        return res.status(400).json({
          error:
            "daily_reservation.csv requires date, total_reservation and total_people.",
        });
      }

      const parsedDate = parseDate(dateString);

      if (Number.isNaN(parsedDate.getTime())) {
        return res.status(400).json({
          error: `Invalid date: ${dateString}`,
        });
      }

      if (!Number.isInteger(totalReservation) || totalReservation < 0) {
        return res.status(400).json({
          error: `Invalid total_reservation for ${dateString}.`,
        });
      }

      if (!Number.isInteger(totalPeople) || totalPeople < 0) {
        return res.status(400).json({
          error: `Invalid total_people for ${dateString}.`,
        });
      }

      const existingReservation = await DailyReservation.findOne({
        date: parsedDate,
      });

      if (existingReservation) {
        existingReservation.total_reservation = totalReservation;

        existingReservation.total_people = totalPeople;

        await existingReservation.save();
      } else {
        await DailyReservation.create({
          _id: crypto.randomUUID(),

          date: parsedDate,

          total_reservation: totalReservation,

          total_people: totalPeople,
        });
      }

      importedCount++;
    }

    return res.json({
      imported: importedCount,
    });
  } catch (error) {
    return handleMongooseError(res, error, "Reservation import failed.");
  }
});

/**
 * POST /import/sales
 */
router.post("/sales", async (req, res) => {
  try {
    const { filename, rows } = req.body;

    if (filename !== "daily_sales.csv") {
      return res.status(400).json({
        error: "Only daily_sales.csv can be imported here.",
      });
    }

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({
        error: "daily_sales.csv contains no data.",
      });
    }

    let importedCount = 0;

    for (const row of rows) {
      const dateString = row.date?.trim();

      const menuName = row.menu_name?.trim();

      const amountSold = Number(row.amount_sold);

      if (
        !dateString ||
        !menuName ||
        row.amount_sold === undefined ||
        row.amount_sold === ""
      ) {
        return res.status(400).json({
          error: "daily_sales.csv requires date, menu_name and amount_sold.",
        });
      }

      const parsedDate = parseDate(dateString);

      if (Number.isNaN(parsedDate.getTime())) {
        return res.status(400).json({
          error: `Invalid date: ${dateString}`,
        });
      }

      if (!Number.isInteger(amountSold) || amountSold < 0) {
        return res.status(400).json({
          error: `Invalid amount_sold for ${menuName} on ${dateString}.`,
        });
      }

      /**
       * Make sure the menu item exists.
       */
      const menu = await Menu.findOne({
        name: menuName,
      });

      if (!menu) {
        return res.status(400).json({
          error: `Menu item ${menuName} does not exist.`,
        });
      }

      const existingSale = await DailySales.findOne({
        date: parsedDate,

        menu_id: menu._id,
      });

      if (existingSale) {
        existingSale.amount_sold = amountSold;

        await existingSale.save();
      } else {
        await DailySales.create({
          _id: crypto.randomUUID(),

          date: parsedDate,

          menu_id: menu._id,

          amount_sold: amountSold,
        });
      }

      importedCount++;
    }

    return res.json({
      imported: importedCount,
    });
  } catch (error) {
    return handleMongooseError(res, error, "Daily sales import failed.");
  }
});

export default router;
