/**
 * Processes one import row without a MongoDB transaction.
 *
 * Write order:
 * 1. Save the intended operation.
 * 2. Claim and apply that operation.
 * 3. Save the row result.
 * 4. Atomically advance the job's counters and checkpoint.
 *
 * An interrupted business write requires review if its outcome
 * cannot be established safely.
 */

import {
  ImportJob,
  ImportRowResult,
  ImportRowOperation,
} from "../../models/supporting/index.js";

import { prepareImportOperation } from "./prepareImportOperation.js";

import { applyPreparedImportRow } from "./saveImportRow.js";

const leaseDurationMilliseconds = 60000;

const outcomeCounters = Object.freeze({
  inserted: "rows_inserted",
  updated: "rows_updated",
  skipped: "rows_skipped",
  failed: "rows_failed",
});

export class ImportLeaseLostError extends Error {
  constructor() {
    super("The import worker no longer owns an active job lease.");
    this.name = "ImportLeaseLostError";
  }
}

export class ImportOperationNeedsReviewError extends Error {
  constructor(rowNumber) {
    super(
      `Row ${rowNumber} has an unconfirmed business write. ` +
        "The import is paused for review; do not resubmit it as a new job.",
    );

    this.name = "ImportOperationNeedsReviewError";
  }
}

function ownershipFilter(importJobId, leaseOwner) {
  return {
    record_kind: "job",
    import_job_id: importJobId,
    status: "running",
    source_ready: true,
    lease_owner: leaseOwner,
    lease_expires_at: { $gt: new Date() },
  };
}

async function renewLease(importJobId, leaseOwner) {
  const job = await ImportJob.findOneAndUpdate(
    ownershipFilter(importJobId, leaseOwner),
    {
      $set: {
        lease_expires_at: new Date(Date.now() + leaseDurationMilliseconds),
      },
    },
    {
      new: true,
      runValidators: true,
    },
  );

  if (!job) {
    throw new ImportLeaseLostError();
  }

  return job;
}

async function requireOperationReview(operation) {
  await ImportRowOperation.updateOne(
    {
      _id: operation._id,
      state: "applying",
    },
    {
      $set: {
        state: "needs_review",
        review_reason:
          "The previous write attempt did not record a confirmed outcome.",
      },
    },
    { runValidators: true },
  );

  throw new ImportOperationNeedsReviewError(operation.row_number);
}

async function applyOperation(operation, importJobId, leaseOwner) {
  if (operation.state === "applied") {
    return operation;
  }

  if (operation.state === "needs_review") {
    throw new ImportOperationNeedsReviewError(operation.row_number);
  }

  if (operation.state === "applying") {
    // Do not repeat a write whose previous outcome is uncertain.
    await requireOperationReview(operation);
  }

  await renewLease(importJobId, leaseOwner);

  const claimed = await ImportRowOperation.findOneAndUpdate(
    {
      _id: operation._id,
      state: "prepared",
    },
    {
      $set: {
        state: "applying",
        attempt_owner: leaseOwner,
        applying_at: new Date(),
      },
    },
    {
      new: true,
      runValidators: true,
    },
  ).lean();

  if (!claimed) {
    throw new ImportLeaseLostError();
  }

  const requiresBusinessWrite = ["inserted", "updated"].includes(
    claimed.intended_outcome,
  );

  if (requiresBusinessWrite) {
    try {
      // Recheck ownership immediately before attempting the write.
      await renewLease(importJobId, leaseOwner);

      await applyPreparedImportRow(claimed.prepared_change);
    } catch (error) {
      // Keep "applying": a database error may have occurred after
      // MongoDB accepted the write but before the reply was received.
      throw error;
    }
  }

  const applied = await ImportRowOperation.findOneAndUpdate(
    {
      _id: claimed._id,
      state: "applying",
      attempt_owner: leaseOwner,
    },
    {
      $set: {
        state: "applied",
        applied_at: new Date(),
      },
    },
    {
      new: true,
      runValidators: true,
    },
  ).lean();

  if (!applied) {
    throw new ImportOperationNeedsReviewError(operation.row_number);
  }

  return applied;
}

async function saveRowResult(operation) {
  const identity = {
    record_kind: "row_result",
    import_job_id: operation.import_job_id,
    row_number: operation.row_number,
  };

  await ImportRowResult.updateOne(
    identity,
    {
      $setOnInsert: {
        ...identity,
        outcome: operation.intended_outcome,
        error_code: operation.error_code,
        error_message: operation.error_message,
      },
    },
    {
      upsert: true,
      runValidators: true,
    },
  );

  const receipt = await ImportRowResult.findOne(identity).lean();

  if (
    !receipt ||
    receipt.outcome !== operation.intended_outcome ||
    receipt.error_code !== operation.error_code ||
    receipt.error_message !== operation.error_message
  ) {
    throw new Error("The saved import result is inconsistent.");
  }

  return receipt;
}

async function advanceProgress({
  importJobId,
  leaseOwner,
  rowNumber,
  receipt,
}) {
  const counter = outcomeCounters[receipt.outcome];

  if (!counter) {
    throw new Error("The import result has an unsupported outcome.");
  }

  // Counters and checkpoint share one document, so this update is atomic.
  const filter = {
    ...ownershipFilter(importJobId, leaseOwner),
    rows_processed: rowNumber - 1,
  };

  if (rowNumber === 1) {
    filter.$or = [{ checkpoint: null }, { "checkpoint.last_completed_row": 0 }];
  } else {
    filter["checkpoint.last_completed_row"] = rowNumber - 1;
  }

  const updated = await ImportJob.updateOne(
    filter,
    {
      $inc: {
        rows_processed: 1,
        [counter]: 1,
      },
      $set: {
        checkpoint: {
          last_completed_row: rowNumber,
        },
        lease_expires_at: new Date(Date.now() + leaseDurationMilliseconds),
      },
    },
    { runValidators: true },
  );

  if (updated.matchedCount === 1) {
    return;
  }

  const current = await ImportJob.findOne(
    ownershipFilter(importJobId, leaseOwner),
  ).lean();

  if (!current) {
    throw new ImportLeaseLostError();
  }

  // A replay must not increment the counters twice.
  if (
    current.rows_processed >= rowNumber &&
    current.checkpoint?.last_completed_row >= rowNumber
  ) {
    return;
  }

  throw new Error("Import progress could not advance consistently.");
}

export async function processImportRow({
  importJobId,
  leaseOwner,
  rowNumber,
  input,
}) {
  if (
    typeof importJobId !== "string" ||
    !importJobId.trim() ||
    typeof leaseOwner !== "string" ||
    !leaseOwner.trim()
  ) {
    throw new Error("An import job ID and lease owner are required.");
  }

  if (!Number.isSafeInteger(rowNumber) || rowNumber < 1) {
    throw new Error("Row number must be a positive safe integer.");
  }

  const job = await renewLease(importJobId, leaseOwner);
  const completedRow = job.checkpoint?.last_completed_row ?? 0;

  if (job.rows_processed !== completedRow) {
    throw new Error("The import checkpoint is inconsistent.");
  }

  const existingReceipt = await ImportRowResult.findOne({
    record_kind: "row_result",
    import_job_id: importJobId,
    row_number: rowNumber,
  }).lean();

  if (rowNumber <= completedRow) {
    if (!existingReceipt) {
      throw new Error("A completed import row is missing its result.");
    }

    return {
      outcome: existingReceipt.outcome,
      alreadyProcessed: true,
    };
  }

  if (rowNumber !== completedRow + 1) {
    throw new Error("Import rows must be processed in checkpoint order.");
  }

  // Recover a crash after saving the receipt but before updating progress.
  if (existingReceipt) {
    await advanceProgress({
      importJobId,
      leaseOwner,
      rowNumber,
      receipt: existingReceipt,
    });

    return {
      outcome: existingReceipt.outcome,
      alreadyProcessed: true,
    };
  }

  let operation = await prepareImportOperation({
    job,
    rowNumber,
    input,
  });

  // Failed validation and skipped rows make no business writes.
  // Their interrupted bookkeeping can safely be completed.
  if (
    operation.state === "applying" &&
    ["failed", "skipped"].includes(operation.intended_outcome)
  ) {
    await renewLease(importJobId, leaseOwner);

    operation = await ImportRowOperation.findOneAndUpdate(
      {
        _id: operation._id,
        state: "applying",
      },
      {
        $set: {
          state: "applied",
          applied_at: new Date(),
        },
      },
      {
        new: true,
        runValidators: true,
      },
    ).lean();

    if (!operation) {
      throw new ImportLeaseLostError();
    }
  }

  operation = await applyOperation(operation, importJobId, leaseOwner);

  const receipt = await saveRowResult(operation);

  await advanceProgress({
    importJobId,
    leaseOwner,
    rowNumber,
    receipt,
  });

  return {
    outcome: receipt.outcome,
    alreadyProcessed: false,
  };
}
