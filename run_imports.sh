#!/usr/bin/env bash
set -euo pipefail

API="http://127.0.0.1:3000/api/imports"
SOURCE_DIR="./data"
GENERATED_DIR="../data/mongo_import"

import_file() {
  local entity="$1" filepath="$2"
  local key="import-$(date +%s)-$entity-$RANDOM"

  echo "=== $entity ($filepath) ==="
  local submit_response
  submit_response=$(curl -s -X POST \
    "$API/$entity?sourceName=$(basename "$filepath")" \
    -H 'Content-Type: text/csv' -H 'X-MiseCast-Request: 1' \
    -H "Idempotency-Key: $key" \
    --data-binary "@$filepath")

  local job_id
  job_id=$(echo "$submit_response" | jq -r '.job.import_job_id')
  if [ "$job_id" = "null" ] || [ -z "$job_id" ]; then
    echo "Submission failed:"; echo "$submit_response" | jq .; exit 1
  fi

  npm run import:worker --silent

  local status
  status=$(curl -s "$API/jobs/$job_id" | jq -r '.job.status')
  local job_json
  job_json=$(curl -s "$API/jobs/$job_id")

  echo "$job_json" | jq '.job | {status, rows_processed, rows_inserted, rows_updated, rows_skipped, rows_failed, error_summary}'

  if [ "$status" != "succeeded" ] && [ "$status" != "partial" ]; then
    echo "STOPPED: $entity did not succeed (status: $status). Fix this before continuing."
    exit 1
  fi
  if [ "$(echo "$job_json" | jq '.job.rows_failed')" != "0" ]; then
    echo "Some rows failed -- check details:"
    curl -s "$API/jobs/$job_id/errors" | jq .
    echo "Review the errors above. Continuing to the next file, but come back to this."
  fi
  echo
}

# 1. Source data -- order matters, per validateImportReferences.js
import_file menu_items "$SOURCE_DIR/menu_items.csv"
import_file ingredient_master "$SOURCE_DIR/ingredient_master.csv"
import_file menu_variants "$SOURCE_DIR/menu_variants.csv"
import_file menu_recipes "$SOURCE_DIR/menu_recipes.csv"
import_file suppliers "$SOURCE_DIR/suppliers.csv"
import_file inventory_batches_expiry "$SOURCE_DIR/inventory_batches_expiry.csv"
import_file promotion_history "$SOURCE_DIR/promotion_history.csv"
import_file historical_sales "$SOURCE_DIR/historical_sales.csv"
import_file weather "$SOURCE_DIR/weather.csv"
import_file reservations "$SOURCE_DIR/reservations.csv"
import_file local_events "$SOURCE_DIR/local_events.csv"
import_file data_dictionary "$SOURCE_DIR/data_dictionary.csv"
import_file data_assumptions "$SOURCE_DIR/data_assumptions.csv"

# 2. Our pipeline's own output -- any order among these four
import_file demand_forecast "$GENERATED_DIR/demand_forecast.csv"
import_file runout_predictions "$GENERATED_DIR/runout_predictions.csv"
import_file order_recommendations "$GENERATED_DIR/order_recommendations.csv"
import_file expiry_menu_actions "$GENERATED_DIR/expiry_menu_actions.csv"

echo "All imports complete."