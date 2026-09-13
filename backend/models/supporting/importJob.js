/**
 * Stores import-job metadata in import_jobs.
 *
 * Error chunks will use separate documents in the same collection.
 * Services will implement idempotency, processing and recovery.
 */

import mongoose from "mongoose";
import { createWholeNumberField } from "../schemaHelpers.js";

/**
 * Creates a non-negative progress counter.
 */
function createCounterField() {
  return {
    ...createWholeNumberField(),
    required: true,
    default: 0,
  };
}

const checkpointSchema = new mongoose.Schema(
  {
    // Counts data rows, excluding the CSV header.
    // Zero means no row has been checkpointed.
    last_completed_row: createCounterField(),
  },
  {
    _id: false,
    strict: "throw",
  },
);

const importJobSchema = new mongoose.Schema(
  {
    // Distinguishes jobs from future error-chunk documents.
    record_kind: {
      type: String,
      enum: ["job"],
      default: "job",
      required: true,
      immutable: true,
    },

    import_job_id: {
      type: String,
      required: [true, "Import job ID is required."],
      trim: true,
      immutable: true,
    },

    // Identifies one logical submission across client retries.
    idempotency_key: {
      type: String,
      required: [true, "Import idempotency key is required."],
      trim: true,
      maxlength: 200,
      immutable: true,
    },

    // Hash of the source checksum plus import options and entity.
    request_hash: {
      type: String,
      required: true,
      match: /^[a-f0-9]{64}$/,
      immutable: true,
    },

    // Validated against a fixed entity registry by the import service.
    entity_name: {
      type: String,
      required: [true, "Import entity name is required."],
      trim: true,
      immutable: true,
    },
    // Capture the restaurant used when this job was submitted.
    restaurant_id: {
      type: String,
      required: true,
      trim: true,
      immutable: true,
    },

    // Preserve the requested correction policy across restarts.
    allow_corrections: {
      type: Boolean,
      required: true,
      default: false,
      immutable: true,
    },

    // Workers must ignore jobs until source storage is complete.
    source_ready: {
      type: Boolean,
      required: true,
      default: false,
    },

    source_ready_at: {
      type: Date,
      default: null,
    },

    // Display name only; never use directly as a filesystem path.
    source_name: {
      type: String,
      required: [true, "Import source name is required."],
      trim: true,
      maxlength: 255,
      immutable: true,
    },

    source_format: {
      type: String,
      required: true,
      enum: ["csv", "json"],
      immutable: true,
    },

    // SHA-256 of the original uploaded bytes.
    source_checksum: {
      type: String,
      required: true,
      match: /^[a-f0-9]{64}$/,
      immutable: true,
    },
    // Populated after all original source chunks are stored.
    source_size_bytes: {
      ...createWholeNumberField(),
      default: null,
      max: 20 * 1024 * 1024,
    },

    source_chunk_count: {
      ...createWholeNumberField(),
      default: null,
      max: 80,
    },

    status: {
      type: String,
      required: true,
      enum: ["queued", "running", "succeeded", "failed", "partial"],
      default: "queued",
    },

    rows_processed: createCounterField(),
    rows_inserted: createCounterField(),
    rows_updated: createCounterField(),
    rows_skipped: createCounterField(),
    rows_failed: createCounterField(),

    checkpoint: {
      type: checkpointSchema,
      default: null,
    },

    // A worker must hold the current lease before progressing a job.
    lease_owner: {
      type: String,
      default: null,
      maxlength: 200,
    },

    lease_expires_at: {
      type: Date,
      default: null,
    },

    started_at: {
      type: Date,
      default: null,
    },

    finished_at: {
      type: Date,
      default: null,
    },

    // Detailed row errors belong in bounded error-chunk documents.
    error_summary: {
      type: String,
      default: null,
      maxlength: 2000,
    },
  },
  {
    collection: "import_jobs",
    strict: "throw",
    versionKey: false,
    timestamps: {
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  },
);

// Scope unique indexes to job records so error chunks can share job IDs.
importJobSchema.index(
  { import_job_id: 1 },
  {
    unique: true,
    partialFilterExpression: { record_kind: "job" },
  },
);

importJobSchema.index(
  { idempotency_key: 1 },
  {
    unique: true,
    partialFilterExpression: { record_kind: "job" },
  },
);

// Supports finding queued jobs and expired worker leases.
importJobSchema.index({
  record_kind: 1,
  status: 1,
  lease_expires_at: 1,
});

// Allow only one running import job across this local application.
// Expired jobs must be reclaimed before another job can start.
importJobSchema.index(
  { record_kind: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: {
      record_kind: "job",
      status: "running",
    },
  },
);

const ImportJob = mongoose.model("ImportJob", importJobSchema);

export default ImportJob;
