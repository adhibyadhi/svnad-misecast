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

## `orders.json`

Order recommendations (Section 4.3) — a classic reorder-point / order-up-to-level rule
applied to the run-out predictions above, telling the manager what to order, by when,
and roughly what it'll cost.

| Field | Type | Meaning |
|---|---|---|
| `ingredient_id` / `ingredient_name` | string | The ingredient to reorder |
| `order_by_date` | string (`YYYY-MM-DD`) | Place the order by this date to avoid running below the safety-stock buffer |
| `days_until_order_by` | number | Same, as a day count from the window's start |
| `urgency` | string | `"Order now"` / `"Urgent"` (≤2 days) / `"Upcoming"` |
| `recommended_order_quantity` | number | How much to order, already rounded up to whole packs |
| `unit` | string | Unit for the quantity above (matches `ingredient_master.csv`) |
| `order_packs` | number | Number of supplier packs that quantity comes from |
| `estimated_cost_aud` | number | Pack cost × packs, plus delivery fee if under the free-delivery threshold |
| `supplier_name` | string | Primary supplier for this ingredient |
| `lead_time_days` | number | Days between placing the order and it arriving |

Only ingredients projected to cross their reorder point within the forecast window appear
here — an ingredient with comfortable stock for the whole window is simply absent, not
listed with a `null`.

## `expiry_waste.json`

Expiry waste prediction (Section 4.4) — the mirror image of run-out prediction: instead of "when do we run out," this tracks FIFO batch-level consumption to find ingredient batches that will still have stock left over when they expire, and what that waste is likely to cost.

| Field | Type | Meaning |
|---|---|---|
| `batch_id` | string | The specific inventory batch at risk, e.g. `"LOT-BASE-001-1"` |
| `ingredient_id` / `ingredient_name` | string | The ingredient in that batch |
| `ingredient_group_code` | string | e.g. `"BASE"`, `"PROT"`, `"LEAF"` — ingredient category |
| `expiry_date` | string (`YYYY-MM-DD`) | When this batch expires |
| `quantity_wasted` | number | Predicted leftover, unconsumed quantity at expiry |
| `estimated_waste_value_aud` | number | `quantity_wasted × unit_cost_aud` for this batch |

Only batches predicted to have leftover stock appear here — a batch that's fully
consumed before it expires is simply absent. Batches expiring after the forecast
window aren't included either way, since there isn't enough visibility yet to
call it.

**Note on methodology:** this uses the model's P50 (expected) forecast, not P90. For run-out prediction, P90 (cautious/high-demand) is the safety-conscious choice — you don't want to be caught short. For waste, it's the opposite: the pessimistic scenario is *low* demand, so P90 would understate waste risk by assuming unusually strong sales. P50 is the honest default here.

## Regenerating

Run `task/notebook.ipynb` top to bottom. The export cell (end of the "Run Out Prediction" section) writes both files here, overwriting whatever was there before.

## Known limitations

- **No future restocking is modeled.** Run-out dates are based only on the batches in `inventory_batches_expiry.csv` as of the current inventory snapshot — the pipeline doesn't know about incoming supplier orders. A near-term run-out date often just means "reorder this soon," not that the restaurant is unprepared.
- **Expiry is treated as a hard cap on usable stock**, not true batch-level FIFO consumption — a batch that expires unconsumed is excluded from that day onward, but we don't track which physical units were sold vs. wasted. That distinction is Section 4.4's job.
- **Add-ons/Modifiers** is the one menu category where the forecast doesn't beat the required matching-weekday baseline (low volume, noisy category) — disclosed here rather than hidden, per the honest-limitations principle the rest of this project follows.