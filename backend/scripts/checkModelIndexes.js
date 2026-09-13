/**
 * Checks MongoDB indexes in a temporary local database.
 *
 * Requires MongoDB at 127.0.0.1:27017.
 * Creates and removes only a newly generated test database.
 *
 * Run:
 * node scripts/checkModelIndexes.js
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import * as models from "../models/index.js";
import { connectDatabase, disconnectDatabase } from "../config/database.js";

const databaseName = `misecast_test_${randomUUID().replaceAll("-", "")}`;
const databaseUri = `mongodb://127.0.0.1:27017/${databaseName}`;

let connection;

/**
 * Confirms that MongoDB rejects a duplicate business key.
 */
async function expectDuplicateKey(operation) {
  await assert.rejects(operation, (error) => error.code === 11000);
}

try {
  connection = await connectDatabase(databaseUri);

  assert.equal(connection.name, databaseName);

  const registeredModels = Object.values(models);
  assert.equal(registeredModels.length, 19);

  // Wait for indexes before attempting duplicate inserts.
  // Also surface any index-creation errors across all business models.
  for (const model of registeredModels) {
    await model.init();
  }

  console.log("Indexes initialized for all 19 models.");

  // Check the unique menu_item_id business key.
  const menuItemData = {
    menu_item_id: "CHECK-MENU-001",
    menu_item_name_clean: "Index check dish",
    active: true,
  };

  await models.MenuItem.create(menuItemData);

  await expectDuplicateKey(() => models.MenuItem.create(menuItemData));

  // Check weather's date + record_type composite key.
  const weatherData = {
    date: "2026-09-14",
    record_type: "actual",
    is_synthetic: true,
  };

  await models.Weather.create(weatherData);

  // Same date with a different record type must be allowed.
  await models.Weather.create({
    ...weatherData,
    record_type: "forecast",
  });

  await expectDuplicateKey(() => models.Weather.create(weatherData));

  // Check reservations' date + service_period + record_type key.
  const reservationData = {
    date: "2026-09-14",
    service_period: "lunch",
    record_type: "actual",
    is_synthetic: true,
  };

  await models.Reservation.create(reservationData);

  // A different service must be allowed.
  await models.Reservation.create({
    ...reservationData,
    service_period: "dinner",
  });

  // A different record type must also be allowed.
  await models.Reservation.create({
    ...reservationData,
    record_type: "forecast",
  });

  await expectDuplicateKey(() => models.Reservation.create(reservationData));

  // Failed duplicate inserts must not increase document counts.
  assert.equal(await models.MenuItem.countDocuments(), 1);
  assert.equal(await models.Weather.countDocuments(), 2);
  assert.equal(await models.Reservation.countDocuments(), 3);

  console.log("Duplicate-key checks passed.");
} catch (error) {
  console.error("Index checks failed:", error.message);
  process.exitCode = 1;
} finally {
  try {
    if (connection) {
      // Refuse cleanup unless connected to this script's generated database.
      assert.equal(connection.name, databaseName);
      assert.ok(databaseName.startsWith("misecast_test_"));

      await connection.dropDatabase();

      console.log("Temporary test database removed.");
    }
  } catch (error) {
    console.error("Test database cleanup failed:", error.message);
    process.exitCode = 1;
  } finally {
    await disconnectDatabase();
  }
}
