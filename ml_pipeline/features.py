"""Feature engineering: turns a loaded ml_model_input DataFrame into the
matrix the model trains/predicts on. Kept separate from data_loader so
train.py and predict.py build features identically."""

import pandas as pd

from schema import AMOUNT_COLUMNS, CONTEXT_COLUMNS, PRICE_COLUMNS

CALENDAR_COLUMNS = ["day_of_week", "month", "is_weekend"]
FEATURE_COLUMNS = CALENDAR_COLUMNS + PRICE_COLUMNS + CONTEXT_COLUMNS


def add_calendar_features(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["day_of_week"] = df["date"].dt.dayofweek
    df["month"] = df["date"].dt.month
    df["is_weekend"] = df["day_of_week"].isin([5, 6]).astype(int)
    return df


def build_features(df: pd.DataFrame) -> pd.DataFrame:
    df = add_calendar_features(df)
    df["rain"] = df["rain"].astype(int)
    df["public_holiday"] = df["public_holiday"].astype(int)
    return df[FEATURE_COLUMNS]


def build_targets(df: pd.DataFrame) -> pd.DataFrame:
    """Only present in historical training data (labeled with actual
    daily_sales), not in a future date being predicted."""
    return df[AMOUNT_COLUMNS]
