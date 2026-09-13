/**
 * Stores original import-file bytes in bounded MongoDB documents.
 *
 * Source chunks share import_jobs with job metadata.
 * They are not business records.
 */

import mongoose from "mongoose";
import { createWholeNumberField } from "../schemaHelpers.js";

const importSourceChunkSchema = new mongoose.Schema(
  {
    record_kind: {
      type: String,
      enum: ["source_chunk"],
      default: "source_chunk",
      required: true,
      immutable: true,
    },

    import_job_id: {
      type: String,
      required: true,
      trim: true,
      immutable: true,
    },

    chunk_number: {
      ...createWholeNumberField(),
      required: true,
      immutable: true,
    },

    // SHA-256 of this chunk's original bytes.
    chunk_checksum: {
      type: String,
      required: true,
      match: /^[a-f0-9]{64}$/,
      immutable: true,
    },

    data: {
      type: Buffer,
      required: true,
      immutable: true,
      validate: {
        validator(value) {
          return (
            Buffer.isBuffer(value) &&
            value.length > 0 &&
            value.length <= 256 * 1024
          );
        },
        message: "Source chunks must contain between 1 byte and 256 KiB.",
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

importSourceChunkSchema.index(
  {
    import_job_id: 1,
    chunk_number: 1,
  },
  {
    unique: true,
    partialFilterExpression: { record_kind: "source_chunk" },
  },
);

const ImportSourceChunk = mongoose.model(
  "ImportSourceChunk",
  importSourceChunkSchema,
);

export default ImportSourceChunk;
