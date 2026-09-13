/**
 * Checks file parsing and its connection to row normalization.
 *
 * Does not require MongoDB.
 */

import assert from "node:assert/strict";
import { parseImportFile } from "../services/imports/parseImportFile.js";
import { normalizeImportRow } from "../services/imports/normalizeImportRow.js";

const csvText = [
  "menu_item_id;menu_item_name_clean;active;sale_price_aud_small",
  'MI-CHECK-001;"Soup; seasonal";true;12.50',
].join("\n");

const csvRows = parseImportFile(Buffer.from(csvText), "csv", "menu_items");

// Quoted delimiters belong to the field, not another column.
assert.equal(csvRows[0].menu_item_name_clean, "Soup; seasonal");

// Decimal source text must retain its precision.
assert.equal(csvRows[0].sale_price_aud_small, "12.50");

const normalized = await normalizeImportRow("menu_items", csvRows[0]);
assert.equal(normalized.row.active, true);
assert.equal(normalized.row.sale_price_aud_small.toString(), "12.50");

// Multiline quoted fields must remain one logical record.
const multilineCsv = [
  "menu_item_id;menu_item_name_clean;active",
  'MI-CHECK-002;"Seasonal',
  'soup";true',
].join("\n");

const multilineRows = parseImportFile(
  Buffer.from(multilineCsv),
  "csv",
  "menu_items",
);

assert.equal(multilineRows.length, 1);
assert.equal(multilineRows[0].menu_item_name_clean, "Seasonal\nsoup");

// Duplicate headers must not silently overwrite values.
assert.throws(
  () =>
    parseImportFile(
      Buffer.from("menu_item_id;menu_item_id\nA;B"),
      "csv",
      "menu_items",
    ),
  /duplicate names/,
);

// Incorrect column counts must fail.
assert.throws(
  () =>
    parseImportFile(
      Buffer.from("menu_item_id;active\nA;true;extra"),
      "csv",
      "menu_items",
    ),
  /Invalid CSV/,
);

// JSON must be an array.
assert.throws(
  () =>
    parseImportFile(Buffer.from('{"menu_item_id":"A"}'), "json", "menu_items"),
  /array of row objects/,
);

const jsonRows = parseImportFile(
  Buffer.from(
    JSON.stringify([
      {
        menu_item_id: "MI-CHECK-003",
        menu_item_name_clean: "Salad",
        active: true,
        sale_price_aud_small: "15.00",
      },
    ]),
  ),
  "json",
  "menu_items",
);

await normalizeImportRow("menu_items", jsonRows[0]);

// Empty arrays are not meaningful imports.
assert.throws(
  () => parseImportFile(Buffer.from("[]"), "json", "menu_items"),
  /at least one data row/,
);

console.log("Import parsing checks passed.");
