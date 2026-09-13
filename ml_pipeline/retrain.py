"""Retrain on demand (e.g. a dashboard "retrain" action, or a periodic job)
once more labeled days of daily_sales have accumulated.

Trains to a timestamped file first and only promotes it to models/latest.joblib
if it doesn't regress accuracy beyond --max-regression-pct against the
current model's recorded metrics -- so a bad data drop can't silently
replace a working model. Keeps a run log (models/retrain_log.json) so the
dashboard can show accuracy over time.
"""

import argparse
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path

from train import train

MODELS_DIR = Path(__file__).parent / "models"
LATEST_MODEL = MODELS_DIR / "latest.joblib"
LATEST_METRICS = MODELS_DIR / "latest_metrics.json"
RETRAIN_LOG = MODELS_DIR / "retrain_log.json"


def _load_log() -> list:
    return json.loads(RETRAIN_LOG.read_text()) if RETRAIN_LOG.exists() else []


def retrain(data_path: str, holdout_days: int = 21, max_regression_pct: float = 15.0) -> dict:
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    candidate_model = MODELS_DIR / f"model_{timestamp}.joblib"
    candidate_metrics = MODELS_DIR / f"metrics_{timestamp}.json"

    metrics = train(data_path, holdout_days, str(candidate_model), str(candidate_metrics))

    previous_mae = None
    if LATEST_METRICS.exists():
        previous_mae = json.loads(LATEST_METRICS.read_text())["overall_mae"]

    regression_pct = (
        100 * (metrics["overall_mae"] - previous_mae) / previous_mae
        if previous_mae else 0
    )
    promoted = previous_mae is None or regression_pct <= max_regression_pct

    if promoted:
        shutil.copy(candidate_model, LATEST_MODEL)
        shutil.copy(candidate_metrics, LATEST_METRICS)

    log_entry = {
        "timestamp": timestamp,
        "data_path": data_path,
        "overall_mae": metrics["overall_mae"],
        "previous_overall_mae": previous_mae,
        "regression_pct": round(regression_pct, 2),
        "promoted": promoted,
        "model_file": str(candidate_model.name),
    }
    log = _load_log()
    log.append(log_entry)
    RETRAIN_LOG.write_text(json.dumps(log, indent=2))

    return log_entry


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", required=True)
    parser.add_argument("--holdout-days", type=int, default=21)
    parser.add_argument("--max-regression-pct", type=float, default=15.0)
    args = parser.parse_args()

    result = retrain(args.data, args.holdout_days, args.max_regression_pct)
    print(json.dumps(result, indent=2))
    if not result["promoted"]:
        print(
            f"\nNOT promoted: MAE regressed {result['regression_pct']}% "
            f"(limit {args.max_regression_pct}%). Previous model kept as latest.joblib."
        )
