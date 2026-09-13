/**
 * HTTP handlers for import submission, progress and row errors.
 */

import { restaurant } from "../config/restaurant.js";
import { ImportJob, ImportRowResult } from "../models/supporting/index.js";
import { submitImportJob } from "../services/imports/submitImportJob.js";
import {
  requireBoolean,
  requireText,
  selectAllowedFields,
} from "../utils/requestValidation.js";
import {
  readPagination,
  buildPaginationMetadata,
} from "../utils/pagination.js";

/**
 * Returns only public job fields.
 * Raw source bytes and worker lease details are excluded.
 */
function summarizeJob(job) {
  return {
    import_job_id: job.import_job_id,
    entity_name: job.entity_name,
    source_name: job.source_name,
    status: job.status,
    source_ready: job.source_ready,
    allow_corrections: job.allow_corrections,
    rows_processed: job.rows_processed,
    rows_inserted: job.rows_inserted,
    rows_updated: job.rows_updated,
    rows_skipped: job.rows_skipped,
    rows_failed: job.rows_failed,
    error_summary: job.error_summary,
    created_at: job.created_at,
    started_at: job.started_at,
    finished_at: job.finished_at,
  };
}

/**
 * Looks up a job belonging to the configured restaurant.
 */
async function findJob(request) {
  const importJobId = requireText(
    request.params.importJobId,
    "importJobId",
    200,
  );

  return ImportJob.findOne({
    record_kind: "job",
    import_job_id: importJobId,
    restaurant_id: restaurant.restaurantId,
  }).lean();
}

function sendMissingJob(response) {
  return response.status(404).json({
    error: {
      code: "IMPORT_NOT_FOUND",
      message: "The import job was not found.",
    },
  });
}

/**
 * Accepts a file and returns its durable job identity.
 */
export async function createImport(request, response) {
  const query = selectAllowedFields(request.query, [
    "sourceName",
    "allowCorrections",
  ]);

  const sourceFormat = request.is("application/json") ? "json" : "csv";

  const job = await submitImportJob({
    entityName: request.params.entityName,
    sourceFormat,
    sourceName: requireText(query.sourceName, "sourceName", 255),
    fileBuffer: request.body,
    idempotencyKey: requireText(
      request.get("Idempotency-Key"),
      "Idempotency-Key",
      200,
    ),
    restaurantId: restaurant.restaurantId,
    allowCorrections:
      query.allowCorrections === undefined
        ? false
        : requireBoolean(query.allowCorrections, "allowCorrections"),
  });

  const statusUrl = `/api/imports/jobs/${encodeURIComponent(job.import_job_id)}`;
  const terminal = ["succeeded", "partial", "failed"].includes(job.status);

  response.set("Location", statusUrl);

  return response.status(terminal ? 200 : 202).json({
    job: summarizeJob(job),
    status_url: statusUrl,
  });
}

/**
 * Returns current persisted progress.
 */
export async function getImportStatus(request, response) {
  const job = await findJob(request);

  if (!job) {
    return sendMissingJob(response);
  }

  return response.json({ job: summarizeJob(job) });
}

/**
 * Returns failed row results, ordered by source row number.
 */
export async function getImportErrors(request, response) {
  const query = selectAllowedFields(request.query, ["page", "pageSize"]);
  const pagination = readPagination(query);

  const job = await findJob(request);

  if (!job) {
    return sendMissingJob(response);
  }

  const filter = {
    record_kind: "row_result",
    import_job_id: job.import_job_id,
    outcome: "failed",
  };

  const errors = await ImportRowResult.find(filter)
    .select({
      _id: 0,
      row_number: 1,
      error_code: 1,
      error_message: 1,
    })
    .sort({ row_number: 1 })
    .skip(pagination.skip)
    .limit(pagination.pageSize)
    .lean();

  const totalRecords = await ImportRowResult.countDocuments(filter);

  return response.json({
    errors,
    pagination: buildPaginationMetadata(totalRecords, pagination),
  });
}
