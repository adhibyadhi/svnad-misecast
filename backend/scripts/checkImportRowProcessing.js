/**
 * Checks transactional row processing in a temporary database.
 *
 * Requires the local replica set on port 27018.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { connectDatabase, disconnectDatabase } from "../config/database.js";
import { MenuItem } from "../models/index.js";
import * as supportingModels from "../models/supporting/index.js";
import { submitImportJob } from "../services/imports/submitImportJob.js";
import { processImportRow } from "../services/imports/processImportRow.js";

const { ImportJob, ImportRowResult } = supportingModels;
const databaseName = `misecast_test_${randomUUID().replaceAll("-", "")}`;

let connection;

try {
  connection = await connectDatabase(
    `mongodb://localhost:27018/${databaseName}?replicaSet=misecast-rs`,
  );

  await MenuItem.init();

  for (const model of Object.values(supportingModels)) {
    await model.init();
  }

  const rows = [
    {
      menu_item_id: "MI-ROW-CHECK-001",
      menu_item_name_clean: "Check dish",
      active: true,
    },
    {
      menu_item_id: "MI-ROW-CHECK-002",
      menu_item_name_clean: "",
      active: true,
    },
  ];

  const job = await submitImportJob({
    entityName: "menu_items",
    sourceFormat: "json",
    sourceName: "row-check.json",
    fileBuffer: Buffer.from(JSON.stringify(rows)),
    idempotencyKey: "row-processing-check",
    restaurantId: "CHECK-RESTAURANT",
  });

  // Test-only lease acquisition. The queue worker will handle this later.
  const leaseOwner = randomUUID();

  await ImportJob.updateOne(
    {
      record_kind: "job",
      import_job_id: job.import_job_id,
      status: "queued",
      source_ready: true,
    },
    {
      $set: {
        status: "running",
        lease_owner: leaseOwner,
        lease_expires_at: new Date(Date.now() + 60000),
        started_at: new Date(),
      },
    },
  );

  const firstResult = await processImportRow({
    importJobId: job.import_job_id,
    leaseOwner,
    rowNumber: 1,
    input: rows[0],
  });

  assert.equal(firstResult.outcome, "inserted");

  const replay = await processImportRow({
    importJobId: job.import_job_id,
    leaseOwner,
    rowNumber: 1,
    input: rows[0],
  });

  assert.equal(replay.alreadyProcessed, true);
  assert.equal(replay.outcome, "inserted");

  const failedResult = await processImportRow({
    importJobId: job.import_job_id,
    leaseOwner,
    rowNumber: 2,
    input: rows[1],
  });

  assert.equal(failedResult.outcome, "failed");
  assert.equal(await MenuItem.countDocuments(), 1);

  const updatedJob = await ImportJob.findOne({
    record_kind: "job",
    import_job_id: job.import_job_id,
  }).lean();

  assert.equal(updatedJob.rows_processed, 2);
  assert.equal(updatedJob.rows_inserted, 1);
  assert.equal(updatedJob.rows_failed, 1);
  assert.equal(updatedJob.rows_skipped, 0);
  assert.equal(updatedJob.checkpoint.last_completed_row, 2);

  assert.equal(
    await ImportRowResult.countDocuments({
      record_kind: "row_result",
      import_job_id: job.import_job_id,
    }),
    2,
  );

  console.log("Transactional row processing checks passed.");
} finally {
  try {
    if (connection) {
      assert.equal(connection.name, databaseName);
      await connection.dropDatabase();
      console.log("Temporary test database removed.");
    }
  } finally {
    await disconnectDatabase();
  }
}
