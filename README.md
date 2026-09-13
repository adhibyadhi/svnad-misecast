# svnad-misecast

MiseCast (from "mise en place" + "forecast") — a restaurant manager picks a date on the dashboard, clicks predict, and sees the expected number of units sold per menu item. Built for Forward: AI in Business Hackathon by Team SVNAD.

## Pipeline

The data and model pipeline lives in [`ml_pipeline/`](ml_pipeline/README.md), built against the schema in [`data.txt`](data.txt): one row per date, a fixed `menu_1..menu_15` slot per menu, a single predicted amount per menu. A scikit-learn `RandomForestRegressor` (native multi-output) trains on historical days and their actual sales; retraining re-runs the same pipeline against updated data and only replaces the live model if accuracy hasn't regressed. See that README for the full breakdown, how to run it, and the reasoning behind the CSV/JSON and model choices.

[`api/`](api/README.md) exposes that pipeline over HTTP (FastAPI) for the dashboard's predict/retrain buttons. It doesn't touch MongoDB — the Node side assembles a feature row from the database and hands it to `POST /predict`, keeping the model service testable and deployable on its own.

## Directories

```tree
svnad-misecast/
├── README.md
├── requirements.txt
├── render.yaml / Procfile       # deploy config for api/
├── data.txt                     # DBML schema ml_pipeline/ and api/ are built against
├── ml_pipeline/                 # data + model pipeline -- see its own README
│   ├── schema.py / data_loader.py / features.py / model.py
│   ├── train.py / predict.py / retrain.py
│   ├── generate_sample_data.py  # synthetic data for a smoke test without the real files
│   └── data/ / sample_data/ / models/
├── api/                         # FastAPI service wrapping ml_pipeline/ -- see its own README
│   └── main.py
└── backend/                     # Node.js/Express/MongoDB app -- the dashboard (WIP, teammate-owned)
    ├── app.js / server.js
    ├── config/ controllers/ middleware/ models/ routes/ services/ utils/ views/
    ├── docs/local-setup.md
    └── package.json
```

Three pieces, three owners: `ml_pipeline/` + `api/` (this side) produce and serve the demand
prediction; `backend/` (Node + MongoDB, teammate-owned) is the dashboard and data of record. They
meet at `POST /predict` on `api/` — see `api/README.md` for the exact request/response contract.

## Setup

```shell
pip install -r requirements.txt
```

## Running the pipeline / API

See [`ml_pipeline/README.md`](ml_pipeline/README.md#running-it) and [`api/README.md`](api/README.md#running-locally).

---
Team SVNAD — Forward: AI in Business Hackathon.
