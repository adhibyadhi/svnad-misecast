/**
 * Starts the local MiseCast application and automatic import processing.
 *
 * Run from the project root:
 * node --env-file=.env server.js
 */

import { createServer } from "node:http";

import app from "./app.js";
import { environment } from "./config/environment.js";
import { connectDatabase, disconnectDatabase } from "./config/database.js";

import * as models from "./models/index.js";
import * as supportingModels from "./models/supporting/index.js";

import { startImportWorker } from "./services/imports/startImportWorker.js";

const server = createServer(app);

let shutdownStarted = false;
let importWorker = null;

function closeHttpServer() {
  return new Promise((resolve, reject) => {
    if (!server.listening) {
      resolve();
      return;
    }

    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

/**
 * Stops incoming requests and import processing before disconnecting MongoDB.
 */
async function shutdown(exitCode = 0) {
  if (shutdownStarted) {
    return;
  }

  shutdownStarted = true;
  process.exitCode = exitCode;

  console.log("Stopping MiseCast...");

  const shutdownTimeout = setTimeout(() => {
    console.error("Shutdown timed out.");
    process.exit(1);
  }, 10000);

  shutdownTimeout.unref();

  try {
    const results = await Promise.allSettled([
      closeHttpServer(),
      importWorker ? importWorker.stop() : Promise.resolve(),
    ]);

    for (const result of results) {
      if (result.status === "rejected") {
        console.error("A shutdown operation did not finish cleanly.");
        process.exitCode = 1;
      }
    }

    await disconnectDatabase();

    console.log("MiseCast stopped.");
  } catch {
    console.error("Unable to complete shutdown cleanly.");
    process.exitCode = 1;
  } finally {
    clearTimeout(shutdownTimeout);
  }
}

try {
  await connectDatabase();
  const registeredModels = [
    ...Object.values(models),
    ...Object.values(supportingModels),
  ];

  for (const model of registeredModels) {
    await model.init();
  }

  await new Promise((resolve, reject) => {
    function handleStartupError(error) {
      reject(error);
    }

    server.once("error", handleStartupError);

    server.listen(environment.port, environment.host, () => {
      server.off("error", handleStartupError);
      resolve();
    });
  });

  server.on("error", (error) => {
    console.error("HTTP server error:", error.code || error.name);
    void shutdown(1);
  });

  process.once("SIGINT", () => {
    void shutdown();
  });

  process.once("SIGTERM", () => {
    void shutdown();
  });

  importWorker = startImportWorker();

  const displayHost = environment.host === "::1" ? "[::1]" : environment.host;

  console.log(`MiseCast running at http://${displayHost}:${environment.port}`);
} catch (error) {
  if (error.code === "EADDRINUSE") {
    console.error(
      "Startup failed: PORT is already in use. Stop the other server or change PORT.",
    );
  } else {
    console.error(
      "Startup failed. Check MongoDB, database indexes and environment settings.",
    );
    console.error(error);
  }

  await shutdown(1);
}
