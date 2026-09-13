/**
 * Checks recovery after a committed row and an expired worker lease.
 *
 * Uses a temporary database on the local replica set.
 * Does not require Express to be running.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { connectDatabase, disconnectDatabase } from "../config/database.js";
import { MenuItem } from "../models/index.js";
import * as supportingModels from "../models/supporting/index.js";
import { submitImportJob } from "../services/imports/submitImportJob.js";
import {
  processImportRow,
  ImportLeaseLostError,
} from "../services/imports/processImportRow.js";
import { runNextImportJob } from "../services/imports/runNextImportJob.js";

const { ImportJob, ImportRowResult } = supportingModels;

const databaseName = `misecast_test_${randomUUID().replaceAll("-", "")}`;
const databaseUri = `mongodb://localhost:27018/${databaseName}?replicaSet=misecast-rs`;

let connection;

try {
  connection = await connectDatabase(databaseUri);

  await MenuItem.init();

  for (const model of Object.values(supportingModels)) {
    await model.init();
  }

  const sourceRows = [
    {
      menu_item_id: "MI-RECOVERY-001",
      menu_item_name_clean: "Recovery dish one",
      active: false,
    },
    {
      menu_item_id: "MI-RECOVERY-002",
      menu_item_name_clean: "Recovery dish two",
      active: false,
    },
    {
      menu_item_id: "MI-RECOVERY-003",
      menu_item_name_clean: "Recovery dish three",
      active: false,
    },
  ];

  const job = await submitImportJob({
    entityName: "menu_items",
    sourceFormat: "json",
    sourceName: "recovery-check.json",
    fileBuffer: Buffer.from(JSON.stringify(sourceRows)),
    idempotencyKey: "recovery-check-001",
    restaurantId: "CHECK-RESTAURANT",
  });

  const originalLeaseOwner = randomUUID();

  const claimedJob = await ImportJob.findOneAndUpdate(
    {
      record_kind: "job",
      import_job_id: job.import_job_id,
      status: "queued",
      source_ready: true,
    },
    {
      $set: {
        status: "running",
        lease_owner: originalLeaseOwner,
        lease_expires_at: new Date(Date.now() + 60000),
        started_at: new Date(),
      },
    },
    {
      new: true,
      runValidators: true,
    },
  );

  assert.ok(claimedJob);

  // The original worker commits only the first row.
  await processImportRow({
    importJobId: job.import_job_id,
    leaseOwner: originalLeaseOwner,
    rowNumber: 1,
    input: sourceRows[0],
  });

  assert.equal(await MenuItem.countDocuments(), 1);

  // Simulate the lease expiring after the worker disappears.
  // This avoids waiting for the real lease timeout.
  await ImportJob.updateOne(
    {
      record_kind: "job",
      import_job_id: job.import_job_id,
      lease_owner: originalLeaseOwner,
    },
    {
      $set: {
        lease_expires_at: new Date(0),
      },
    },
  );

  // The old owner must not be allowed to write another row.
  await assert.rejects(
    () =>
      processImportRow({
        importJobId: job.import_job_id,
        leaseOwner: originalLeaseOwner,
        rowNumber: 2,
        input: sourceRows[1],
      }),
    ImportLeaseLostError,
  );

  assert.equal(await MenuItem.countDocuments(), 1);

  // Reconnect before recovery. The next worker reloads the saved source
  // and checkpoint from MongoDB.
  await disconnectDatabase();
  connection = null;

  connection = await connectDatabase(databaseUri);

  const recovered = await runNextImportJob();

  assert.ok(recovered);
  assert.equal(recovered.importJobId, job.import_job_id);
  assert.equal(recovered.status, "succeeded");
  assert.equal(recovered.rowsProcessed, 3);
  assert.equal(recovered.rowsInserted, 3);
  assert.equal(recovered.rowsSkipped, 0);
  assert.equal(recovered.rowsFailed, 0);

  assert.equal(await MenuItem.countDocuments(), 3);

  const savedJob = await ImportJob.findOne({
    record_kind: "job",
    import_job_id: job.import_job_id,
  }).lean();

  assert.equal(savedJob.checkpoint.last_completed_row, 3);
  assert.equal(savedJob.lease_owner, null);
  assert.equal(savedJob.lease_expires_at, null);
  assert.ok(savedJob.finished_at);

  const rowResults = await ImportRowResult.find({
    record_kind: "row_result",
    import_job_id: job.import_job_id,
  })
    .sort({ row_number: 1 })
    .lean();

  assert.deepEqual(
    rowResults.map((result) => result.row_number),
    [1, 2, 3],
  );

  assert.ok(rowResults.every((result) => result.outcome === "inserted"));

  // Completed work must not be claimed again.
  assert.equal(await runNextImportJob(), null);

  console.log("Import recovery checks passed.");
} catch (error) {
  console.error("Import recovery checks failed:", error.message);
  process.exitCode = 1;
} finally {
  try {
    if (connection) {
      assert.equal(connection.name, databaseName);
      await connection.dropDatabase();
      console.log("Temporary test database removed.");
    } else {
      console.error(
        `Cleanup could not run. Temporary database: ${databaseName}`,
      );
      process.exitCode = 1;
    }
  } finally {
    await disconnectDatabase();
  }
}
