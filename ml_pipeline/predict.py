"""Predict per-menu sales for a date -- this is what the dashboard's
"predict" button calls.

Two ways in:

1. predict_for_row(model, row): row already has every ml_model_input
   column for that date (simplest case, e.g. a test row from training data).

2. build_input_row(date, ...): assembles that row from the underlying
   source tables in data.txt (promotion, weather, events, public_holiday,
   daily_reservation, menu) for a date that hasn't happened yet -- which is
   the real dashboard case: the manager picks a future date, and the
   context (forecast weather, confirmed reservations, planned promotions,
   scheduled events/holidays) is looked up, not typed in by hand.
"""

import argparse
import json

import pandas as pd

from data_loader import load_ml_model_input
from features import build_features
from model import DemandModel
from schema import MENU_SLOTS


def predict_for_row(model: DemandModel, row: pd.Series) -> dict:
    X = build_features(pd.DataFrame([row]))
    preds = model.predict(X).iloc[0]
    return {slot: int(preds[f"{slot}_amount"]) for slot in MENU_SLOTS}


def build_input_row(
    date: pd.Timestamp,
    menu_df: pd.DataFrame,
    promotion_df: pd.DataFrame,
    weather_df: pd.DataFrame,
    events_df: pd.DataFrame,
    public_holiday_df: pd.DataFrame,
    daily_reservation_df: pd.DataFrame,
) -> pd.Series:
    """menu_df needs columns [name, price]; promotion_df needs
    [menu_item, percentage_discount, date] and is filtered to `date`; the
    rest are one row per date, as in data.txt."""
    date = pd.Timestamp(date)

    discounts = promotion_df[promotion_df["date"] == date].set_index("menu_item")["percentage_discount"]

    row = {"date": date}
    for i, slot in enumerate(MENU_SLOTS, start=1):
        menu_name = f"MENU_{i}"
        base_price = float(menu_df.loc[menu_df["name"] == menu_name, "price"].iloc[0])
        discount_pct = float(discounts.get(menu_name, 0))
        row[slot] = menu_name
        row[f"{slot}_price_after_discount"] = round(base_price * (1 - discount_pct / 100), 2)

    def _lookup(df: pd.DataFrame, col: str, default):
        match = df[df["date"] == date]
        return match.iloc[0][col] if len(match) else default

    row["total_reservation"] = _lookup(daily_reservation_df, "total_reservation", 0)
    row["avg_temp"] = _lookup(weather_df, "avg_temp", weather_df["avg_temp"].mean())
    row["rain"] = bool(_lookup(weather_df, "rain", False))
    row["public_holiday"] = date in set(public_holiday_df["date"])
    row["num_of_event"] = _lookup(events_df, "num_of_event", 0)

    return pd.Series(row)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="models/demand_model.joblib")
    parser.add_argument("--data", required=True, help="ml_model_input CSV/JSON containing the date to predict")
    parser.add_argument("--date", required=True, help="YYYY-MM-DD, must be a row in --data")
    args = parser.parse_args()

    model = DemandModel.load(args.model)
    df = load_ml_model_input(args.data)
    row = df[df["date"] == pd.Timestamp(args.date)]
    if row.empty:
        raise SystemExit(f"no row for date {args.date} in {args.data}")

    print(json.dumps(predict_for_row(model, row.iloc[0]), indent=2))
