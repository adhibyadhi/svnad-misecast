# MiseCast Supporting Storage Contract

## 1. Scope

These five infrastructure collections support the existing 19 business
collections without changing their source fields or keys.

Their schemas and services will be implemented with the corresponding
application features. This document defines their storage contracts.

Business dates use YYYY-MM-DD strings.
Metadata timestamps use MongoDB Date values.
Decimal settings use Decimal128.
All identifiers are strings.

Secrets remain in environment configuration, not these collections.

## 2. application_settings

Stores the configured restaurant, operational settings and publication
pointer as separate records.

Common fields:

- setting_key: required string; unique
- setting_type: restaurant, ingredient, calendar or publication
- schema_version: required positive integer
- created_at: required timestamp
- updated_at: required timestamp

Each setting_type has its own validated value structure.

Restaurant setting:

- restaurant_id: string
- name: string
- latitude: decimal
- longitude: decimal
- state_territory: string
- timezone: IANA timezone string
- services: bounded list of service names and local start/end times

Ingredient setting, one record per ingredient:

- ingredient_id: string
- unit: string
- safety_stock_quantity: non-negative decimal
- order_coverage_days: non-negative integer

Calendar setting, one record per rule or date range:

- context_id: string
- context_type: string
- start_date: business date
- end_date: business date
- label: string
- source: string
- verified_at: nullable timestamp

Publication setting:

- restaurant_id: string
- published_forecast_run_id: nullable string
- published_at: nullable timestamp
- publication_version: non-negative integer

Use deterministic setting keys for singleton and per-ingredient settings.
Do not embed unlimited calendar history in one record.

## 3. import_jobs

Stores import progress and bounded row-error records.

Common fields:

- record_kind: job or error_chunk
- import_job_id: required string
- created_at: timestamp

Job record fields:

- idempotency_key: string
- request_hash: string
- entity_name: string
- source_name: string
- source_format: csv or json
- source_checksum: string
- status: queued, running, succeeded, failed or partial
- rows_processed: non-negative integer
- rows_inserted: non-negative integer
- rows_updated: non-negative integer
- rows_skipped: non-negative integer
- rows_failed: non-negative integer
- checkpoint: nullable validated resume position
- lease_owner: nullable string
- lease_expires_at: nullable timestamp
- started_at: nullable timestamp
- finished_at: nullable timestamp
- error_summary: nullable bounded string

Error chunk fields:

- chunk_number: non-negative integer
- errors: bounded list of row number, field, error code and message

Indexes:

- Unique import_job_id for job records only
- Unique idempotency_key for job records only
- Unique import_job_id + chunk_number for error_chunk records only
- Job status + lease_expires_at for recovery

Use partial indexes scoped by record_kind.

A repeated idempotency key with a different request hash is rejected.
Checkpoints must be compatible with safe replay after a crash.
Error records must not contain credentials or unlimited raw uploads.

## 4. external_context_cache

Stores individual context entries and provider-response chunks.

Fields:

- cache_key: required string
- chunk_number: non-negative integer
- schema_version: positive integer
- provider: string
- context_type: string
- location_key: string
- request_hash: string
- retrieved_at: timestamp
- fresh_until: timestamp
- source_date_start: nullable business date
- source_date_end: nullable business date
- payload: bounded provider-specific data
- provenance: validated source and synthetic-data metadata

Unique index:

- cache_key + chunk_number

Provider adapters validate their payload structures.

fresh_until controls freshness, not automatic deletion.
Stale entries may support explicitly labelled fallback behaviour.
Missing provider data is not equivalent to a known zero.

Required forecast-time context is copied into immutable run snapshots
before cache entries are replaced or removed.

## 5. forecast_runs

Stores run metadata and bounded immutable snapshot chunks.

Common fields:

- record_kind: run or snapshot_chunk
- forecast_run_id: required string
- created_at: timestamp

Run record fields:

- restaurant_id: string
- idempotency_key: string
- request_hash: string
- status: queued, running, succeeded or failed
- model_artifact_id: string
- model_version: string
- contract_version: string
- generated_business_date: business date
- sales_start_date: business date
- sales_end_date: business date
- inventory_start_date: business date
- inventory_end_date: business date
- data_cutoff_at: timestamp
- lease_owner: nullable string
- lease_expires_at: nullable timestamp
- attempt_number: non-negative integer
- started_at: nullable timestamp
- finished_at: nullable timestamp
- is_synthetic: Boolean
- snapshot_manifest: bounded list of dataset names, chunk counts,
  row counts and checksums
- error_summary: nullable bounded string

Snapshot chunk fields:

- attempt_number: non-negative integer
- dataset_name: string
- chunk_number: non-negative integer
- row_count: non-negative integer
- checksum: string
- rows: bounded list of dataset-specific validated records

Snapshot datasets include:

- Exact model inputs
- Raw model outputs
- Price and promotion assumptions
- Context and inventory inputs used by the run
- Published demand and inventory recommendation datasets

Indexes:

- Unique forecast_run_id for run records only
- Unique restaurant_id + idempotency_key for run records only
- Unique forecast_run_id + attempt_number + dataset_name + chunk_number
  for snapshot_chunk records only
- Run status + lease_expires_at for recovery

Use partial indexes scoped by record_kind.

## 6. Publication decision

Use versioned snapshot reads with an atomic published-run pointer.

Workflow:

1. Claim a run using a durable lease.
2. Write attempt-specific snapshot chunks.
3. Validate complete dataset coverage and checksums.
4. Mark the successful attempt and its manifest as succeeded.
5. Atomically update the publication setting using its expected version.

Only the current lease owner and attempt may finalize a run.
A stale worker must not overwrite a newer publication.

Readers capture published_forecast_run_id once per request and read
all forecast datasets from that run's immutable snapshots.

The existing output collections are current-projection copies for
compatibility. They are not the source for consistent multi-dataset
forecast reads because their keys do not identify a run.

A failed or incomplete run leaves the publication pointer unchanged.
Retries must recover safely if a run succeeds before pointer publication.

This approach does not require multi-document transactions.
The workflow and concurrency checks must be implemented in Commit 7.

## 7. model_artifacts

Stores metadata about trusted local model artifacts.

Fields:

- model_artifact_id: required string; unique
- model_version: string
- artifact_relative_path: string within the configured model directory
- artifact_checksum: string
- runtime: string
- runtime_version: string
- dependency_manifest_relative_path: string
- dependency_manifest_checksum: string
- input_contract_version: string
- output_contract_version: string
- verification_status: pending, verified or rejected
- verified_at: nullable timestamp
- created_at: timestamp

Model binaries remain in the configured local model directory.
Do not load paths outside that directory.
Verification requires agreement with a supplied input/output sample.

## 8. Bounded storage and implementation rules

Each chunk must have at most 500 rows and a serialized BSON size
no greater than 4 MiB. Start a new chunk when either limit is reached.

Reject an individual record that exceeds the chunk size limit.
Validate every row using its dataset-specific contract.

Keep manifests bounded to the supported dataset list.
Store additional history as separate records, not growing arrays.

Retention must preserve the current published run and any runs retained
for evaluation or audit. Never remove snapshots while retained readers
or references still require them.

The 19-business-model count check remains scoped to models/index.js.
Future supporting models will have a separate export file and checks.

## Import storage implementation refinement

The import_jobs collection now uses these record kinds:

- job: submission identity, source manifest, progress and worker lease
- source_chunk: original upload bytes in chunks of at most 256 KiB
- row_result: one committed outcome per logical source row

row_result documents replace the earlier error_chunk proposal.
Failed results contain bounded error codes and messages.

Additional job fields:

- restaurant_id: restaurant captured at submission
- allow_corrections: immutable submission option
- source_size_bytes: nullable source byte count, maximum 20 MiB
- source_chunk_count: nullable chunk count, maximum 80
- source_ready: Boolean, initially false
- source_ready_at: nullable timestamp

A queued job is eligible for processing only when source_ready is true
and its complete source manifest has been verified.

Each row transaction must:

1. Verify and fence the current worker lease through a conditional
   write to the job document.
2. Check whether the row already has a committed result.
3. Apply any business-record change.
4. Insert the row result.
5. Update counters and the sequential checkpoint.

These operations commit together or roll back together.

A previously committed row result must not increment counters again.

Expected row validation failures are recorded without business changes.
Database outages, transaction failures and lost leases are worker failures;
they must not be mislabeled as invalid source rows.

Imports require a transaction-capable local MongoDB replica set.
This is an additional import requirement. The forecast publication
pointer design remains unchanged.

Transactions protect atomic row outcomes. Cross-record relationship
changes still require controlled write ordering and concurrency rules.
