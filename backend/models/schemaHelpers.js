/**
 * Shared field definitions for restaurant schemas.
 */

import mongoose from "mongoose";
import Decimal from "decimal.js";

/**
 * Creates an optional monetary field.
 *
 * Missing values remain null because an unknown price or cost
 * is different from zero.
 *
 * Supply monetary inputs as strings, such as "12.50",
 * to preserve decimal precision.
 */
export function createMoneyField() {
  return {
    type: mongoose.Schema.Types.Decimal128,
    default: null,
    validate: {
      validator(value) {
        if (value === null || value === undefined) {
          return true;
        }

        try {
          const decimalValue = new Decimal(value.toString());

          return (
            decimalValue.isFinite() && decimalValue.greaterThanOrEqualTo(0)
          );
        } catch {
          return false;
        }
      },
      message: "{PATH} must be a finite, non-negative monetary value.",
    },

    // Return money as a decimal string when serializing a document.
    transform(value) {
      return value === null || value === undefined ? null : value.toString();
    },
  };
}

/**
 * Creates an optional whole-number quantity field.
 * Missing quantities remain null rather than becoming zero.
 */
export function createWholeNumberField() {
  return {
    type: Number,
    default: null,
    min: [0, "{PATH} cannot be negative."],
    validate: {
      validator(value) {
        return (
          value === null || value === undefined || Number.isSafeInteger(value)
        );
      },
      message: "{PATH} must be a safe whole number.",
    },
  };
}

/**
 * Creates an optional decimal field with configurable bounds.
 *
 * Examples:
 * - Gross margin: negative values are allowed.
 * - Percentage: minimum 0 and maximum 100.
 *
 * Values remain Decimal128 in MongoDB and become strings in JSON.
 */
export function createDecimalField({ minimum = null, maximum = null } = {}) {
  return {
    type: mongoose.Schema.Types.Decimal128,
    default: null,
    validate: {
      validator(value) {
        if (value === null || value === undefined) {
          return true;
        }

        try {
          const decimalValue = new Decimal(value.toString());

          if (!decimalValue.isFinite()) {
            return false;
          }

          if (minimum !== null && decimalValue.lessThan(minimum)) {
            return false;
          }

          if (maximum !== null && decimalValue.greaterThan(maximum)) {
            return false;
          }

          return true;
        } catch {
          return false;
        }
      },
      message: "{PATH} must be a finite decimal within its allowed range.",
    },

    transform(value) {
      return value === null || value === undefined ? null : value.toString();
    },
  };
}

/**
 * Creates a date-only field stored as a YYYY-MM-DD string.
 *
 * Validates both the format and the actual calendar date.
 * Job timestamps will use a separate Date type later.
 */
export function createBusinessDateField({ required = false } = {}) {
  return {
    type: String,
    required,
    default: null,
    validate: {
      validator(value) {
        if (value === null || value === undefined) {
          return true;
        }

        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
          return false;
        }

        const parsedDate = new Date(`${value}T00:00:00.000Z`);

        return (
          !Number.isNaN(parsedDate.getTime()) &&
          parsedDate.toISOString().slice(0, 10) === value
        );
      },
      message: "{PATH} must be a valid calendar date in YYYY-MM-DD format.",
    },
  };
}

/**
 * Creates an optional local time field.
 *
 * Accepts HH:MM or HH:MM:SS in 24-hour format.
 * The restaurant timezone will be applied by services.
 */
export function createLocalTimeField() {
  return {
    type: String,
    default: null,
    validate: {
      validator(value) {
        if (value === null || value === undefined) {
          return true;
        }

        return /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value);
      },
      message: "{PATH} must be a valid time in HH:MM or HH:MM:SS format.",
    },
  };
}
