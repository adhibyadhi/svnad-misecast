# MiseCast demand pipeline (dashboard schema)

Data and model pipeline behind the dashboard's "predict" button: a manager
picks a date, and the expected amount sold per menu is returned.

This is a **separate, simpler pipeline** from `task/notebook.ipynb`. That
notebook predicts per menu-*variant*, per *service period*, with P50/P90
quantile bounds -- a richer model against a richer synthetic dataset. This
pipeline matches the schema in `data.txt` at the project root instead: one
row per **date**, a fixed `menu_1..menu_15` slot per menu, a single point
prediction per menu. Built by explicit choice to keep the two independent
rather than merge them; see the repo's `data.txt` for the source schema
(`ml_model_input`, `predicted_sales_from_ml`, and the supporting
`promotion` / `weather` / `events` / `public_holiday` / `daily_reservation`
/ `menu` tables).

MongoDB, the API, and the dashboard UI are all out of scope here on
purpose -- this only covers turning stored data into a trained model and a
prediction.

## Files

| File | Purpose |
| --- | --- |
| `schema.py` | Column names/constants matching `data.txt`. |
| `data_loader.py` | Loads `ml_model_input`-shaped CSV or JSON into a validated, typed DataFrame. |
| `features.py` | Turns loaded data into the model's feature matrix (calendar fields + prices + context) and target matrix (15 amounts). |
| `model.py` | `DemandModel` -- a thin wrapper around `sklearn.ensemble.RandomForestRegressor` (multi-output natively, minimal tuning). Swap the estimator in one place if needed. |
| `train.py` | Trains on historical data, holds out the last N days by date (not randomly -- this is a forecasting problem), reports MAE per menu, saves the model. |
| `predict.py` | Predicts for a date. Includes `build_input_row()`, which assembles that date's feature row from the underlying source tables (weather, reservations, promotions, events, holidays) instead of requiring the caller to type in 20 numbers. |
| `retrain.py` | Retrains to a timestamped file, and only promotes it to `models/latest.joblib` if accuracy hasn't regressed more than `--max-regression-pct`. Keeps `models/retrain_log.json` so the dashboard can show accuracy over time. |
| `generate_sample_data.py` | Synthetic data matching the schema (weekday/price/weather/holiday effects baked in), so the pipeline runs before the real export arrives. Not meant to demonstrate real-world accuracy. |

## Running it

```bash
pip install -r ../requirements.txt   # pandas, scikit-learn, joblib, numpy already listed

# 1. Generate a runnable dataset until the real one arrives
python generate_sample_data.py --days 365 --out sample_data

# 2. Train
python train.py --data sample_data/ml_model_input_sample.csv

# 3. Predict for a date already in that file
python predict.py --model models/demand_model.joblib \
    --data sample_data/ml_model_input_sample.csv --date 2026-09-13

# 4. Retrain (e.g. after new daily_sales lands), with a promotion guard
python retrain.py --data sample_data/ml_model_input_sample.csv
```

## CSV vs. JSON for the real training data

**CSV is the better fit here.** `ml_model_input` is already flat and
fixed-width (15 menu slots, always the same shape per row) -- exactly what
CSV represents natively and what `pandas.read_csv` loads with zero
preprocessing. JSON only earns its cost when records are irregular
(nested arrays, variable-length lists, deeply nested objects) -- none of
which applies to this schema. `data_loader.py` accepts either (dispatched
on file extension), but if only one format is worth generating, make it
CSV: smaller file size, trivial to append new days to, and no flattening
step before training.

Two things to get right whichever format arrives:

- **One row per date**, sorted, no duplicate dates (`data_loader.py`
  raises if it finds one -- silently keeping only one row per date would
  quietly drop training signal).
- **Timing integrity**: every column in a training row must be the value
  *known at prediction time* for that date, not filled in afterward
  (e.g. `total_reservation` should be bookings as of a realistic cutoff,
  not a post-hoc actual count that a manager couldn't have had in advance
  when asking for a same-day or future prediction).

## Model choice

`RandomForestRegressor` from scikit-learn, used because it supports
multi-output regression natively (one model predicts all 15 menus at
once, sharing tree structure) and needs almost no tuning -- a good fit for
a hackathon timeline with an existing, well-tested package rather than
custom modeling code. If accuracy needs to improve later, the two cheapest
next steps are: (1) more historical days (this kind of model benefits a
lot from more rows), and (2) per-menu gradient boosting models (e.g.
`HistGradientBoostingRegressor`, one per menu) if some menus need
different feature importances than others -- `model.py` isolates the
estimator so that swap doesn't touch the rest of the pipeline.

## What's not handled yet (by design, per current scope)

- No live database read/write -- `data_loader.py`/`predict.py` work off
  files, and wiring them to MongoDB is a separate, later step.
- No API layer -- `predict_for_row()` and `retrain()` are plain Python
  functions meant to be called from wherever the API ends up living.
- No confidence interval -- data.txt's `predicted_sales_from_ml` has a
  single `amount` per menu, not a range, so the model returns a point
  estimate only.
