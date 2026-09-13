"""Train the demand model on historical ml_model_input + actual sales.

    python train.py --data sample_data/ml_model_input_sample.csv

The holdout split is by date (last `--holdout-days` days), not random --
this is a forecasting problem, so validating on a random shuffle would leak
future information (e.g. rolling patterns) into the training set.
"""

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error

from data_loader import load_ml_model_input
from features import build_features, build_targets
from model import DemandModel
from schema import AMOUNT_COLUMNS

DEFAULT_MODEL_PATH = Path(__file__).parent / "models" / "demand_model.joblib"
DEFAULT_METRICS_PATH = Path(__file__).parent / "models" / "metrics.json"


def time_based_split(df, holdout_days: int):
    cutoff = df["date"].max() - pd.Timedelta(days=holdout_days)
    train_df = df[df["date"] <= cutoff]
    test_df = df[df["date"] > cutoff]
    return train_df, test_df


def evaluate(model: DemandModel, X_test, y_test) -> dict:
    preds = model.predict(X_test)
    per_menu_mae = {
        col: round(mean_absolute_error(y_test[col], preds[col]), 3)
        for col in AMOUNT_COLUMNS
    }
    overall_mae = round(float(np.mean(list(per_menu_mae.values()))), 3)
    return {"overall_mae": overall_mae, "per_menu_mae": per_menu_mae}


def train(data_path: str, holdout_days: int, model_path: str, metrics_path: str) -> dict:
    df = load_ml_model_input(data_path)
    if len(df) < holdout_days + 30:
        raise ValueError(
            f"only {len(df)} labeled day(s) available -- need at least "
            f"{holdout_days + 30} to hold out {holdout_days} for evaluation "
            f"and still have enough to train on."
        )

    train_df, test_df = time_based_split(df, holdout_days)
    X_train, y_train = build_features(train_df), build_targets(train_df)
    X_test, y_test = build_features(test_df), build_targets(test_df)

    model = DemandModel().fit(X_train, y_train)
    metrics = evaluate(model, X_test, y_test)
    metrics.update({
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "data_path": str(data_path),
        "train_rows": len(train_df),
        "test_rows": len(test_df),
        "train_date_range": [str(train_df["date"].min().date()), str(train_df["date"].max().date())],
        "test_date_range": [str(test_df["date"].min().date()), str(test_df["date"].max().date())] if len(test_df) else None,
    })

    model.save(model_path)
    Path(metrics_path).parent.mkdir(parents=True, exist_ok=True)
    Path(metrics_path).write_text(json.dumps(metrics, indent=2))

    return metrics


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", required=True, help="path to ml_model_input CSV or JSON")
    parser.add_argument("--holdout-days", type=int, default=21)
    parser.add_argument("--model-out", default=str(DEFAULT_MODEL_PATH))
    parser.add_argument("--metrics-out", default=str(DEFAULT_METRICS_PATH))
    args = parser.parse_args()

    metrics = train(args.data, args.holdout_days, args.model_out, args.metrics_out)
    print(json.dumps(metrics, indent=2))
    print(f"\nModel saved to {args.model_out}")
