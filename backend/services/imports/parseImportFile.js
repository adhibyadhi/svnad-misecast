/**
 * Parses a bounded UTF-8 CSV or JSON upload.
 *
 * Returns temporary row objects without writing to MongoDB.
 * Field conversion and schema validation happen separately.
 */

import { parse } from "csv-parse/sync";
import { importLimits } from "../../config/importLimits.js";
import {
  RequestValidationError,
  requirePlainObject,
  selectAllowedFields,
} from "../../utils/requestValidation.js";
import { getImportEntity } from "./importRegistry.js";

/**
 * Checks one parsed row's structure, field names and serialized size.
 */
function validateRowShape(row, entity) {
  requirePlainObject(row);
  selectAllowedFields(row, entity.sourceFields);

  const rowBytes = Buffer.byteLength(JSON.stringify(row), "utf8");

  if (rowBytes > importLimits.maximumRowBytes) {
    throw new RequestValidationError("An import row exceeds the allowed size.");
  }

  return row;
}

/**
 * Validates CSV headers before records are converted into objects.
 */
function validateHeaders(headers, entity) {
  const normalizedHeaders = headers.map((header) => header.trim());

  if (normalizedHeaders.some((header) => header === "")) {
    throw new RequestValidationError(
      "CSV headers must not contain blank names.",
    );
  }

  if (new Set(normalizedHeaders).size !== normalizedHeaders.length) {
    throw new RequestValidationError(
      "CSV headers must not contain duplicate names.",
    );
  }

  if (
    normalizedHeaders.some((header) => !entity.sourceFields.includes(header))
  ) {
    throw new RequestValidationError("The CSV contains an unsupported column.");
  }

  for (const keyField of entity.keyFields) {
    if (!normalizedHeaders.includes(keyField)) {
      throw new RequestValidationError(
        `The CSV is missing business key column ${keyField}.`,
      );
    }
  }

  return normalizedHeaders;
}

/**
 * Parses semicolon-delimited CSV.
 *
 * Inconsistent column counts and malformed quoting reject the file.
 * Values remain strings until row normalization.
 */
function parseCsv(text, entity) {
  let rowCount = 0;

  try {
    return parse(text, {
      delimiter: ";",
      bom: true,
      cast: false,
      skip_empty_lines: true,
      relax_column_count: false,

      // Additional parser-level protection for oversized records.
      max_record_size: importLimits.maximumRowBytes,

      columns(headers) {
        return validateHeaders(headers, entity);
      },

      on_record(row) {
        rowCount += 1;

        if (rowCount > importLimits.maximumRows) {
          throw new RequestValidationError(
            "The import exceeds the allowed number of rows.",
          );
        }

        return validateRowShape(row, entity);
      },
    });
  } catch (error) {
    if (error instanceof RequestValidationError) {
      throw error;
    }

    // Avoid exposing source values embedded in parser error messages.
    throw new RequestValidationError(
      "Invalid CSV. Check semicolon delimiters, quoting, column counts and record size.",
    );
  }
}

/**
 * Parses a JSON array of row objects.
 */
function parseJson(text, entity) {
  let rows;

  try {
    rows = JSON.parse(text);
  } catch {
    throw new RequestValidationError("The import file contains invalid JSON.");
  }

  if (!Array.isArray(rows)) {
    throw new RequestValidationError(
      "A JSON import must contain an array of row objects.",
    );
  }

  if (rows.length > importLimits.maximumRows) {
    throw new RequestValidationError(
      "The import exceeds the allowed number of rows.",
    );
  }

  for (const row of rows) {
    validateRowShape(row, entity);
  }

  return rows;
}

/**
 * Parses original upload bytes.
 *
 * @param {Buffer} fileBuffer - Original file contents.
 * @param {string} sourceFormat - csv or json.
 * @param {string} entityName - Approved source collection name.
 * @returns {Array<object>} Temporary parsed rows.
 */
export function parseImportFile(fileBuffer, sourceFormat, entityName) {
  const entity = getImportEntity(entityName);

  if (!Buffer.isBuffer(fileBuffer)) {
    throw new Error("The import parser requires a Buffer.");
  }

  if (!["csv", "json"].includes(sourceFormat)) {
    throw new RequestValidationError("Import format must be csv or json.");
  }

  if (fileBuffer.length > importLimits.maximumFileBytes) {
    throw new RequestValidationError(
      "The import file exceeds the 20 MiB limit.",
    );
  }

  let text;

  try {
    // Reject invalid UTF-8 instead of silently replacing characters.
    text = new TextDecoder("utf-8", { fatal: true }).decode(fileBuffer);
  } catch {
    throw new RequestValidationError(
      "Import files must use valid UTF-8 encoding.",
    );
  }

  text = text.replace(/^\uFEFF/, "");

  if (text.trim() === "") {
    throw new RequestValidationError("The import file is empty.");
  }

  const rows =
    sourceFormat === "csv" ? parseCsv(text, entity) : parseJson(text, entity);

  if (rows.length === 0) {
    throw new RequestValidationError(
      "The import must contain at least one data row.",
    );
  }

  return rows;
}
