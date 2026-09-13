/**
 * Claims and processes one ready import job.
 *
 * An expired running job is resumed before queued work.
 * The unique running-job index prevents concurrent imports.
 */

import { randomUUID } from "node:crypto";
import { ImportJob } from "../../models/supporting/index.js";
import { loadImportSource } from "./importSourceStorage.js";
import { parseImportFile } from "./parseImportFile.js";
import {
  processImportRow,
  ImportLeaseLostError,
  ImportOperationNeedsReviewError,
} from "./processImportRow.js";

const leaseDurationMilliseconds = 60000;

/**
 * Reclaims interrupted work or claims the oldest queued job.
 */
async function claimJob(leaseOwner) {
  const now = new Date();

  const resumedJob = await ImportJob.findOneAndUpdate(
    {
      record_kind: "job",
      status: "running",
      source_ready: true,
      lease_expires_at: { $lte: now },
    },
    {
      $set: {
        lease_owner: leaseOwner,
        lease_expires_at: new Date(now.getTime() + leaseDurationMilliseconds),
        error_summary: null,
      },
    },
    {
      new: true,
      runValidators: true,
    },
  );

  if (resumedJob) {
    return resumedJob;
  }

  try {
    return await ImportJob.findOneAndUpdate(
      {
        record_kind: "job",
        status: "queued",
        source_ready: true,
      },
      {
        $set: {
          status: "running",
          lease_owner: leaseOwner,
          lease_expires_at: new Date(Date.now() + leaseDurationMilliseconds),
          started_at: new Date(),
          error_summary: null,
        },
      },
      {
        sort: { created_at: 1, _id: 1 },
        new: true,
        runValidators: true,
      },
    );
  } catch (error) {
    // The unique running-job index means another worker is busy.
    if (error.code === 11000) {
      return null;
    }

    throw error;
  }
}

/**
 * Makes interrupted work immediately reclaimable.
 *
 * Ownership filtering prevents an old worker from releasing a new lease.
 */
async function releaseJob(importJobId, leaseOwner, message) {
  await ImportJob.updateOne(
    {
      record_kind: "job",
      import_job_id: importJobId,
      status: "running",
      lease_owner: leaseOwner,
    },
    {
      $set: {
        lease_owner: null,
        lease_expires_at: new Date(0),
        error_summary: message,
      },
    },
    { runValidators: true },
  );
}

/**
 * Processes one job.
 *
 * Returns null when there is no claimable work or another worker is active.
 * shouldStop is checked between committed rows.
 */
export async function runNextImportJob({ shouldStop = () => false } = {}) {
  const leaseOwner = randomUUID();
  const job = await claimJob(leaseOwner);

  if (!job) {
    return null;
  }

  try {
    const fileBuffer = await loadImportSource(job.import_job_id, {
      source_size_bytes: job.source_size_bytes,
      source_chunk_count: job.source_chunk_count,
      source_checksum: job.source_checksum,
    });

    const rows = parseImportFile(
      fileBuffer,
      job.source_format,
      job.entity_name,
    );

    const completedRows = job.checkpoint?.last_completed_row ?? 0;

    if (
      !Number.isSafeInteger(completedRows) ||
      completedRows < 0 ||
      completedRows > rows.length ||
      job.rows_processed !== completedRows
    ) {
      throw new Error("The import checkpoint does not match job progress.");
    }

    for (let rowIndex = completedRows; rowIndex < rows.length; rowIndex += 1) {
      if (shouldStop()) {
        await releaseJob(
          job.import_job_id,
          leaseOwner,
          "Worker stopped. Resume from the saved checkpoint.",
        );

        return {
          importJobId: job.import_job_id,
          status: "paused",
        };
      }

      await processImportRow({
        importJobId: job.import_job_id,
        leaseOwner,
        rowNumber: rowIndex + 1,
        input: rows[rowIndex],
      });
    }

    const currentJob = await ImportJob.findOne({
      record_kind: "job",
      import_job_id: job.import_job_id,
      status: "running",
      lease_owner: leaseOwner,
      lease_expires_at: { $gt: new Date() },
    }).lean();

    if (!currentJob) {
      throw new ImportLeaseLostError();
    }

    const totalOutcomes =
      currentJob.rows_inserted +
      currentJob.rows_updated +
      currentJob.rows_skipped +
      currentJob.rows_failed;

    if (
      currentJob.rows_processed !== rows.length ||
      currentJob.checkpoint?.last_completed_row !== rows.length ||
      totalOutcomes !== rows.length
    ) {
      throw new Error("Import counters do not match completed source rows.");
    }

    let finalStatus = "succeeded";

    if (currentJob.rows_failed === rows.length) {
      finalStatus = "failed";
    } else if (currentJob.rows_failed > 0) {
      finalStatus = "partial";
    }

    const result = await ImportJob.updateOne(
      {
        record_kind: "job",
        import_job_id: job.import_job_id,
        status: "running",
        lease_owner: leaseOwner,
        lease_expires_at: { $gt: new Date() },
        rows_processed: rows.length,
      },
      {
        $set: {
          status: finalStatus,
          finished_at: new Date(),
          lease_owner: null,
          lease_expires_at: null,
          error_summary:
            currentJob.rows_failed > 0
              ? `${currentJob.rows_failed} source rows failed validation.`
              : null,
        },
      },
      { runValidators: true },
    );

    if (result.matchedCount !== 1) {
      throw new ImportLeaseLostError();
    }

    return {
      importJobId: job.import_job_id,
      status: finalStatus,
      rowsProcessed: currentJob.rows_processed,
      rowsInserted: currentJob.rows_inserted,
      rowsUpdated: currentJob.rows_updated,
      rowsSkipped: currentJob.rows_skipped,
      rowsFailed: currentJob.rows_failed,
    };
  } catch (error) {
    // Infrastructure errors do not become failed source rows.
    // Leave the job recoverable and preserve its committed checkpoint.
    try {
      await releaseJob(
        job.import_job_id,
        leaseOwner,
        "Worker interrupted. Inspect the worker error before retrying.",
      );
    } catch {
      // If MongoDB is unavailable, the existing lease will expire.
      console.error("Unable to release the job lease; it will expire.");
    }

    throw error;
  }
}
