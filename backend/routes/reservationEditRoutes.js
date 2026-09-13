import { Router } from "express";
import {
  getReservationEditData,
  updateReservationForecast,
  ReservationEditError,
} from "../services/reservationService.js";
import { RequestValidationError } from "../utils/requestValidation.js";

const router = Router();

router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

router.get("/:id/edit", async (req, res, next) => {
  try {
    const form = await getReservationEditData(req.params.id);

    res.render("reservations/edit", {
      pageTitle: "Edit reservations",
      form,
      errorMessage: null,
    });
  } catch (error) {
    if (error instanceof ReservationEditError) {
      return res.status(error.status).type("text").send(error.message);
    }

    next(error);
  }
});

router.post("/:id/edit", async (req, res, next) => {
  try {
    await updateReservationForecast(req.params.id, req.body);
    res.redirect(303, "/reservations");
  } catch (error) {
    const expected =
      error instanceof ReservationEditError ||
      error instanceof RequestValidationError ||
      error?.name === "ValidationError";

    if (!expected) {
      return next(error);
    }

    let form;

    try {
      form = await getReservationEditData(req.params.id);
    } catch (loadError) {
      if (loadError instanceof ReservationEditError) {
        return res
          .status(loadError.status)
          .type("text")
          .send(loadError.message);
      }

      return next(loadError);
    }

    // Preserve the submitted revision as well as the user's values.
    // A conflict must not silently become an overwrite on resubmission.
    for (const field of [
      "revision",
      "bookings_count",
      "reserved_covers",
      "cancelled_covers",
      "confirmed_covers",
    ]) {
      form[field] =
        typeof req.body?.[field] === "string" ? req.body[field] : "";
    }

    res
      .status(error instanceof ReservationEditError ? error.status : 400)
      .render("reservations/edit", {
        pageTitle: "Edit reservations",
        form,
        errorMessage:
          error?.name === "ValidationError"
            ? "Check the reservation values and try again."
            : error.message,
      });
  }
});

export default router;
