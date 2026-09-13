/**
 * What this file does:
 * Creates and configures the Express application.
 */

import express from "express";

import homeRoutes from "./routes/homeRoutes.js";
import predictionRoutes from "./routes/predictionRoutes.js";
import importRoutes from "./routes/importRoutes.js";
import reservationRoutes from "./routes/reservationRoutes.js";

import errorHandler from "./middleware/errorHandler.js";
import menuRoutes from "./routes/menuRoutes.js";
import calendarRoutes from "./routes/calendarRoutes.js";

import weatherRoutes from "./routes/weatherRoutes.js";



const app = express();

/**
 * View engine
 */
app.set("view engine", "ejs");

/**
 * Read HTML form data.
 */
app.use(
  express.urlencoded({
    extended: true,
    limit: "10mb",
  }),
);

/**
 * Read JSON data.
 */
app.use(
  express.json({
    limit: "10mb",
  }),
);

/**
 * Public files.
 */
app.use(express.static("public"));

/**
 * Routes.
 */
app.use("/", homeRoutes);

app.use("/prediction", predictionRoutes);

app.use("/import", importRoutes);

app.use("/reservations", reservationRoutes);
app.use("/menu", menuRoutes);

/**
 * Error handler must come after routes.
 */
app.use(errorHandler);
app.use("/calendar", calendarRoutes);
app.use("/weather", weatherRoutes);
export default app;
