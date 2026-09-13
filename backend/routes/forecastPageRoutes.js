import { Router } from "express";
import { getForecastReadiness } from "../services/forecastReadinessService.js";

const router = Router();

router.get("/", async (req, res) => {
  res.set("Cache-Control", "no-store");

  res.render("forecasts/index", {
    pageTitle: "Forecast readiness",
    report: await getForecastReadiness(),
  });
});

export default router;
