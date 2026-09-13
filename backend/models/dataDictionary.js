/**
 * Stores field definitions from the source data dictionary.
 *
 * Preserves the source composite key:
 * file_name + field_order.
 */

import mongoose from "mongoose";
import { createWholeNumberField } from "./schemaHelpers.js";

const dataDictionarySchema = new mongoose.Schema(
  {
    file_name: {
      type: String,
      required: [true, "Source file name is required."],
      trim: true,
    },

    // Allow zero-based or one-based ordering until the CSV is inspected.
    field_order: {
      ...createWholeNumberField(),
      required: [true, "Field order is required."],
    },

    field_name: {
      type: String,
      required: [true, "Field name is required."],
      trim: true,
    },

    // Preserve source descriptions such as int, decimal or varchar.
    data_type: {
      type: String,
      required: [true, "Field data type is required."],
      trim: true,
    },

    // This is a source string, not a Boolean.
    required_for_join_or_model: {
      type: String,
      default: null,
    },

    description: {
      type: String,
      default: null,
    },
  },
  {
    collection: "data_dictionary",
    strict: "throw",
    versionKey: false,
  },
);

dataDictionarySchema.index(
  {
    file_name: 1,
    field_order: 1,
  },
  { unique: true },
);

const DataDictionary = mongoose.model("DataDictionary", dataDictionarySchema);

export default DataDictionary;
