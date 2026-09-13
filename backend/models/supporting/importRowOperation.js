/**
 * Stores the intended business change for an import row.
 *
 * This is supporting data, not an additional business entity.
 * BSON values inside the snapshots must retain their original types.
 */

import mongoose from "mongoose";

const importRowOperationSchema = new mongoose.Schema(
  {
    record_kind: {
      type: String,
      required: true,
      default: "row_operation",
      enum: ["row_operation"],
      immutable: true,
    },

    import_job_id: {
      type: String,
      required: true,
      immutable: true,
    },

    row_number: {
      type: Number,
      required: true,
      min: 1,
      validate: Number.isSafeInteger,
      immutable: true,
    },

    entity_name: {
      type: String,
      required: true,
      immutable: true,
    },

    state: {
      type: String,
      required: true,
      enum: ["prepared", "applying", "applied", "needs_review"],
      default: "prepared",
    },

    intended_outcome: {
      type: String,
      required: true,
      enum: ["inserted", "updated", "skipped", "failed"],
      immutable: true,
    },

    /**
     * Contains the validated operation returned by prepareImportRow().
     *
     * Mixed preserves ObjectId and Decimal128 values when stored in BSON.
     * Never JSON.stringify() this field before saving.
     */
    prepared_change: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
      immutable: true,
    },

    error_code: {
      type: String,
      default: null,
      maxlength: 100,
      immutable: true,
    },

    error_message: {
      type: String,
      default: null,
      maxlength: 2000,
      immutable: true,
    },

    attempt_owner: {
      type: String,
      default: null,
      maxlength: 200,
    },

    applying_at: {
      type: Date,
      default: null,
    },

    applied_at: {
      type: Date,
      default: null,
    },

    review_reason: {
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

importRowOperationSchema.pre("validate", function () {
  if (this.intended_outcome === "failed") {
    if (!this.error_code || !this.error_message) {
      this.invalidate(
        "error_message",
        "A failed operation must include its validation error.",
      );
    }

    if (this.prepared_change !== null) {
      this.invalidate(
        "prepared_change",
        "A failed validation cannot include a business write.",
      );
    }

    return;
  }

  if (
    !this.prepared_change ||
    this.prepared_change.entityName !== this.entity_name ||
    this.prepared_change.outcome !== this.intended_outcome
  ) {
    this.invalidate(
      "prepared_change",
      "The prepared change must match its entity and outcome.",
    );
  }
});

importRowOperationSchema.index(
  {
    import_job_id: 1,
    row_number: 1,
  },
  {
    name: "unique_import_row_operation",
    unique: true,
    partialFilterExpression: {
      record_kind: "row_operation",
    },
  },
);

const ImportRowOperation = mongoose.model(
  "ImportRowOperation",
  importRowOperationSchema,
);

export default ImportRowOperation;
