/**
 * Records the committed outcome of an individual import row.
 *
 * A successful business write, row result and job progress update
 * must be committed in the same MongoDB transaction.
 */

import mongoose from "mongoose";
import { createWholeNumberField } from "../schemaHelpers.js";

const importRowResultSchema = new mongoose.Schema(
  {
    record_kind: {
      type: String,
      required: true,
      enum: ["row_result"],
      default: "row_result",
      immutable: true,
    },

    import_job_id: {
      type: String,
      required: true,
      trim: true,
      immutable: true,
    },

    // Logical data-row number, starting at 1.
    // Excludes the CSV header and skipped empty lines.
    row_number: {
      ...createWholeNumberField(),
      required: true,
      min: 1,
      immutable: true,
    },

    outcome: {
      type: String,
      required: true,
      enum: ["inserted", "updated", "skipped", "failed"],
      immutable: true,
    },

    // Store a bounded application error code, not a raw database error.
    error_code: {
      type: String,
      default: null,
      maxlength: 100,
      immutable: true,
      required() {
        return this.outcome === "failed";
      },
    },

    error_message: {
      type: String,
      default: null,
      maxlength: 2000,
      immutable: true,
      required() {
        return this.outcome === "failed";
      },
    },
  },
  {
    collection: "import_jobs",
    strict: "throw",
    versionKey: false,
    timestamps: {
      createdAt: "created_at",
      updatedAt: false,
    },
  },
);

// A retry cannot create a second outcome for the same source row.
importRowResultSchema.index(
  {
    import_job_id: 1,
    row_number: 1,
  },
  {
    unique: true,
    partialFilterExpression: { record_kind: "row_result" },
  },
);

// Supports listing failed rows and reconciling outcome counts.
importRowResultSchema.index({
  record_kind: 1,
  import_job_id: 1,
  outcome: 1,
  row_number: 1,
});

const ImportRowResult = mongoose.model(
  "ImportRowResult",
  importRowResultSchema,
);

export default ImportRowResult;
