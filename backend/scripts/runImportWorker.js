/**
 * Processes currently available import jobs, then exits.
 *
 * Run:
 * node --env-file=.env scripts/runImportWorker.js
 */

import { connectDatabase, disconnectDatabase } from "../config/database.js";
import * as businessModels from "../models/index.js";
import * as supportingModels from "../models/supporting/index.js";
import { runNextImportJob } from "../services/imports/runNextImportJob.js";

let stopRequested = false;

function requestStop() {
  stopRequested = true;
  console.log("Stopping after the current row finishes...");
}

process.once("SIGINT", requestStop);
process.once("SIGTERM", requestStop);

try {
  await connectDatabase();

  const registeredModels = [
    ...Object.values(businessModels),
    ...Object.values(supportingModels),
  ];

  for (const model of registeredModels) {
    await model.init();
  }

  while (!stopRequested) {
    const result = await runNextImportJob({
      shouldStop: () => stopRequested,
    });

    if (!result) {
      console.log(
        "No claimable imports. The queue is empty or another worker is active.",
      );
      break;
    }

    console.log(JSON.stringify(result, null, 2));
  }
} catch (error) {
  console.error("Import worker stopped:", error.name);

  if (error.code !== undefined) {
    console.error("Database error code:", error.code);
  }

  process.exitCode = 1;
} finally {
  process.removeListener("SIGINT", requestStop);
  process.removeListener("SIGTERM", requestStop);

  await disconnectDatabase();
}
