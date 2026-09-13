/**
 * Stores documented assumptions from the source data package.
 *
 * Preserves the original string fields and synthetic-data status.
 */

import mongoose from "mongoose";

const dataAssumptionSchema = new mongoose.Schema(
  {
    assumption_id: {
      type: String,
      required: [true, "Assumption ID is required."],
      trim: true,
      immutable: true,
    },

    category: {
      type: String,
      trim: true,
      default: null,
    },

    // Preserve the pipe-delimited source file list.
    affected_entities: {
      type: String,
      default: null,
    },

    assumption: {
      type: String,
      required: [true, "Assumption description is required."],
      trim: true,
    },

    // Preserve text values, even when they describe numbers or flags.
    value: {
      type: String,
      default: null,
    },

    rationale: {
      type: String,
      default: null,
    },

    // The source defines this as a string, not a Boolean.
    replacement_required: {
      type: String,
      default: null,
    },

    is_synthetic: {
      type: Boolean,
      required: [true, "Synthetic data status is required."],
    },
  },
  {
    collection: "data_assumptions",
    strict: "throw",
    versionKey: false,
  },
);

dataAssumptionSchema.index({ assumption_id: 1 }, { unique: true });

const DataAssumption = mongoose.model("DataAssumption", dataAssumptionSchema);

export default DataAssumption;
