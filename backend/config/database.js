/**
 * Opens and closes MongoDB connections.
 *
 * Application connections use validated environment configuration.
 * Test scripts can supply an explicit database URI.
 */

import mongoose from "mongoose";

/**
 * Connects to MongoDB.
 *
 * @param {string} [databaseUri] - Optional explicit connection string.
 * @returns {Promise<import("mongoose").Connection>} Active connection.
 */
export async function connectDatabase(databaseUri) {
  let resolvedDatabaseUri = databaseUri;

  if (resolvedDatabaseUri === undefined) {
    const { environment } = await import("./environment.js");
    resolvedDatabaseUri = environment.mongodbUri;
  }

  if (
    typeof resolvedDatabaseUri !== "string" ||
    resolvedDatabaseUri.trim() === ""
  ) {
    throw new Error("A MongoDB connection string is required.");
  }

  await mongoose.connect(resolvedDatabaseUri.trim(), {
    serverSelectionTimeoutMS: 5000,
  });

  console.log("MongoDB connected.");

  return mongoose.connection;
}

/**
 * Closes Mongoose connections when a script or application finishes.
 */
export async function disconnectDatabase() {
  await mongoose.disconnect();
}
