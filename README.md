# svnad-misecast
AI-powered inventory copilot for restaurants — forecasts menu demand, predicts ingredient run-out and expiry risk, and recommends orders and promotions. Built for Forward: AI in Business Hackathon by Team SVNAD.

SVNAD MiseCast turns a restaurant's sales history, reservations, and local events into a single daily decision: what to order, how much, and what to sell before it expires. It forecasts menu demand, converts that into ingredient-level run-out risk, and hands the manager one clear, explained recommendation to approve.

## Pipeline

Four stages, each feeding the next:

1. **Demand forecasting** — a pooled quantile regression model (P50/P90) predicts portions sold per menu variant, per day, per service period, trained on real sales history plus calendar, weather, reservations, local events, and promotions.
2. **Run-out prediction** — converts the forecast into ingredient-level demand via the recipe table, and predicts when each ingredient's usable stock hits zero, accounting for batch expiry.
3. **Order optimization** — a reorder-point / order-up-to-level rule flags which ingredients need reordering, how much, and by when, using each ingredient's primary supplier (lead time, pack size, cost).
4. **Expiry intelligence** — the mirror image of run-out: FIFO batch-level consumption tracking finds which ingredient batches will go to waste, and which menu items could be promoted to sell through them first.

Validated against the required matching-weekday baseline: the forecast model beats it overall (WAPE 0.083 vs. 0.088) and in 6 of 7 menu categories on a 14-day holdout window — the one honest miss (Add-ons/Modifiers, a low-volume category) is disclosed rather than hidden.

**Note:** `ml_pipeline/` is a second, independent data+model pipeline built against the simpler dashboard schema in `data.txt` (one row per date, fixed `menu_1..15`, single point prediction) — it does not replace or feed into the four stages above. See `ml_pipeline/README.md` for why the two are kept separate.

## Directories

```tree
svnad-misecast/
├── README.md
├── requirements.txt
├── data/                      # source CSVs (menu, recipes, sales, calendar, inventory, suppliers, ...)
│   └── dashboard_data/        # generated JSON output the dashboard reads -- see its own README
├── utils/
│   ├── data_handling.py       # CSV loaders
│   └── order_optimization.py  # ingredient demand + order recommendation logic (Sections 4.2/4.3)
├── task/
│   └── notebook.ipynb         # the full ML pipeline: feature engineering -> model -> forecast -> revenue -> run-out -> orders -> expiry
├── ml_pipeline/                # separate, simpler dashboard pipeline matching data.txt's schema -- see its own README
├── data.txt                    # DBML schema for ml_pipeline/ (ml_model_input, predicted_sales_from_ml, ...)
└── backend/                   # Node.js/Express/MongoDB app -- the dashboard, imports, and (WIP) forecast display
    ├── app.js / server.js
    ├── config/ controllers/ middleware/ models/ routes/ services/ utils/ views/
    ├── docs/                  # data-contract.md, model-contract.md, import-guide.md, local-setup.md
    └── package.json
```

The Python side (`data/`, `utils/`, `task/`) produces the forecast, run-out, order, and expiry-waste
output. The Node side (`backend/`) is a separate application with its own MongoDB database, import
pipeline, and management screens — see `backend/docs/local-setup.md` to run it. Integrating the two
means transforming the Python pipeline's output into the exact collections `backend/docs/model-contract.md`
already specifies (`demand_forecast`, `runout_predictions`, `order_recommendations`, `expiry_menu_actions`)
and submitting them through `backend`'s existing import API.

## Setup

```shell
pip install -r requirements.txt
```

## Running the pipeline

Open `task/notebook.ipynb` and run all cells top to bottom. It loads the source data from `data/`, trains the demand model, forecasts the upcoming window, and writes the dashboard's input files to `data/dashboard_data/` (see that folder's `README.md` for the exact output schema).

## Known limitations

- Order optimization and expiry intelligence are rule-based, not ML — deliberately, since they're deterministic business logic rather than pattern-learning problems.
- Run-out prediction doesn't model future restocking; a near-term run-out date usually just means "reorder soon," not that the pipeline failed to account for it.
- See `data/dashboard_data/README.md` for the specific simplifications behind the run-out and expiry-waste numbers (batch expiry handling, P50 vs. P90 choice).

---
Team SVNAD — Forward: AI in Business Hackathon.