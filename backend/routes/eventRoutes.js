import { Router } from "express";
import {
  EventRefreshError,
  getSavedEvents,
  refreshEvents,
} from "../services/eventService.js";

const router = Router();

router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

router.get("/", async (req, res) => {
  res.json(await getSavedEvents());
});

router.post("/refresh", async (req, res, next) => {
  try {
    res.json(await refreshEvents());
  } catch (error) {
    if (!(error instanceof EventRefreshError)) {
      return next(error);
    }

    res.status(502).json({
      error: error.message,
      saved: await getSavedEvents(),
    });
  }
});

export default router;
