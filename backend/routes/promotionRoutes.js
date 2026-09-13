import { Router } from "express";
import {
  createPromotion,
  getPromotionOverview,
} from "../services/promotionService.js";
import { RequestValidationError } from "../utils/requestValidation.js";

const router = Router();

router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

router.get("/", async (req, res) => {
  res.render("promotions/index", {
    pageTitle: "Promotions",
    overview: await getPromotionOverview(),
    form: {},
    errorMessage: null,
  });
});

router.post("/", async (req, res, next) => {
  try {
    await createPromotion(req.body);
    res.redirect(303, "/promotions");
  } catch (error) {
    const validation =
      error instanceof RequestValidationError ||
      error?.name === "ValidationError";

    if (!validation) {
      return next(error);
    }

    const form = {};

    for (const field of [
      "promotion_date",
      "service_period",
      "menu_variant_id",
      "discount_pct",
    ]) {
      form[field] =
        typeof req.body?.[field] === "string" ? req.body[field] : "";
    }

    res.status(400).render("promotions/index", {
      pageTitle: "Promotions",
      overview: await getPromotionOverview(),
      form,
      errorMessage:
        error instanceof RequestValidationError
          ? error.message
          : "Check the promotion values and try again.",
    });
  }
});

export default router;
