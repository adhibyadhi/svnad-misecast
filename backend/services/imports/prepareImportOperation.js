/**
 * Creates or retrieves the durable plan for one verified source row.
 *
 * This function does not apply the business change.
 * The caller must own the import job and supply its stored source row.
 */

import { ImportRowOperation } from "../../models/supporting/index.js";

import { RequestValidationError } from "../../utils/requestValidation.js";

import { prepareImportRow } from "./saveImportRow.js";

export async function prepareImportOperation({ job, rowNumber, input }) {
  if (
    !job ||
    typeof job.import_job_id !== "string" ||
    !Number.isSafeInteger(rowNumber) ||
    rowNumber < 1
  ) {
    throw new Error("A valid import job and row number are required.");
  }

  const identity = {
    record_kind: "row_operation",
    import_job_id: job.import_job_id,
    row_number: rowNumber,
  };

  const existing = await ImportRowOperation.findOne(identity).lean();

  if (existing) {
    if (existing.entity_name !== job.entity_name) {
      throw new Error("The saved operation has an inconsistent entity.");
    }

    return existing;
  }

  let preparedChange = null;
  let intendedOutcome;
  let errorCode = null;
  let errorMessage = null;

  try {
    preparedChange = await prepareImportRow(job.entity_name, input, {
      restaurantId: job.restaurant_id,
      allowCorrections: job.allow_corrections,
    });

    intendedOutcome = preparedChange.outcome;
  } catch (error) {
    // Database failures remain infrastructure errors.
    // Only expected validation failures become failed source rows.
    if (!(error instanceof RequestValidationError)) {
      throw error;
    }

    intendedOutcome = "failed";
    errorCode = "INVALID_ROW";
    errorMessage = error.message.slice(0, 2000);
  }

  try {
    const operation = await ImportRowOperation.create({
      ...identity,
      entity_name: job.entity_name,
      state: "prepared",
      intended_outcome: intendedOutcome,
      prepared_change: preparedChange,
      error_code: errorCode,
      error_message: errorMessage,
    });

    return operation.toObject({ transform: false });
  } catch (error) {
    if (error.code !== 11000) {
      throw error;
    }

    // Another attempt may have saved the plan first.
    // Its persisted plan is authoritative.
    const saved = await ImportRowOperation.findOne(identity).lean();

    if (!saved || saved.entity_name !== job.entity_name) {
      throw error;
    }

    return saved;
  }
}
