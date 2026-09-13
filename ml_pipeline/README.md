# MiseCast demand pipeline (dashboard schema)

Data and model pipeline behind the dashboard's "predict" button: a manager
picks a date, and the expected amount sold per menu is returned.

An earlier, more elaborate pipeline (`task/notebook.ipynb`) predicted per
menu-*variant*, per *service period*, with P50/P90 quantile bounds, against
a richer synthetic dataset -- it and its supporting data/docs were removed
once the team settled on the simpler schema below. This pipeline matches
`data.txt` at the project root: one row per **date**, a fixed
`menu_1..menu_15` slot per menu, a single point prediction per menu. See
the repo's `data.txt` for the source schema (`ml_model_input`,
`predicted_sales_from_ml`, and the supporting `promotion` / `weather` /
`events` / `public_holiday` / `daily_reservation` / `menu` tables).

MongoDB, the API, and the dashboard UI are all out of scope here on
purpose -- this only covers turning stored data into a trained model and a
prediction.

## Data

`data/ML_model_input.csv` and `data/predicted_sales_from_ml.csv` are the
real export from the team, joined by `_id` (matching data.txt: these are
two separate tables, not one merged file). 987 real dates
(2024-01-01 -> today, no gaps), padded to exactly 10,000 rows per file by
repeating each day's row under fresh `_id`s -- `data_loader.py` joins the
two files on `_id`, then collapses those repeats back to one row per date
(verifying first that repeated rows actually agree, so a genuine data bug
wouldn't be silently swallowed).

`sample_data/` (via `generate_sample_data.py`) is synthetic data in the
old single-file shape, kept only for a quick pipeline smoke test when
real data isn't at hand -- not used for the real training run anymore.

The rest of `data/` (`menu.csv`, `promotion.csv`, `weather.csv`,
`events.csv`, `public_holiday.csv`, `daily_reservation.csv`,
`daily_sales.csv`) are data.txt's individual source tables -- the ones
`predict.py --sources-dir` reads to assemble a feature row from a date
alone, the real dashboard path. `daily_sales.csv` itself isn't used by
this pipeline (it's what `predicted_sales_from_ml.csv` was already
built from); kept for reference. All of this is synthetic (deterministic,
fixed-seed generated), covering 2024-01-01 through today -- there's no
real restaurant behind it yet.

## Files

| File | Purpose |
| --- | --- |
| `schema.py` | Column names/constants matching `data.txt`. |
| `data_loader.py` | Loads and joins the `ml_model_input` / `predicted_sales_from_ml` CSV or JSON pair into one validated, typed DataFrame (`load_training_data`), collapsing the padded duplicate-date rows. |
| `features.py` | Turns loaded data into the model's feature matrix (calendar fields + prices + context) and target matrix (15 amounts). |
| `model.py` | `DemandModel` -- a thin wrapper around `sklearn.ensemble.RandomForestRegressor` (multi-output natively, minimal tuning). Swap the estimator in one place if needed. |
| `train.py` | Trains on historical data, holds out the last N days by date (not randomly -- this is a forecasting problem), reports MAE per menu, saves the model. |
| `predict.py` | Predicts for a date. Includes `build_input_row()`, which assembles that date's feature row from the underlying source tables (weather, reservations, promotions, events, holidays) instead of requiring the caller to type in 20 numbers. |
| `retrain.py` | Retrains to a timestamped file, and only promotes it to `models/latest.joblib` if accuracy hasn't regressed more than `--max-regression-pct`. Keeps `models/retrain_log.json` so the dashboard can show accuracy over time. |
| `generate_sample_data.py` | Synthetic data matching the schema, for a smoke test without the real files. Not meant to demonstrate real-world accuracy. |

## Running it

```bash
pip install -r ../requirements.txt   # pandas, scikit-learn, joblib, numpy already listed

# 1. Train on the real data
python train.py --features data/ML_model_input.csv --targets data/predicted_sales_from_ml.csv

# 2. Predict for a date already in ML_model_input.csv
python predict.py --model models/demand_model.joblib \
    --features data/ML_model_input.csv --date 2026-09-13

# 2b. Or assemble the row from the individual source tables instead --
#     the actual dashboard path (date in, context looked up, not typed in)
python predict.py --model models/demand_model.joblib \
    --features data/ML_model_input.csv --date 2026-09-13 --sources-dir data

# 3. Retrain (e.g. after new daily_sales lands), with a promotion guard
python retrain.py --features data/ML_model_input.csv --targets data/predicted_sales_from_ml.csv
```

Current holdout accuracy (last 21 days held out, trained on the other 966
of 987 real days): **overall MAE 2.83 units/menu/day** (`models/metrics.json`
has the full per-menu breakdown after running `train.py`).

## CSV vs. JSON

**CSV is the better fit here**, and it's what arrived. `ml_model_input`
and `predicted_sales_from_ml` are already flat and fixed-width (15 menu
slots, always the same shape per row) -- exactly what CSV represents
natively and what `pandas.read_csv` loads with zero preprocessing. JSON
only earns its cost when records are irregular (nested arrays,
variable-length lists), which doesn't apply here. `data_loader.py` accepts
either per file (dispatched on extension, delimiter auto-detected for
CSV -- the real files are semicolon-separated).

Two things that mattered getting the real files to load cleanly, worth
knowing if a fresh export arrives:

- **Two files, joined by `_id`**, not one merged file -- matches data.txt's
  actual table split. `load_training_data()` does the join.
- **Repeated dates**: the export pads to a fixed row count by repeating
  whole days. `collapse_duplicate_dates()` handles this, but raises if
  same-date rows ever *disagree* -- that would mean the repeat isn't just
  padding, and training on it silently would be wrong.
- **Timing integrity**: every feature column must be the value *known at
  prediction time* for that date (e.g. `total_reservation` should be
  bookings as of a realistic cutoff), not filled in after the fact.

## Model choice

`RandomForestRegressor` from scikit-learn, used because it supports
multi-output regression natively (one model predicts all 15 menus at
once, sharing tree structure) and needs almost no tuning -- a good fit for
a hackathon timeline with an existing, well-tested package rather than
custom modeling code. If accuracy needs to improve later, the cheapest
next step is per-menu gradient boosting models (e.g.
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
