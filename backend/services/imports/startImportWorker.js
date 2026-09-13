/**
 * Processes queued imports while the application is running.
 *
 * Uses the application's existing MongoDB connection.
 * The existing job leases coordinate competing workers.
 */

import { runNextImportJob } from "./runNextImportJob.js";

export function startImportWorker() {
  let stopRequested = false;
  let wakeUp = null;

  function waitForNextCheck(milliseconds) {
    return new Promise((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        wakeUp = null;
        resolve();
      };

      const timer = setTimeout(finish, milliseconds);
      wakeUp = finish;

      if (stopRequested) {
        finish();
      }
    });
  }

  async function processQueue() {
    while (!stopRequested) {
      try {
        const result = await runNextImportJob({
          shouldStop: () => stopRequested,
        });

        if (stopRequested) {
          break;
        }

        // Process the next available job immediately.
        // Otherwise wait briefly before checking the queue again.
        if (!result) {
          await waitForNextCheck(2000);
        }
      } catch (error) {
        console.error("Import processing interrupted:", error?.name ?? "Error");

        if (!stopRequested) {
          await waitForNextCheck(5000);
        }
      }
    }
  }

  const completion = processQueue();

  console.log("Automatic import processing started.");

  return {
    async stop() {
      stopRequested = true;

      // Wake an idle worker immediately during application shutdown.
      wakeUp?.();

      // The existing worker checks shouldStop between rows.
      await completion;

      console.log("Automatic import processing stopped.");
    },
  };
}
