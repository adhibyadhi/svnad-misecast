import { Router } from "express";
import { getDailyContext } from "../services/dailyContextService.js";
import { selectAllowedFields } from "../utils/requestValidation.js";

const router = Router();

router.get("/", async (req, res) => {
  // This endpoint currently always returns the next 14 days.
  selectAllowedFields(req.query, []);

  res.set("Cache-Control", "no-store");
  res.json(await getDailyContext());
});

export default router;
