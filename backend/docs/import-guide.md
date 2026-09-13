# MiseCast Import Guide

## 1. Start the required processes

Run commands from the project root.

Terminal 1 — local MongoDB replica set:

    mongod --dbpath "$PWD/local-data/mongodb-rs" --port 27018 --bind_ip localhost --replSet misecast-rs

The replica set must already have been initialized.
Do not repeat rs.initiate() each time.

Terminal 2 — Express:

    npm start

Terminal 3 — submit imports and run the worker.

The application connection string is:

    MONGODB_URI=mongodb://localhost:27018/misecast?replicaSet=misecast-rs

## 2. Supported submission formats

CSV:

- UTF-8 encoding
- Semicolon delimiter
- Header row containing source field names
- Quoted fields may contain semicolons and newlines
- Duplicate and unsupported headers are rejected

JSON:

- UTF-8 encoding
- Top-level array of row objects
- Decimal values must be strings, such as "12.50"
- Integer quantities may be JSON integers
- Standard JSON parsing applies; avoid duplicate property names

Limits:

- Maximum original file size: 20 MiB
- Maximum rows per submission: 100,000
- Maximum serialized row size: 256 KiB
- Compressed upload bodies are not supported

Files are parsed using bounded temporary memory.
Original upload bytes are stored durably in MongoDB source chunks.

## 3. Submit an import

Endpoint:

    POST /api/imports/:entityName

Query parameters:

- sourceName: required display name
- allowCorrections: optional true or false; defaults to false

Headers:

- Content-Type: application/json or text/csv
- Idempotency-Key: unique key identifying this submission
- X-MiseCast-Request: 1 for scripts without an Origin header

The request body is the original file contents.
Do not use multipart/form-data with this endpoint.

Example CSV upload:

    curl -i -X POST \
      'http://127.0.0.1:3000/api/imports/menu_items?sourceName=menu_items.csv' \
      -H 'Content-Type: text/csv' \
      -H 'X-MiseCast-Request: 1' \
      -H 'Idempotency-Key: initial-menu-import-001' \
      --data-binary @menu_items.csv

A successful submission normally returns HTTP 202 and a status_url.
Acceptance means the source is queued, not that business rows were saved.

## 4. Run the worker

After submitting:

    npm run import:worker

The worker processes currently claimable jobs and then exits.
It is not a continuously running scheduler.

Run it again after submitting more files.

MongoDB permits only one running import job at a time.
An interrupted job with an expired lease is resumed before queued work.

Follow docs/import-order.md so parent records exist before their children.

## 5. Job status and errors

Progress endpoint:

    GET /api/imports/jobs/:importJobId

Failed rows:

    GET /api/imports/jobs/:importJobId/errors?page=1&pageSize=25

Statuses:

- queued: awaiting processing or completion of source storage
- running: processing, or interrupted and awaiting lease recovery
- succeeded: every row inserted, updated or skipped without validation failure
- partial: processing completed with both successful and failed rows
- failed: processing completed with all rows failing validation

Inspect source_ready before expecting a queued job to run.

An infrastructure interruption leaves the job recoverable.
It is not counted as an invalid source row.

Rows are counted from 1, excluding CSV headers and skipped empty lines.
A quoted multiline CSV record is one logical row.

## 6. Repeated submissions and corrections

Same idempotency key, source name, bytes, entity, restaurant and options:

- Return the existing job.
- Do not queue completed work again.

Same idempotency key with different content or options:

- Reject the submission.

New idempotency key with unchanged business rows:

- Create a new job.
- Record matching rows as skipped.

Existing business key with changed values:

- Reject the row unless allowCorrections=true.

Corrections:

- Omitted optional fields preserve existing values.
- Explicit null or blank values clear optional fields.
- Required fields must still be supplied.
- Protected relationship reassignments are rejected.

To correct failed input, submit the corrected file with a new key.
Completed failed rows are not retried under the original job.

Decimal values that differ only in formatting, such as 12.50 and 12.5,
are treated as numerically equal.

## 7. Simulated daily POS sales

Use the same upload endpoint with historical_sales:

    POST /api/imports/historical_sales

Import the referenced menu items, variants and promotions first.

Each sales_record_id must remain stable when resending the same record.
Use a new ID only for a genuinely new sales record.

Every restaurant_id must match RESTAURANT_ID.
Preserve identifiers as strings, including leading zeros.

Submit each daily file with a distinct idempotency key.
Resend an interrupted identical submission using its original key.

Do not generate new sales IDs merely to bypass duplicate detection.

## 8. Restart and recovery

The source, row outcomes, counters and checkpoints live in MongoDB.

Each row transaction commits together:

- Business-record change
- Row outcome
- Counter update
- Checkpoint update

Previously committed rows are not counted again during recovery.

Control + C requests a stop between committed rows.
An abrupt stop may leave a lease active for approximately 60 seconds
after its last renewal. Rerun the worker after it expires.

If source storage was interrupted before source_ready became true,
resend the identical submission with its original idempotency key.

Do not manually delete chunks or change checkpoints to resume a job.

A persistent source corruption or database problem must be resolved
before retrying. There is currently no administrative abandon-job route.

## 9. Verification commands

Parsing:

    node scripts/checkImportParsing.js

Transactional persistence prerequisites:

    npm run check:transactions

Atomic row processing:

    node scripts/checkImportRowProcessing.js

Interrupted-job recovery:

    npm run check:import-recovery

The row-processing and recovery scripts use temporary databases
on the local replica set at port 27018.

Earlier standalone test scripts may still target port 27017.

## 10. Current boundaries

- Actual CSV-package compatibility still requires the real files.
- Imports validate schemas and selected references.
- Operational calculations are not automatically recomputed yet.
- Source forecast imports do not publish a verified model run.
- Processing is atomic per row, not per entire file.
- Earlier successful rows remain saved when later rows fail.
- Completed source chunks and row results are retained.
- Automated retention and abandoned-upload cleanup are not implemented.
- Keep input batches bounded; larger files must be split.
- The application currently provides local request-origin protection,
  not user authentication.
