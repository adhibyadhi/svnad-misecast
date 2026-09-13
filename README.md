# svnad-misecast

MiseCast (from "mise en place" + "forecast") — a restaurant manager picks a date on the dashboard, clicks predict, and sees the expected number of units sold per menu item. Built for Forward: AI in Business Hackathon by Team SVNAD.

## Pipeline

The data and model pipeline lives in [`ml_pipeline/`](ml_pipeline/README.md), built against the schema in [`data.txt`](data.txt): one row per date, a fixed `menu_1..menu_15` slot per menu, a single predicted amount per menu. A scikit-learn `RandomForestRegressor` (native multi-output) trains on historical days and their actual sales; retraining re-runs the same pipeline against updated data and only replaces the live model if accuracy hasn't regressed. See that README for the full breakdown, how to run it, and the reasoning behind the CSV/JSON and model choices.

## Directories

```tree
svnad-misecast/
├── README.md
├── requirements.txt
├── data.txt                    # DBML schema ml_pipeline/ is built against
├── ml_pipeline/                 # data + model pipeline -- see its own README
│   ├── schema.py / data_loader.py / features.py / model.py
│   ├── train.py / predict.py / retrain.py
│   ├── generate_sample_data.py  # synthetic data until the real export arrives
│   └── sample_data/ / models/
└── backend/                    # Node.js/Express/MongoDB app -- the dashboard (WIP)
    ├── app.js / server.js
    ├── config/ controllers/ middleware/ models/ routes/ services/ utils/ views/
    ├── docs/local-setup.md
    └── package.json
```

The Python side (`ml_pipeline/`) produces the demand prediction. The Node side (`backend/`) is a
separate application with its own MongoDB database — see `backend/docs/local-setup.md` to run it.
Wiring the two together (backend calling into `ml_pipeline/predict.py`, and defining the MongoDB
collections from `data.txt`) is deliberately out of scope until the data/model side is settled — see
`ml_pipeline/README.md`.

## Setup

```shell
pip install -r requirements.txt
```

## Running the pipeline

See [`ml_pipeline/README.md`](ml_pipeline/README.md#running-it).

---
Team SVNAD — Forward: AI in Business Hackathon.
