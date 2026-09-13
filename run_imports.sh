#!/usr/bin/env bash
set -euo pipefail

BASE_URL="http://127.0.0.1:3000"
SOURCE_DIR="data/import_ready"
BACKEND_DIR="backend"
POLL_INTERVAL=1
MAX_POLLS=60

ENTITIES=(
  "menu_items:menu_items.csv"
  "ingredient_master:ingredient_master.csv"
  "menu_variants:menu_variants.csv"
  "menu_recipes:menu_recipes.csv"
  "suppliers:suppliers.csv"
  "inventory_batches_expiry:inventory_batches_expiry.csv"
  "promotion_history:promotion_history.csv"
  "historical_sales:historical_sales.csv"
  "weather:weather.csv"
  "reservations:reservations.csv"
  "local_events:local_events.csv"
  "data_dictionary:data_dictionary.csv"
  "data_assumptions:data_assumptions.csv"
  "demand_forecast:demand_forecast.csv"
  "runout_predictions:runout_predictions.csv"
  "order_recommendations:order_recommendations.csv"
  "expiry_menu_actions:expiry_menu_actions.csv"
)

for pair in "${ENTITIES[@]}"; do
  ENTITY="${pair%%:*}"
  FILE="${pair##*:}"
  FILE_PATH="$SOURCE_DIR/$FILE"

  echo "=== $ENTITY ($FILE_PATH) ==="

  if [ ! -f "$FILE_PATH" ]; then
    echo "  SKIP: file not found."
    continue
  fi

  IDEMPOTENCY_KEY="svnad-${ENTITY}-v1"

  RESPONSE=$(curl -sS -X POST \
    "$BASE_URL/api/imports/$ENTITY?sourceName=$FILE" \
    -H "Content-Type: text/csv" \
    -H "X-MiseCast-Request: 1" \
    -H "Idempotency-Key: $IDEMPOTENCY_KEY" \
    --data-binary @"$FILE_PATH")

  JOB_ID=$(echo "$RESPONSE" | jq -r '.job.import_job_id // empty')

  if [ -z "$JOB_ID" ]; then
    echo "  SUBMIT FAILED. Response:"
    echo "$RESPONSE" | jq .
    exit 1
  fi

  echo "  submitted -> job $JOB_ID"

  (cd "$BACKEND_DIR" && npm run import:worker --silent)

  STATUS="queued"
  for _ in $(seq 1 "$MAX_POLLS"); do
    STATUS_RESPONSE=$(curl -sS "$BASE_URL/api/imports/jobs/$JOB_ID" -H "X-MiseCast-Request: 1")
    STATUS=$(echo "$STATUS_RESPONSE" | jq -r '.job.status')
    if [ "$STATUS" = "succeeded" ] || [ "$STATUS" = "partial" ] || [ "$STATUS" = "failed" ]; then
      break
    fi
    sleep "$POLL_INTERVAL"
  done

  ROWS_PROCESSED=$(echo "$STATUS_RESPONSE" | jq -r '.job.rows_processed')
  ROWS_INSERTED=$(echo "$STATUS_RESPONSE" | jq -r '.job.rows_inserted')
  ROWS_UPDATED=$(echo "$STATUS_RESPONSE" | jq -r '.job.rows_updated')
  ROWS_SKIPPED=$(echo "$STATUS_RESPONSE" | jq -r '.job.rows_skipped')
  ROWS_FAILED=$(echo "$STATUS_RESPONSE" | jq -r '.job.rows_failed')

  echo "  status=$STATUS processed=$ROWS_PROCESSED inserted=$ROWS_INSERTED updated=$ROWS_UPDATED skipped=$ROWS_SKIPPED failed=$ROWS_FAILED"

  if [ "$ROWS_FAILED" != "0" ] && [ "$ROWS_FAILED" != "null" ]; then
    echo "  --- row errors ---"
    curl -sS "$BASE_URL/api/imports/jobs/$JOB_ID/errors?page=1&pageSize=25" -H "X-MiseCast-Request: 1" | jq .
  fi

  if [ "$STATUS" = "failed" ]; then
    echo "  HALTING: $ENTITY failed to import. Fix the source data and rerun."
    exit 1
  fi

  echo ""
done

echo "All entities submitted."