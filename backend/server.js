/**
 * Server entry point.
 *
 * Responsibilities:
 * 1. Connect to MongoDB using Mongoose
 * 2. Start the Express server
 */

import mongoose from "mongoose";
import app from "./app.js";

const PORT = process.env.PORT ?? 8080;
const HOST = process.env.IP ?? "127.0.0.1";

/**
 * Connect to MongoDB.
 */
async function connectToDatabase() {
  await mongoose.connect(process.env.MONGODB_URI, {
    dbName: process.env.DB_NAME,
  });

  console.log("Connected to MongoDB");
}

/**
 * Start application.
 *
 * Connect to MongoDB before accepting requests.
 */
connectToDatabase()
  .then(() => {
    app.listen(PORT, HOST, () => {
      console.log(`Server running on http://${HOST}:${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Failed to connect to MongoDB:", error);
    process.exit(1);
  });
