import { Router } from "express";
import {
  createReservationForecast,
  getReservationOverview,
  ReservationConflictError,
} from "../services/reservationService.js";
import { RequestValidationError } from "../utils/requestValidation.js";

const router = Router();

router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

router.get("/", async (req, res) => {
  res.render("reservations/index", {
    pageTitle: "Reservations",
    overview: await getReservationOverview(),
    form: {},
    errorMessage: null,
  });
});

router.post("/", async (req, res, next) => {
  try {
    await createReservationForecast(req.body);
    res.redirect(303, "/reservations");
  } catch (error) {
    const conflict = error instanceof ReservationConflictError;
    const validation =
      error instanceof RequestValidationError ||
      error?.name === "ValidationError";

    if (!conflict && !validation) {
      return next(error);
    }

    const form = {};

    for (const field of [
      "date",
      "service_period",
      "bookings_count",
      "reserved_covers",
      "cancelled_covers",
      "confirmed_covers",
    ]) {
      form[field] =
        typeof req.body?.[field] === "string" ? req.body[field] : "";
    }

    res.status(conflict ? 409 : 400).render("reservations/index", {
      pageTitle: "Reservations",
      overview: await getReservationOverview(),
      form,
      errorMessage:
        validation && !(error instanceof RequestValidationError)
          ? "Check the reservation values and try again."
          : error.message,
    });
  }
});

export async function showReservationsJson(req, res) {
  res.set("Cache-Control", "no-store");
  res.json(await getReservationOverview());
}

export default router;
