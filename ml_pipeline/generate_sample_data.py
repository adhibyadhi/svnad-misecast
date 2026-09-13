"""Synthetic data matching data.txt's schema, so the pipeline is runnable
end to end before the real CSV/JSON export arrives. Not for demoing model
accuracy -- just for exercising train/predict/retrain against something
schema-shaped, with plausible-looking signal (weekday, price, weather,
holiday, event effects) baked in.

    python generate_sample_data.py --days 365 --out sample_data
"""

import argparse
from pathlib import Path

import numpy as np
import pandas as pd

from schema import MENU_SLOTS

CATEGORIES = (["HOT_DRINK"] * 3 + ["COLD_DRINK"] * 3 + ["MAIN"] * 6 + ["SIDE"] * 3)
BASE_PRICES = np.round(np.linspace(3.5, 18.0, 15), 2)
BASE_DEMAND = np.round(np.linspace(60, 15, 15), 1)  # cheaper items sell more, roughly

RNG = np.random.default_rng(42)


def _menu_table() -> pd.DataFrame:
    return pd.DataFrame({
        "_id": [f"menu_{i}" for i in range(1, 16)],
        "name": [f"MENU_{i}" for i in range(1, 16)],
        "category": CATEGORIES,
        "price": BASE_PRICES,
    })


def _weather_table(dates: pd.DatetimeIndex) -> pd.DataFrame:
    day_of_year = dates.dayofyear.values
    seasonal = 18 + 8 * np.sin(2 * np.pi * (day_of_year - 80) / 365)
    avg_temp = np.round(seasonal + RNG.normal(0, 2.5, len(dates)), 1)
    rain = RNG.random(len(dates)) < 0.25
    return pd.DataFrame({"_id": [f"w_{i}" for i in range(len(dates))], "date": dates, "avg_temp": avg_temp, "rain": rain})


def _events_table(dates: pd.DatetimeIndex) -> pd.DataFrame:
    num_of_event = RNG.poisson(0.3, len(dates))
    return pd.DataFrame({"_id": [f"e_{i}" for i in range(len(dates))], "date": dates, "num_of_event": num_of_event})


def _public_holiday_table(dates: pd.DatetimeIndex) -> pd.DataFrame:
    holidays = dates[RNG.random(len(dates)) < 0.015]
    return pd.DataFrame({
        "_id": [f"h_{i}" for i in range(len(holidays))],
        "date": holidays,
        "name": [f"Holiday {i}" for i in range(len(holidays))],
    })


def _daily_reservation_table(dates: pd.DatetimeIndex) -> pd.DataFrame:
    is_weekend = dates.dayofweek.isin([5, 6])
    total_reservation = RNG.poisson(np.where(is_weekend, 55, 30))
    total_people = total_reservation * RNG.integers(2, 5, len(dates))
    return pd.DataFrame({
        "_id": [f"r_{i}" for i in range(len(dates))],
        "date": dates,
        "total_reservation": total_reservation,
        "total_people": total_people,
    })


def _promotion_table(dates: pd.DatetimeIndex) -> pd.DataFrame:
    rows = []
    for d in dates:
        if RNG.random() < 0.1:
            menu = RNG.choice([f"MENU_{i}" for i in range(1, 16)])
            rows.append({"menu_item": menu, "percentage_discount": RNG.choice([10, 15, 20, 25]), "date": d})
    for i, r in enumerate(rows):
        r["_id"] = f"p_{i}"
    return pd.DataFrame(rows, columns=["_id", "menu_item", "percentage_discount", "date"])


def build_ml_model_input(
    dates: pd.DatetimeIndex,
    weather: pd.DataFrame,
    events: pd.DataFrame,
    holidays: pd.DataFrame,
    reservations: pd.DataFrame,
    promotions: pd.DataFrame,
) -> pd.DataFrame:
    n = len(dates)
    holiday_set = set(holidays["date"])
    is_weekend = dates.dayofweek.isin([5, 6]).astype(int)
    is_holiday = np.array([d in holiday_set for d in dates], dtype=int)

    weather_idx = weather.set_index("date")
    events_idx = events.set_index("date")
    reservations_idx = reservations.set_index("date")

    avg_temp = weather_idx.loc[dates, "avg_temp"].values
    rain = weather_idx.loc[dates, "rain"].values
    num_of_event = events_idx.loc[dates, "num_of_event"].values
    total_reservation = reservations_idx.loc[dates, "total_reservation"].values

    discounts = {
        d: promotions[promotions["date"] == d].set_index("menu_item")["percentage_discount"]
        for d in dates
    }

    data = {"date": dates}
    amounts = {}
    for i, slot in enumerate(MENU_SLOTS, start=1):
        menu_name = f"MENU_{i}"
        base_price = BASE_PRICES[i - 1]
        discount_pct = np.array([float(discounts[d].get(menu_name, 0)) for d in dates])
        price_after_discount = np.round(base_price * (1 - discount_pct / 100), 2)

        data[slot] = menu_name
        data[f"{slot}_price_after_discount"] = price_after_discount

        category = CATEGORIES[i - 1]
        weekend_boost = 1.25 if category == "MAIN" else 1.0
        if category == "COLD_DRINK":
            temp_effect = 1 + 0.02 * (avg_temp - 20)
        elif category == "HOT_DRINK":
            temp_effect = 1 - 0.01 * (avg_temp - 20)
        else:
            temp_effect = np.ones(n)
        rain_effect = np.where(rain, 0.9, 1.0)
        holiday_effect = np.where(is_holiday, 1.4, 1.0)
        discount_effect = 1 + discount_pct / 100 * 1.5
        reservation_effect = 1 + (total_reservation - total_reservation.mean()) / total_reservation.mean() * 0.3
        weekend_effect = np.where(is_weekend, weekend_boost, 1.0)

        expected = (
            BASE_DEMAND[i - 1]
            * weekend_effect
            * temp_effect
            * rain_effect
            * holiday_effect
            * discount_effect
            * reservation_effect
        )
        noise = RNG.normal(1.0, 0.15, n)
        amounts[f"{slot}_amount"] = np.clip(np.round(expected * noise), 0, None).astype(int)

    data["total_reservation"] = total_reservation
    data["avg_temp"] = avg_temp
    data["rain"] = rain
    data["public_holiday"] = is_holiday.astype(bool)
    data["num_of_event"] = num_of_event

    df = pd.DataFrame(data)
    for col, values in amounts.items():
        df[col] = values
    return df


def main(days: int, out_dir: str) -> None:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)

    dates = pd.date_range(end=pd.Timestamp.today().normalize(), periods=days, freq="D")

    menu = _menu_table()
    weather = _weather_table(dates)
    events = _events_table(dates)
    holidays = _public_holiday_table(dates)
    reservations = _daily_reservation_table(dates)
    promotions = _promotion_table(dates)
    ml_model_input = build_ml_model_input(dates, weather, events, holidays, reservations, promotions)

    menu.to_csv(out / "menu.csv", index=False)
    weather.to_csv(out / "weather.csv", index=False)
    events.to_csv(out / "events.csv", index=False)
    holidays.to_csv(out / "public_holiday.csv", index=False)
    reservations.to_csv(out / "daily_reservation.csv", index=False)
    promotions.to_csv(out / "promotion.csv", index=False)
    ml_model_input.to_csv(out / "ml_model_input_sample.csv", index=False)

    print(f"Wrote {days} days of synthetic data to {out}/")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--days", type=int, default=365)
    parser.add_argument("--out", default="sample_data")
    args = parser.parse_args()
    main(args.days, args.out)
