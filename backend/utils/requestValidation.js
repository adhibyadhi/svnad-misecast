/**
 * Shared validation for incoming requests.
 *
 * These helpers validate input before it reaches database services.
 */

/**
 * Represents an expected invalid request.
 * Messages must be written by the application, without sensitive data.
 */
export class RequestValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "RequestValidationError";
  }
}

/**
 * Requires a plain object, rejecting arrays, null and primitive values.
 */
export function requirePlainObject(value) {
  if (
    value === null ||
    typeof value !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new RequestValidationError("Expected an object.");
  }

  return value;
}

/**
 * Rejects unexpected fields and returns only explicitly permitted fields.
 *
 * Each route must supply its own fixed allowlist.
 * Field values still need their own validation.
 */
export function selectAllowedFields(input, allowedFields) {
  requirePlainObject(input);

  const containsUnexpectedField = Object.keys(input).some(
    (fieldName) => !allowedFields.includes(fieldName),
  );

  if (containsUnexpectedField) {
    throw new RequestValidationError(
      "The request contains an unsupported field.",
    );
  }

  const selectedFields = {};

  for (const fieldName of allowedFields) {
    if (Object.hasOwn(input, fieldName)) {
      Object.defineProperty(selectedFields, fieldName, {
        value: input[fieldName],
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
  }

  return selectedFields;
}

/**
 * Reads required text without converting objects or numbers into strings.
 */
export function requireText(value, fieldName, maximumLength = 200) {
  if (typeof value !== "string") {
    throw new RequestValidationError(`${fieldName} must be text.`);
  }

  const trimmedValue = value.trim();

  if (trimmedValue.length === 0) {
    throw new RequestValidationError(`${fieldName} is required.`);
  }

  if (trimmedValue.length > maximumLength) {
    throw new RequestValidationError(
      `${fieldName} must contain no more than ${maximumLength} characters.`,
    );
  }

  return trimmedValue;
}

/**
 * Reads a Boolean from JSON or an explicit "true"/"false" form value.
 *
 * Missing fields and ambiguous values are rejected.
 */
export function requireBoolean(value, fieldName) {
  if (value === true || value === "true") {
    return true;
  }

  if (value === false || value === "false") {
    return false;
  }

  throw new RequestValidationError(`${fieldName} must be true or false.`);
}
