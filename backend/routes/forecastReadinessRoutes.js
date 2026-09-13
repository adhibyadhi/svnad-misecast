import { Router } from "express";
import { getForecastReadiness } from "../services/forecastReadinessService.js";
import { selectAllowedFields } from "../utils/requestValidation.js";

const router = Router();

router.get("/", async (req, res) => {
  selectAllowedFields(req.query, []);

  res.set("Cache-Control", "no-store");
  res.json(await getForecastReadiness());
});

export default router;
