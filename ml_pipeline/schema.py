"""Column definitions matching data.txt's `ml_model_input` / `predicted_sales_from_ml` tables.

This pipeline is intentionally independent of task/notebook.ipynb (the
variant-level, quantile-regression pipeline). That one predicts per
menu-variant, per-service-period, with P50/P90 bounds. This one predicts a
single daily amount per menu slot, matching the simpler dashboard schema in
data.txt. See ml_pipeline/README.md.
"""

ID_COLUMN = "_id"

NUM_MENUS = 15
MENU_SLOTS = [f"menu_{i}" for i in range(1, NUM_MENUS + 1)]

PRICE_COLUMNS = [f"{slot}_price_after_discount" for slot in MENU_SLOTS]
AMOUNT_COLUMNS = [f"{slot}_amount" for slot in MENU_SLOTS]

CONTEXT_COLUMNS = ["total_reservation", "avg_temp", "rain", "public_holiday", "num_of_event"]
BOOLEAN_COLUMNS = ["rain", "public_holiday"]

# One row per date. menu_i holds the slot's menu name/id (constant across
# rows -- MENU_1..MENU_15); menu_i_price_after_discount is what varies day
# to day. The name columns aren't model features, just labels for output.
ML_MODEL_INPUT_COLUMNS = (
    ["date"]
    + [c for slot in MENU_SLOTS for c in (slot, f"{slot}_price_after_discount")]
    + CONTEXT_COLUMNS
)

PREDICTED_SALES_COLUMNS = [c for slot in MENU_SLOTS for c in (slot, f"{slot}_amount")]

# data.txt's ml_model_input and predicted_sales_from_ml are two separate
# tables joined by _id, not one wide file -- see data_loader.load_training_data.
ML_MODEL_INPUT_REQUIRED_COLUMNS = [ID_COLUMN, *ML_MODEL_INPUT_COLUMNS]
PREDICTED_SALES_REQUIRED_COLUMNS = [ID_COLUMN, *PREDICTED_SALES_COLUMNS]


def require_columns(df, required, source: str) -> None:
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise ValueError(f"{source} is missing required column(s): {missing}")
