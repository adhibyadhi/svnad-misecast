/**
 * Bounded external-context cache.
 *
 * Provider services must validate payload contents before storage.
 */

import mongoose from "mongoose";

const externalContextCacheSchema = new mongoose.Schema(
  {
    cache_key: {
      type: String,
      required: true,
    },

    chunk_number: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      validate: Number.isSafeInteger,
    },

    schema_version: {
      type: Number,
      required: true,
      default: 1,
    },

    provider: {
      type: String,
      required: true,
    },

    context_type: {
      type: String,
      required: true,
    },

    location_key: {
      type: String,
      required: true,
    },

    request_hash: {
      type: String,
      required: true,
    },

    retrieved_at: {
      type: Date,
      required: true,
    },

    fresh_until: {
      type: Date,
      required: true,
    },

    source_date_start: {
      type: String,
      required: true,
    },

    source_date_end: {
      type: String,
      required: true,
    },

    payload: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
      validate: {
        validator(value) {
          try {
            return (
              Buffer.byteLength(JSON.stringify(value), "utf8") <= 1024 * 1024
            );
          } catch {
            return false;
          }
        },
        message: "Context payload exceeds the allowed size.",
      },
    },
  },
  {
    collection: "external_context_cache",
    strict: "throw",
    versionKey: false,
  },
);

externalContextCacheSchema.index(
  { cache_key: 1, chunk_number: 1 },
  { unique: true },
);

const ExternalContextCache = mongoose.model(
  "ExternalContextCache",
  externalContextCacheSchema,
);

export default ExternalContextCache;
