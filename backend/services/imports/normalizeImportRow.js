/**
 * Normalizes and validates a source row without saving it.
 *
 * Blank values become null.
 * Omitted fields remain omitted in the returned result.
 */

import {
  RequestValidationError,
  selectAllowedFields,
} from "../../utils/requestValidation.js";
import { requireDecimal } from "../../utils/decimal.js";
import { getImportEntity } from "./importRegistry.js";

/**
 * Converts explicit source Boolean values.
 *
 * Accepted:
 * true, false, 1, 0, and their string equivalents.
 * Other vocabularies require a documented source mapping.
 */
function normalizeBoolean(value, fieldName) {
  if (value === true || value === 1) {
    return true;
  }

  if (value === false || value === 0) {
    return false;
  }

  if (typeof value === "string") {
    const normalizedValue = value.trim().toLowerCase();

    if (normalizedValue === "true" || normalizedValue === "1") {
      return true;
    }

    if (normalizedValue === "false" || normalizedValue === "0") {
      return false;
    }
  }

  throw new RequestValidationError(
    `${fieldName} must contain true, false, 1 or 0.`,
  );
}

/**
 * Converts source integers without accepting partial numeric strings.
 */
function normalizeInteger(value, fieldName) {
  if (typeof value === "string") {
    const trimmedValue = value.trim();

    if (!/^[+-]?\d+$/.test(trimmedValue)) {
      throw new RequestValidationError(
        `${fieldName} must contain a whole number.`,
      );
    }

    value = Number(trimmedValue);
  }

  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new RequestValidationError(
      `${fieldName} must contain a safe whole number.`,
    );
  }

  return value;
}

/**
 * Converts one field according to the approved model schema.
 */
function normalizeField(value, schemaPath) {
  const fieldName = schemaPath.path;

  if (value === null || (typeof value === "string" && value.trim() === "")) {
    return null;
  }

  if (value === undefined) {
    throw new RequestValidationError(
      `${fieldName} cannot explicitly contain undefined.`,
    );
  }

  switch (schemaPath.instance) {
    case "String":
      if (typeof value !== "string") {
        throw new RequestValidationError(`${fieldName} must contain text.`);
      }

      // Preserve source text. Schema-level trim rules still apply.
      return value;

    case "Boolean":
      return normalizeBoolean(value, fieldName);

    case "Number":
      // All Number fields in the current source models are integers.
      return normalizeInteger(value, fieldName);

    case "Decimal128":
      // JSON clients must quote decimals to preserve their precision.
      if (typeof value !== "string") {
        throw new RequestValidationError(
          `${fieldName} must contain a quoted decimal string.`,
        );
      }

      requireDecimal(value, fieldName);
      return value.trim();

    default:
      throw new Error(
        `No import normalizer exists for schema type ${schemaPath.instance}.`,
      );
  }
}

/**
 * Returns a validated source row and its business-key filter.
 *
 * This validates a complete logical row, not an HTTP PATCH request.
 * Cross-collection references are checked separately before persistence.
 */
export async function normalizeImportRow(entityName, input) {
  const entity = getImportEntity(entityName);

  const suppliedFields = selectAllowedFields(input, entity.sourceFields);

  const normalizedFields = {};

  for (const [fieldName, value] of Object.entries(suppliedFields)) {
    const schemaPath = entity.model.schema.path(fieldName);

    normalizedFields[fieldName] = normalizeField(value, schemaPath);
  }

  const document = new entity.model(normalizedFields);

  try {
    await document.validate();
  } catch (error) {
    if (error.name === "ValidationError") {
      // Report field names without exposing full source values.
      const invalidFields = Object.keys(error.errors).join(", ");

      throw new RequestValidationError(
        `Row validation failed for fields: ${invalidFields}.`,
      );
    }

    throw error;
  }

  const row = {};

  // Return only supplied fields, including schema trimming and casting.
  // Do not return generated _id or defaults for omitted optional fields.
  for (const fieldName of Object.keys(normalizedFields)) {
    row[fieldName] = document.get(fieldName);
  }

  const keyFilter = {};

  for (const fieldName of entity.keyFields) {
    const value = row[fieldName];

    if (value === null || value === undefined || value === "") {
      throw new RequestValidationError(
        `Business key field ${fieldName} is required.`,
      );
    }

    keyFilter[fieldName] = value;
  }

  return { row, keyFilter };
}
