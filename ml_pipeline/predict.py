"""Predict per-menu sales for a date -- this is what the dashboard's
"predict" button calls.

Two ways in:

1. predict_for_row(model, row): row already has every ml_model_input
   column for that date (simplest case, e.g. a test row from training data).

2. build_input_row(date, ...): assembles that row from the underlying
   source tables in data.txt (promotion, weather, events, public_holiday,
   daily_reservation, menu) -- the real dashboard case: the manager picks a
   date, and the context (weather, confirmed reservations, planned
   promotions, scheduled events/holidays) is looked up, not typed in by
   hand.

   Caveat: this only works for a date that has rows in those source
   tables. The delivered data covers 2024-01-01 through today -- for a
   date past that (a real future prediction), avg_temp/rain/reservations/
   promotions/events for that date don't exist yet and would need a live
   feed (weather forecast API, the reservation system, etc.), which is
   explicitly out of scope for this pipeline. Until that's wired up, demo
   with a date inside the covered range.
"""

import argparse
import json
from pathlib import Path

import pandas as pd

from data_loader import load_ml_model_input, slot_menu_names
from features import build_features
from model import DemandModel
from schema import MENU_SLOTS


def predict_for_row(model: DemandModel, row: pd.Series) -> dict:
    X = build_features(pd.DataFrame([row]))
    preds = model.predict(X).iloc[0]
    return {slot: int(preds[f"{slot}_amount"]) for slot in MENU_SLOTS}


def build_input_row(
    date: pd.Timestamp,
    slot_names: dict,
    menu_df: pd.DataFrame,
    promotion_df: pd.DataFrame,
    weather_df: pd.DataFrame,
    events_df: pd.DataFrame,
    public_holiday_df: pd.DataFrame,
    daily_reservation_df: pd.DataFrame,
) -> pd.Series:
    """slot_names maps menu_1..menu_15 -> the real menu name in that slot
    (see data_loader.slot_menu_names). menu_df needs columns [name, price];
    promotion_df needs [menu_item, percentage_discount, date] and is
    filtered to `date`; the rest are one row per date, as in data.txt."""
    date = pd.Timestamp(date)

    discounts = promotion_df[promotion_df["date"] == date].set_index("menu_item")["percentage_discount"]

    row = {"date": date}
    for slot, menu_name in slot_names.items():
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
    parser.add_argument("--features", default="data/ML_model_input.csv", help="ml_model_input CSV/JSON -- used to resolve menu slot names, and (without --sources-dir) as the row source")
    parser.add_argument("--date", required=True, help="YYYY-MM-DD")
    parser.add_argument(
        "--sources-dir",
        help="directory with menu.csv/promotion.csv/weather.csv/events.csv/public_holiday.csv/daily_reservation.csv -- "
             "if given, the row is assembled from these (the real dashboard path) instead of looked up in --features",
    )
    args = parser.parse_args()

    model = DemandModel.load(args.model)
    features = load_ml_model_input(args.features)
    date = pd.Timestamp(args.date)

    if args.sources_dir:
        src = Path(args.sources_dir)
        row = build_input_row(
            date,
            slot_menu_names(features),
            menu_df=pd.read_csv(src / "menu.csv", sep=";"),
            promotion_df=pd.read_csv(src / "promotion.csv", sep=";", parse_dates=["date"]),
            weather_df=pd.read_csv(src / "weather.csv", sep=";", parse_dates=["date"]),
            events_df=pd.read_csv(src / "events.csv", sep=";", parse_dates=["date"]),
            public_holiday_df=pd.read_csv(src / "public_holiday.csv", sep=";", parse_dates=["date"]),
            daily_reservation_df=pd.read_csv(src / "daily_reservation.csv", sep=";", parse_dates=["date"]),
        )
    else:
        match = features[features["date"] == date]
        if match.empty:
            raise SystemExit(f"no row for date {args.date} in {args.features}")
        row = match.iloc[0]

    print(json.dumps(predict_for_row(model, row), indent=2))
