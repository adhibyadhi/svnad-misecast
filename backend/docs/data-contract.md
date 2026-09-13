# MiseCast Data Contract

## 1. Scope

The application initially supports one configured restaurant.

The 19 source collections retain their existing collection names,
snake_case fields and business identifiers.

Some collections do not contain restaurant_id. The current structure
therefore does not provide multi-restaurant isolation.

MongoDB is the persistent source of truth. Temporary calculation arrays
are allowed, but application data and job state must survive restarts.

## 2. Business identifiers

MongoDB generates an internal \_id for each document.

Source identifiers such as menu_item_id and ingredient_id remain strings.
Imports and business relationships use these source identifiers.

Existing imported IDs must be preserved.

New single-record business IDs will use a documented entity prefix
followed by a UUID generated with crypto.randomUUID().
Do not generate identifiers from row counts.

Composite-key records use their existing field combinations.

## 3. Unique keys

| Collection                 | Unique business key                     |
| -------------------------- | --------------------------------------- |
| menu_items                 | menu_item_id                            |
| menu_variants              | menu_variant_id                         |
| ingredient_master          | ingredient_id                           |
| menu_recipes               | recipe_line_id                          |
| historical_sales           | sales_record_id                         |
| inventory_batches_expiry   | batch_id                                |
| suppliers                  | supplier_offer_id                       |
| promotion_history          | promotion_id                            |
| weather                    | date + record_type                      |
| reservations               | date + service_period + record_type     |
| local_events               | event_id                                |
| model_input_table          | date + service_period + menu_variant_id |
| demand_forecast            | forecast_id                             |
| ingredient_demand_forecast | forecast_date + ingredient_id           |
| runout_predictions         | prediction_as_of_date + ingredient_id   |
| order_recommendations      | order_recommendation_id                 |
| expiry_menu_actions        | expiry_action_id                        |
| data_dictionary            | file_name + field_order                 |
| data_assumptions           | assumption_id                           |

Unique indexes must exist before imports begin.

A unique index prevents duplicate keys. It does not define whether an
incoming matching record should be skipped, corrected or rejected.
The import service will implement that decision.

## 4. Relationships

Relationships use source business identifiers rather than MongoDB \_id.

Services must verify that:

- A menu variant's parent menu item exists.
- A recipe's variant and ingredient exist.
- A recipe's menu_item_id matches the variant's parent.
- A sale's variant belongs to its stated menu item.
- A referenced promotion exists when promotion_id is supplied.
- An inventory batch references an existing ingredient.
- A supplier offer references an existing ingredient.
- Forecast and recommendation references are valid.

menu_recipes remains the many-to-many bridge between variants
and ingredients.

supplier_id is intentionally non-unique. An order recommendation must
resolve an appropriate offer for both its supplier and ingredient.

Schema validation does not enforce these relationships.

## 5. Dates and times

Business dates are stored as valid YYYY-MM-DD strings.

They represent restaurant calendar dates, not UTC timestamps.
Do not convert them through the computer's local timezone.

Local time fields accept HH:MM or HH:MM:SS in 24-hour format.
Services interpret these times using the configured restaurant timezone.

Job, refresh and run metadata will use MongoDB Date timestamps.

Date-order checks belong in services, including receipt/expiry dates
and promotion start/end dates. Overnight events require explicit handling.

## 6. Numbers and precision

Monetary and decimal quantity fields use MongoDB Decimal128.

Supply decimal inputs as strings, for example "12.50".
Do not first convert CSV monetary text to JavaScript Number.

Use decimal.js for application-side decimal calculations.
Calculation services must configure sufficient precision for their
supported inputs and intermediate results before implementation.

Do not round stored source values during import.

Round final displayed AUD amounts to two decimal places using an explicit
half-up policy. Preserve calculation precision until the documented
financial total or display boundary.

Round recommended order packs upward to whole packs after applying
minimum-order rules.

Recipe quantities and predicted portions may remain fractional.

Whole-number fields must contain safe integers.
Non-negative quantities reject negative values.

Signed fields include temperatures, gross margins, uplift percentages,
and source scores whose bounds have not been established.

Percentages and fractions are different:

- 10 in a percentage field means 10%.
- 0.10 in a fraction field means 10%.

Normal document JSON serialization exposes decimal fields as strings.
Lean queries and aggregation results will need explicit decimal
serialization at the API boundary.

## 7. Missing values

Null means unknown, unavailable or not applicable.

Zero means a known zero.

Do not replace missing prices, demand, reservations or stock settings
with zero merely to make calculations run.

Required operational inputs must be checked before the relevant
calculation or forecast can proceed.

Unknown dietary tags remain null. Do not present them as verified
dietary suitability.

Optional blank CSV values must be normalized according to field type.
They must not become zero through numeric coercion.

## 8. Source strings and enums

Preserve source names and pipe-delimited string fields.

Parse pipe-delimited fields only when a service needs their components.

The supplied definitions explicitly establish:

- record_type: actual or forecast
- data_split: training, validation or test

Other category, service, channel, unit, risk and status vocabularies
remain pending until the actual CSV and data dictionary are inspected.

Schema-required fields and numeric limits are provisional where source
nullability or semantics have not yet been verified.

## 9. Source authority and derived values

Historical sales retain the prices and descriptions recorded at sale time.
Changing today's menu must not rewrite historical sales.

Inventory batch quantities are the stock authority.
Do not add a separate inventory snapshot to batch totals.

Operational imports and manager changes update authoritative source data.
Services recalculate dependent fields after those updates.

Examples of derived values:

- Menu gross margins
- Ingredient recipe and variant counts
- Batch values and days until expiry
- Forecast features
- Demand, runout and ordering projections

Imported derived values may be preserved initially, but must be checked
against verified calculation rules before operational use.

Preserve source_file, source_row_number and is_synthetic where supplied.
Generated results derived from synthetic data must retain that provenance.

## 10. Forecast storage

Source output keys remain unchanged.

The forecast publication workflow must preserve the previous successful
result when a new run fails.

Collections whose keys cannot distinguish multiple runs represent
current published projections. Immutable historical snapshots belong
in supporting storage.

Publication consistency, run snapshots and durable job state will be
implemented before model integration is considered complete.

## 11. Pending source-dependent decisions

The actual CSV package and executable model are still required to verify:

- Source nullability and accepted category values
- Preparation-loss calculations and unit conversions
- Gross-margin and raw-order-requirement definitions
- Score scales and risk thresholds
- Refund and negative POS transaction handling
- Hot/cold thresholds and calendar rules
- Reservation feature meanings
- Model input types, preprocessing and output mappings

Do not silently alter source data to pass provisional validation.

## 12. Verification status

The model loading, focused document validation and index checks
were reported as passing during setup.

These checks do not establish complete CSV compatibility,
reference integrity or correctness of future calculation services.
