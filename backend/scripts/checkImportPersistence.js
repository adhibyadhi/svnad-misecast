/**
 * Checks import persistence in a generated local test database.
 *
 * Requires local MongoDB.
 * Does not use the application's misecast database.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { connectDatabase, disconnectDatabase } from "../config/database.js";
import { MenuItem, MenuVariant } from "../models/index.js";
import { saveImportRow } from "../services/imports/saveImportRow.js";

const databaseName = `misecast_test_${randomUUID().replaceAll("-", "")}`;
const databaseUri = `mongodb://127.0.0.1:27017/${databaseName}`;
const options = { restaurantId: "CHECK-RESTAURANT" };

let connection;

try {
  connection = await connectDatabase(databaseUri);

  await MenuItem.init();
  await MenuVariant.init();

  const sourceRow = {
    menu_item_id: "MI-CHECK-001",
    menu_item_name_clean: "Check dish",
    active: true,
    sale_price_aud_small: "12.50",
    source_file: "original-menu.csv",
  };

  const inserted = await saveImportRow("menu_items", sourceRow, options);

  assert.equal(inserted.outcome, "inserted");

  const repeated = await saveImportRow("menu_items", sourceRow, options);

  assert.equal(repeated.outcome, "skipped");
  assert.equal(await MenuItem.countDocuments(), 1);

  // Different decimal formatting alone must not create a correction.
  const equivalent = await saveImportRow(
    "menu_items",
    { ...sourceRow, sale_price_aud_small: "12.5" },
    options,
  );

  assert.equal(equivalent.outcome, "skipped");

  const correction = {
    menu_item_id: "MI-CHECK-001",
    menu_item_name_clean: "Check dish",
    active: true,
    sale_price_aud_small: "14.00",
  };

  // Corrections must be explicitly enabled.
  await assert.rejects(
    () => saveImportRow("menu_items", correction, options),
    /Enable corrections/,
  );

  const updated = await saveImportRow("menu_items", correction, {
    ...options,
    allowCorrections: true,
  });

  assert.equal(updated.outcome, "updated");

  const saved = await MenuItem.findOne({
    menu_item_id: "MI-CHECK-001",
  }).lean();

  assert.equal(saved.sale_price_aud_small.toString(), "14.00");

  // An omitted field must retain its existing value.
  assert.equal(saved.source_file, "original-menu.csv");
  assert.equal(await MenuItem.countDocuments(), 1);

  // Explicit null clears an optional field.
  await saveImportRow(
    "menu_items",
    { ...correction, source_file: null },
    { ...options, allowCorrections: true },
  );

  const cleared = await MenuItem.findOne({
    menu_item_id: "MI-CHECK-001",
  }).lean();

  assert.equal(cleared.source_file, null);

  // Missing parents must prevent child insertion.
  await assert.rejects(
    () =>
      saveImportRow(
        "menu_variants",
        {
          menu_variant_id: "MV-CHECK-001",
          menu_item_id: "MISSING-PARENT",
          menu_variant_name: "Check variant",
          portion_size: "small",
          active: true,
          demand_model_training_eligible: true,
        },
        options,
      ),
    /Referenced record was not found/,
  );

  assert.equal(await MenuVariant.countDocuments(), 0);

  console.log("Import persistence checks passed.");
} catch (error) {
  console.error("Import persistence checks failed:", error.message);
  process.exitCode = 1;
} finally {
  try {
    if (connection) {
      assert.equal(connection.name, databaseName);
      assert.ok(databaseName.startsWith("misecast_test_"));

      await connection.dropDatabase();
      console.log("Temporary test database removed.");
    }
  } catch (error) {
    console.error("Test cleanup failed:", error.message);
    process.exitCode = 1;
  } finally {
    await disconnectDatabase();
  }
}
