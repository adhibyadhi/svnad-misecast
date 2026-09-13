/**
 * Checks transaction support using the configured MongoDB server.
 *
 * Creates and removes a separate temporary database.
 * The application database is not modified.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { connectDatabase, disconnectDatabase } from "../config/database.js";

const databaseName = `misecast_test_${randomUUID().replaceAll("-", "")}`;

let testDatabase;
let session;

try {
  const connection = await connectDatabase();
  const client = connection.getClient();

  testDatabase = client.db(databaseName);
  session = client.startSession();

  await testDatabase.createCollection("business_records");
  await testDatabase.createCollection("row_results");

  const businessRecords = testDatabase.collection("business_records");
  const rowResults = testDatabase.collection("row_results");

  // Both writes must commit together.
  await session.withTransaction(async () => {
    await businessRecords.insertOne(
      { _id: "committed-row", value: "saved" },
      { session },
    );

    await rowResults.insertOne(
      { _id: "committed-row", outcome: "inserted" },
      { session },
    );
  });

  assert.equal(await businessRecords.countDocuments(), 1);
  assert.equal(await rowResults.countDocuments(), 1);

  // An error must roll back both writes.
  const intentionalFailure = new Error("Intentional rollback check");

  await assert.rejects(
    () =>
      session.withTransaction(async () => {
        await businessRecords.insertOne(
          { _id: "rolled-back-row", value: "must not remain" },
          { session },
        );

        await rowResults.insertOne(
          { _id: "rolled-back-row", outcome: "inserted" },
          { session },
        );

        throw intentionalFailure;
      }),
    (error) => error === intentionalFailure,
  );

  assert.equal(await businessRecords.countDocuments(), 1);
  assert.equal(await rowResults.countDocuments(), 1);

  console.log("Transaction commit and rollback checks passed.");
} catch (error) {
  console.error("Transaction checks failed:", error.message);
  process.exitCode = 1;
} finally {
  try {
    if (session) {
      await session.endSession();
    }

    if (testDatabase) {
      assert.equal(testDatabase.databaseName, databaseName);
      await testDatabase.dropDatabase();
      console.log("Temporary test database removed.");
    }
  } finally {
    await disconnectDatabase();
  }
}
