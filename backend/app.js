/**
 * What this file does:
 * Creates and configures the Express application.
 */

import express from "express";

import homeRoutes from "./routes/homeRoutes.js";
import predictionRoutes from "./routes/predictionRoutes.js";
import importRoutes from "./routes/importRoutes.js";

import errorHandler from "./middleware/errorHandler.js";

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

/**
 * Error handler must come after routes.
 */
app.use(errorHandler);

export default app;
