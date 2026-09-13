# Dashboard Output Data

Generated output from the MiseCast forecasting pipeline (`task/notebook.ipynb`), consumed directly by the dashboard. Nothing in this folder is hand-edited — both files are produced by re-running the notebook end to end, and get overwritten every time it runs.

## `forecast.json`

Demand forecast (Section 4.1) plus expected revenue, one row per menu variant / date / service period for the upcoming forecast window.

| Field | Type | Meaning |
|---|---|---|
| `date` | string (`YYYY-MM-DD`) | The date being forecast |
| `service_period` | string | `"Lunch"` or `"Dinner"` |
| `menu_variant_id` | string | e.g. `"MI-001-SMALL"` |
| `menu_item_id` | string | e.g. `"MI-001"` — the parent dish, before size split |
| `p50` | number | Central/expected forecast — portions |
| `p90` | number | Cautious/high-demand forecast — portions. Always ≥ `p50` |
| `expected_revenue_p50` | number | `p50 × sale_price_aud` — AUD |
| `expected_revenue_p90` | number | `p90 × sale_price_aud` — AUD |

## `runout.json`

Ingredient run-out prediction (Section 4.2) — when each ingredient's usable stock is predicted to hit zero, given the forecasted demand above and current stock on hand.

| Field | Type | Meaning |
|---|---|---|
| `ingredient_id` | string | e.g. `"BASE-001"` |
| `ingredient_name` | string | e.g. `"Cooked jasmine rice"` |
| `ingredient_group_code` | string | e.g. `"BASE"`, `"PROT"`, `"LEAF"` — ingredient category |
| `run_out_date_p50` | string or `null` | Predicted run-out date under expected demand. `null` = doesn't run out within the forecast window |
| `days_until_run_out_p50` | number or `null` | Same, as a day count from the window's start |
| `run_out_date_p90` | string or `null` | Predicted run-out date under cautious/high demand |
| `days_until_run_out_p90` | number or `null` | Same, as a day count |

## Regenerating

Run `task/notebook.ipynb` top to bottom. The export cell (end of the "Run Out Prediction" section) writes both files here, overwriting whatever was there before.

## Known limitations

- **No future restocking is modeled.** Run-out dates are based only on the batches in `inventory_batches_expiry.csv` as of the current inventory snapshot — the pipeline doesn't know about incoming supplier orders. A near-term run-out date often just means "reorder this soon," not that the restaurant is unprepared.
- **Expiry is treated as a hard cap on usable stock**, not true batch-level FIFO consumption — a batch that expires unconsumed is excluded from that day onward, but we don't track which physical units were sold vs. wasted. That distinction is Section 4.4's job.
- **Add-ons/Modifiers** is the one menu category where the forecast doesn't beat the required matching-weekday baseline (low volume, noisy category) — disclosed here rather than hidden, per the honest-limitations principle the rest of this project follows.