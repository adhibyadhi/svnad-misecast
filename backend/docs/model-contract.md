# MiseCast Model Contract

## 1. Integration status

The project description outlines an existing demand model.

The executable artifact, preprocessing code, dependencies and a known
input/output sample have not yet been inspected.

The mappings below are planned integration decisions.
They must be verified against the supplied executable model.

The website remains JavaScript-based.
If the existing model requires Python, a local adapter will invoke its
existing runtime rather than rewriting the model.

## 2. Application and model responsibilities

JavaScript services will:

- Read persisted restaurant data.
- Refresh available external context.
- Validate forecast readiness.
- Build model-compatible features.
- Invoke the local model adapter.
- Validate outputs.
- Persist successful forecasts and recommendations.

The model adapter will:

- Accept a versioned input contract.
- Apply the model's verified preprocessing.
- Execute the supplied model.
- Return a versioned output contract.
- Report errors without publishing incomplete results.

The model does not require direct database access.

## 3. Forecast windows

The sales interface defaults to next Monday through Sunday
in the restaurant timezone.

Inventory fields that explicitly describe ten-day demand require
a separate complete ten-day forecast window.

Do not populate ten_day_forecast_demand_quantity using only seven days.

Forecast horizon calculations must use the restaurant's business dates.

## 4. Input contract mismatches

| Source mismatch                                                         | Decision                                                                                                           |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| calendar_context.csv is absent from the ERD                             | Store calendar settings/context in supporting storage and adapt them to the model's verified input shape.          |
| current_inventory.csv is absent from the ERD                            | Derive usable stock from batches when compatible with the model definition; keep safety-stock settings separately. |
| reserved_covers differs from confirmed_reservation_covers               | Inspect preprocessing and supply the exact quantity used in training.                                              |
| special_occasion_demand_factor differs from special_occasion            | Preserve text and numeric meanings separately; recover the original multiplier rule.                               |
| Weather keys include record_type                                        | Match the appropriate actual or forecast record explicitly.                                                        |
| Reservation keys include service_period and record_type                 | Match the full contextual key; do not join by date alone.                                                          |
| Ingredient projections and runout summaries use different date meanings | Associate them through the generating run and ingredient, not an assumed equality between their dates.             |

## 5. Feature generation

Verify the original definitions of:

- Calendar categories and season labels
- Public and school holidays
- Weather condition mappings
- Hot/cold thresholds
- Reservation quantities
- Event relevance and attendance
- Promotion features
- Seven-day lag quantities
- Twenty-eight-day rolling averages

Historical lag and rolling features must exclude information unavailable
at the forecast's cutoff.

Future outcome fields remain null.

quantity_sold_target and all \*\_actual outcome fields must not be passed
as prediction inputs.

Historical evaluations must use context available at the time of the
forecast. Later actual weather or revised reservations must not replace
the original forecast-time inputs.

## 6. Planned output mappings

| Model output                 | Application field              | Meaning                           |
| ---------------------------- | ------------------------------ | --------------------------------- |
| p50                          | predicted_portions             | Median-demand prediction          |
| p90                          | upper_bound_portions           | High-demand quantile              |
| No supplied lower quantile   | lower_bound_portions = null    | Unavailable lower bound           |
| No verified confidence score | forecast_confidence_pct = null | Unavailable confidence percentage |
| Unsupported explanations     | key_demand_drivers = null      | No invented model explanation     |

Preserve the raw model response in supporting run storage.

P90 is not a 90% confidence percentage.

Summing individual p90 predictions is a conservative scenario.
It is not automatically the p90 of total restaurant or ingredient demand.

## 7. Revenue interpretation

Preserve original raw names such as expected_revenue_p50.

Label p50-based revenue as a median-demand revenue scenario.
Do not automatically describe it as a mathematical expected value.

Snapshot the prices and promotion assumptions used for a run.

Keep list-price revenue distinct from discount-adjusted projected revenue.
Do not apply a discount twice.

Unsupported baseline or revenue values remain null until a documented
calculation is available.

## 8. Output validation

Before publication, verify:

- Expected date, service and variant coverage
- No duplicate output rows
- Known business identifiers
- Finite numeric values
- Non-negative predicted demand
- Correct quantile ordering
- Consistent units and model version
- Agreement between run metadata and output dates

Model execution must have a timeout, output-size limits,
error handling and temporary-file cleanup.

Logs must not corrupt the machine-readable prediction response.

## 9. Durable execution and publication

Persist queued, running, succeeded and failed run states.

Use durable claims/leases and idempotency keys so concurrent requests
or restarts cannot publish conflicting results.

Keep immutable run snapshots in bounded supporting documents.
Do not accumulate unlimited history inside one MongoDB document.

Before implementing publication, document and implement one approach:

- Local MongoDB replica-set transactions; or
- Versioned snapshot reads with an atomic published-run pointer.

Readers must never observe a partially published forecast.

A failed run must preserve the previous successful forecast.

## 10. Materials required before integration

- Executable model artifact
- Prediction and preprocessing code
- Pinned runtime dependencies
- Known input/output sample
- Model feature names, types and category mappings
- Existing runout implementation, if supplied separately
- Actual calendar_context and current_inventory schemas
- Model version and artifact checksum

Model integration cannot be marked complete until the supplied model
runs end to end and agrees with its standalone sample.
