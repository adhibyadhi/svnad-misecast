/**
 * Decimal parsing, calculation and formatting utilities.
 *
 * Monetary and quantity inputs should arrive as decimal strings
 * or MongoDB Decimal128 values.
 */

import Decimal from "decimal.js";
import { RequestValidationError } from "./requestValidation.js";

// Use 50 significant digits for application calculations.
// Stored results must still fit MongoDB Decimal128's precision.
export const CalculationDecimal = Decimal.clone({
  precision: 50,
  rounding: Decimal.ROUND_HALF_UP,
});

/**
 * Reads a finite decimal without first converting it to Number.
 *
 * Strings, Decimal instances and MongoDB Decimal128 are accepted.
 * Missing values and JavaScript numbers are rejected.
 */
export function requireDecimal(
  value,
  fieldName = "value",
  { minimum = null, maximum = null } = {},
) {
  let decimalText;

  if (typeof value === "string") {
    decimalText = value.trim();
  } else if (Decimal.isDecimal(value)) {
    decimalText = value.toString();
  } else if (
    value !== null &&
    typeof value === "object" &&
    value._bsontype === "Decimal128" &&
    typeof value.toString === "function"
  ) {
    decimalText = value.toString();
  } else {
    throw new RequestValidationError(
      `${fieldName} must be supplied as a decimal string.`,
    );
  }

  // Accept decimal notation and scientific notation.
  // Reject hexadecimal, Infinity, NaN and blank strings.
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(decimalText)) {
    throw new RequestValidationError(`${fieldName} must be a valid decimal.`);
  }

  const decimalValue = new CalculationDecimal(decimalText);

  if (!decimalValue.isFinite()) {
    throw new RequestValidationError(`${fieldName} must be finite.`);
  }

  if (minimum !== null && decimalValue.lessThan(minimum)) {
    throw new RequestValidationError(
      `${fieldName} must be at least ${minimum}.`,
    );
  }

  if (maximum !== null && decimalValue.greaterThan(maximum)) {
    throw new RequestValidationError(
      `${fieldName} must be no greater than ${maximum}.`,
    );
  }

  return decimalValue;
}

/**
 * Formats an AUD amount as a two-decimal string.
 *
 * Use at a documented display or financial rounding boundary.
 * Do not use this to round intermediate recipe calculations.
 */
export function formatAud(value) {
  return requireDecimal(value, "amount").toFixed(
    2,
    CalculationDecimal.ROUND_HALF_UP,
  );
}

/**
 * Converts a non-negative quantity into the whole packs needed.
 *
 * Returns a decimal integer string to avoid Number precision loss.
 * Supplier minimum orders are applied separately by ordering services.
 */
export function calculateRequiredPacks(quantity, packSize) {
  const requiredQuantity = requireDecimal(quantity, "quantity", {
    minimum: "0",
  });

  const quantityPerPack = requireDecimal(packSize, "packSize", {
    minimum: "0",
  });

  if (quantityPerPack.isZero()) {
    throw new RequestValidationError("packSize must be greater than zero.");
  }

  return requiredQuantity.dividedBy(quantityPerPack).ceil().toFixed(0);
}
