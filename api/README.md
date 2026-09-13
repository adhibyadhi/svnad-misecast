# MiseCast demand API

FastAPI service wrapping `ml_pipeline/` for the dashboard's predict/retrain
buttons. **No MongoDB access here** -- Node owns assembling data from the
database; this service only runs the model. Auto-generated interactive
docs at `/docs` once running.

## Endpoints

### `POST /predict` -- the production contract

Send one `ml_model_input` row for a date (everything the model needs,
already assembled from Mongo on the Node side). Get amounts back.

```jsonc
// request
{
  "date": "2026-09-13",
  "menu_1": "Chicken Teriyaki Bowl", "menu_1_price_after_discount": 14.09,
  "menu_2": "Sashimi Poke Bowl",     "menu_2_price_after_discount": 17.90,
  // ... menu_3 through menu_15, same pattern ...
  "total_reservation": 32,
  "avg_temp": 26.4,
  "rain": true,
  "public_holiday": true,
  "num_of_event": 2
}
```

```jsonc
// response
{
  "date": "2026-09-13",
  "predictions": { "menu_1": 33, "menu_2": 24, /* ... menu_3..menu_15 */ },
  "model_trained_at": "2026-09-13T09:35:06.532573+00:00"
}
```

Field types/names match `data.txt`'s `ml_model_input` table exactly
(minus `_id`) -- see `ml_pipeline/schema.py` if the schema changes.
`predictions` keys are the `menu_1..menu_15` slot names; map them to real
menu names/ids however Mongo stores that mapping.

### `GET /predict/demo?target_date=YYYY-MM-DD`

Same response shape, but looks the date up in the data shipped in
`ml_pipeline/data/` instead of requiring a request body. For testing this
service on its own, no Node/Mongo required. Only covers dates in that
data (2024-01-01 through whenever it was generated).

### `POST /retrain`

Retrains against `ml_pipeline/data/ML_model_input.csv` +
`predicted_sales_from_ml.csv`, promotes the new model only if accuracy
hasn't regressed (see `ml_pipeline/retrain.py`), and reloads this
service's in-memory model. No request body.

```jsonc
{ "promoted": true, "overall_mae": 2.832, "previous_overall_mae": 2.832, "regression_pct": 0.0 }
```

### `GET /model/status`

Returns the currently-loaded model's training metrics (overall + per-menu
MAE, training date range, etc.) -- `404` if nothing's been trained yet.

### `GET /health`

`{"status": "ok", "model_loaded": true}` -- for uptime checks / Render's
health check.

## Running locally

```bash
pip install -r ../requirements.txt
uvicorn api.main:app --reload --port 8000
# then http://127.0.0.1:8000/docs
```

## Deploying

`render.yaml` (repo root) is a Render Blueprint: Render -> New -> Blueprint
-> pick this repo -> deploy. Free tier, builds from `requirements.txt`,
starts via `uvicorn api.main:app --host 0.0.0.0 --port $PORT`, health
check at `/health`. A `Procfile` is included too for Railway/Heroku-style
platforms that read that instead.

CORS is wide open (`allow_origins=["*"]`) for now -- tighten
`api/main.py`'s `CORSMiddleware` to the dashboard's real origin once it
has one.
