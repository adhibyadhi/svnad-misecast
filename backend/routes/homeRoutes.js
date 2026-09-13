/**
 * What this file does:
 * Handles home page routes.
 */

import express from "express";
import RequestHistory from "../models/RequestHistory.js";

const router = express.Router();

/**
 * GET /
 */
router.get("/", async (req, res) => {
  try {
    const requestHistory = await RequestHistory.find({})
      .sort({
        date: -1,
      })
      .lean();

    return res.render("home", {
      requestHistory: requestHistory,
    });
  } catch (error) {
    console.error("Failed to load request history:", error);

    return res.status(500).send("Something went wrong.");
  }
});

export default router;
