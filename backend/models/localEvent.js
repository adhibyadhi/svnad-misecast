/**
 * Stores local events that may affect restaurant demand.
 *
 * Services will handle provider mappings, distance calculations
 * and relevance rules.
 */

import mongoose from "mongoose";
import {
  createWholeNumberField,
  createDecimalField,
  createBusinessDateField,
  createLocalTimeField,
} from "./schemaHelpers.js";

const localEventSchema = new mongoose.Schema(
  {
    event_id: {
      type: String,
      required: [true, "Event ID is required."],
      trim: true,
      immutable: true,
    },

    event_date: createBusinessDateField({ required: true }),

    // Allowed event types await source data and provider mapping review.
    event_type: {
      type: String,
      trim: true,
      default: null,
    },

    event_name: {
      type: String,
      required: [true, "Event name is required."],
      trim: true,
    },

    venue_name: {
      type: String,
      trim: true,
      default: null,
    },

    start_time: createLocalTimeField(),

    end_time: createLocalTimeField(),

    // Preserve the source value until service-impact rules are verified.
    service_period_impacted: {
      type: String,
      trim: true,
      default: null,
    },

    distance_from_restaurant_km: createDecimalField({ minimum: 0 }),

    // Unknown attendance must not silently become zero.
    estimated_attendance: createWholeNumberField(),

    // The source does not define the score's scale.
    // Keep it nullable without inventing numeric bounds.
    demand_relevance_score: createDecimalField(),

    is_synthetic: {
      type: Boolean,
      required: [true, "Synthetic data status is required."],
    },
  },
  {
    collection: "local_events",
    strict: "throw",
    versionKey: false,
  },
);

localEventSchema.index({ event_id: 1 }, { unique: true });

// Supports finding events in a forecast date range.
localEventSchema.index({ event_date: 1 });

const LocalEvent = mongoose.model("LocalEvent", localEventSchema);

export default LocalEvent;
