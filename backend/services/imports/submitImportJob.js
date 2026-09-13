/**
 * Accepts a bounded import submission and stores its original source.
 *
 * No business rows are written here.
 * Jobs remain ineligible for processing until source_ready is true.
 */

import { createHash, randomUUID } from "node:crypto";
import { ImportJob } from "../../models/supporting/index.js";
import {
  RequestValidationError,
  requireText,
} from "../../utils/requestValidation.js";
import { getImportEntity } from "./importRegistry.js";
import { parseImportFile } from "./parseImportFile.js";
import {
  calculateSourceChecksum,
  storeImportSource,
  loadImportSource,
} from "./importSourceStorage.js";

/**
 * Builds a stable submission fingerprint from fixed, ordered fields.
 *
 * Original source bytes are represented by their SHA-256 checksum.
 */
function calculateRequestHash({
  restaurantId,
  entityName,
  sourceFormat,
  sourceName,
  sourceChecksum,
  allowCorrections,
}) {
  const requestIdentity = JSON.stringify([
    1,
    restaurantId,
    entityName,
    sourceFormat,
    sourceName,
    sourceChecksum,
    allowCorrections,
  ]);

  return createHash("sha256").update(requestIdentity).digest("hex");
}

/**
 * Returns the current job after making its source durable.
 *
 * A retry after interrupted storage uses the existing job ID and chunks.
 * Completed jobs are returned without being queued again.
 */
export async function submitImportJob({
  entityName,
  sourceFormat,
  sourceName,
  fileBuffer,
  idempotencyKey,
  restaurantId,
  allowCorrections = false,
}) {
  getImportEntity(entityName);

  const normalizedRestaurantId = requireText(restaurantId, "restaurantId", 200);

  const normalizedSourceName = requireText(sourceName, "sourceName", 255);

  const normalizedIdempotencyKey = requireText(
    idempotencyKey,
    "idempotencyKey",
    200,
  );

  if (typeof allowCorrections !== "boolean") {
    throw new RequestValidationError("allowCorrections must be a Boolean.");
  }

  // Checks file size, format, headers and structure before acceptance.
  // Row values and relationships are validated during processing.
  // The returned temporary rows are not retained here.
  parseImportFile(fileBuffer, sourceFormat, entityName);

  const sourceChecksum = calculateSourceChecksum(fileBuffer);

  const requestHash = calculateRequestHash({
    restaurantId: normalizedRestaurantId,
    entityName,
    sourceFormat,
    sourceName: normalizedSourceName,
    sourceChecksum,
    allowCorrections,
  });

  let job = await ImportJob.findOne({
    record_kind: "job",
    idempotency_key: normalizedIdempotencyKey,
  });

  if (!job) {
    try {
      job = await ImportJob.create({
        import_job_id: `IMPORT-${randomUUID()}`,
        idempotency_key: normalizedIdempotencyKey,
        request_hash: requestHash,
        entity_name: entityName,
        restaurant_id: normalizedRestaurantId,
        allow_corrections: allowCorrections,
        source_name: normalizedSourceName,
        source_format: sourceFormat,
        source_checksum: sourceChecksum,
      });
    } catch (error) {
      if (error.code !== 11000) {
        throw error;
      }

      // Another request may have created this idempotency key.
      job = await ImportJob.findOne({
        record_kind: "job",
        idempotency_key: normalizedIdempotencyKey,
      });

      if (!job) {
        throw error;
      }
    }
  }

  if (job.request_hash !== requestHash) {
    throw new RequestValidationError(
      "This idempotency key was already used with different content or options.",
    );
  }

  if (job.source_ready) {
    return job;
  }

  if (job.status !== "queued") {
    throw new Error(
      "An incomplete import source has an unexpected job status.",
    );
  }

  const manifest = await storeImportSource(job.import_job_id, fileBuffer);

  if (manifest.source_checksum !== job.source_checksum) {
    throw new Error("Stored source does not match the job checksum.");
  }

  // Verify completeness before making the job eligible for processing.
  await loadImportSource(job.import_job_id, manifest);

  const readyJob = await ImportJob.findOneAndUpdate(
    {
      record_kind: "job",
      import_job_id: job.import_job_id,
      request_hash: requestHash,
      status: "queued",
      source_ready: false,
    },
    {
      $set: {
        source_size_bytes: manifest.source_size_bytes,
        source_chunk_count: manifest.source_chunk_count,
        source_ready: true,
        source_ready_at: new Date(),
      },
    },
    {
      new: true,
      runValidators: true,
    },
  );

  if (readyJob) {
    return readyJob;
  }

  // A concurrent identical submission may have marked it ready first.
  const currentJob = await ImportJob.findOne({
    record_kind: "job",
    import_job_id: job.import_job_id,
    request_hash: requestHash,
  });

  if (!currentJob || !currentJob.source_ready) {
    throw new Error("The import source could not be marked ready.");
  }

  return currentJob;
}
