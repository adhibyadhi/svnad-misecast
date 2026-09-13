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
  res.render("events/index", {
    pageTitle: "Nearby events",
    context: await getSavedEvents(),
    errorMessage: null,
  });
});

router.post("/refresh", async (req, res, next) => {
  try {
    await refreshEvents();
    res.redirect(303, "/events");
  } catch (error) {
    if (!(error instanceof EventRefreshError)) {
      return next(error);
    }

    res.status(502).render("events/index", {
      pageTitle: "Nearby events",
      context: await getSavedEvents(),
      errorMessage: error.message,
    });
  }
});

export default router;
