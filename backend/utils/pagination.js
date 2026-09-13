/**
 * Shared pagination for list endpoints.
 *
 * Defaults to page 1 with 25 records.
 * Limits requests to 100 records per page.
 */

import {
  RequestValidationError,
  requirePlainObject,
} from "./requestValidation.js";

/**
 * Reads one positive integer from a query-string value.
 *
 * Rejects duplicate parameters represented as arrays,
 * decimals, negative values and partially numeric strings.
 */
function readPositiveInteger(value, fieldName, defaultValue, maximum) {
  if (value === undefined) {
    return defaultValue;
  }

  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    throw new RequestValidationError(
      `${fieldName} must be a positive whole number.`,
    );
  }

  const parsedValue = Number(value);

  if (!Number.isSafeInteger(parsedValue) || parsedValue > maximum) {
    throw new RequestValidationError(
      `${fieldName} must be no greater than ${maximum}.`,
    );
  }

  return parsedValue;
}

/**
 * Returns validated pagination values for a database query.
 */
export function readPagination(query) {
  requirePlainObject(query);

  const page = readPositiveInteger(query.page, "page", 1, 10000);
  const pageSize = readPositiveInteger(query.pageSize, "pageSize", 25, 100);

  return {
    page,
    pageSize,
    skip: (page - 1) * pageSize,
  };
}

/**
 * Creates pagination metadata from a filtered document count.
 *
 * An empty result has zero total pages.
 * An out-of-range page is returned as an empty page, not silently changed.
 */
export function buildPaginationMetadata(totalRecords, pagination) {
  if (!Number.isSafeInteger(totalRecords) || totalRecords < 0) {
    throw new Error("Total record count must be a non-negative safe integer.");
  }

  const { page, pageSize } = pagination;
  const totalPages = Math.ceil(totalRecords / pageSize);

  return {
    page,
    pageSize,
    totalRecords,
    totalPages,
    hasPreviousPage: totalPages > 0 && page > 1,
    hasNextPage: page < totalPages,
  };
}
