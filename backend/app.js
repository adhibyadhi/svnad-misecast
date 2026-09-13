/**
 * Configures Express, request protection, local assets and routes.
 *
 * Server startup and database connection belong in server.js.
 */

import express from "express";
import { fileURLToPath } from "node:url";
import { environment } from "./config/environment.js";
import { restaurant } from "./config/restaurant.js";
import { createRequestOriginGuard } from "./middleware/requestOrigin.js";
import { notFoundHandler, errorHandler } from "./middleware/errorHandlers.js";
import importRoutes from "./routes/importRoutes.js";
import menuRoutes from "./routes/menuRoutes.js";
import weatherRoutes, { showWeatherJson } from "./routes/weatherRoutes.js";
import holidayRoutes, { showHolidaysJson } from "./routes/holidayRoutes.js";
import eventRoutes from "./routes/eventRoutes.js";
import eventPageRoutes from "./routes/eventPageRoutes.js";
import dailyContextRoutes from "./routes/dailyContextRoutes.js";
import contextPageRoutes from "./routes/contextPageRoutes.js";
import forecastReadinessRoutes from "./routes/forecastReadinessRoutes.js";
import forecastPageRoutes from "./routes/forecastPageRoutes.js";
import reservationRoutes, {
  showReservationsJson,
} from "./routes/reservationRoutes.js";
import importPageRoutes from "./routes/importPageRoutes.js";
import reservationEditRoutes from "./routes/reservationEditRoutes.js";
import promotionRoutes from "./routes/promotionRoutes.js";

const app = express();

const viewsDirectory = fileURLToPath(new URL("./views/", import.meta.url));

const publicDirectory = fileURLToPath(new URL("./public/", import.meta.url));

const bootstrapDirectory = fileURLToPath(
  new URL("./node_modules/bootstrap/dist/", import.meta.url),
);

app.disable("x-powered-by");

app.set("view engine", "ejs");
app.set("views", viewsDirectory);

// Read-only process configuration, not mutable restaurant records.
app.locals.restaurant = restaurant;

// Make navigation context available to error pages.
app.use((request, response, next) => {
  response.locals.currentPath = request.path;
  next();
});

app.use(createRequestOriginGuard(environment));

// Import uploads need original bytes and their own 20 MiB limit.
app.use("/api/imports", importRoutes);

app.use(express.json({ limit: "1mb" }));

app.use(
  express.urlencoded({
    extended: false,
    limit: "1mb",
    parameterLimit: 100,
  }),
);

app.use(
  "/vendor/bootstrap",
  express.static(bootstrapDirectory, { index: false }),
);

app.use(express.static(publicDirectory, { index: false }));

app.get("/", (request, response) => {
  response.render("home", {
    pageTitle: "Home",
  });
});

app.use("/menus", menuRoutes);
app.use("/weather", weatherRoutes);
app.get("/api/weather", showWeatherJson);
app.use("/holidays", holidayRoutes);
app.get("/api/holidays", showHolidaysJson);
app.use("/api/events", eventRoutes);
app.use("/events", eventPageRoutes);
app.use("/api/context", dailyContextRoutes);
app.use("/context", contextPageRoutes);
app.use("/api/forecasts/readiness", forecastReadinessRoutes);
app.use("/forecasts", forecastPageRoutes);
app.use("/reservations", reservationRoutes);
app.get("/api/reservations", showReservationsJson);
app.use("/imports", importPageRoutes);
app.use("/reservations", reservationEditRoutes);
app.use("/promotions", promotionRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
