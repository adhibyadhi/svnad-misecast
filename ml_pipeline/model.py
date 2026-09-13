"""The demand model itself -- a thin wrapper around an existing scikit-learn
estimator (no custom modeling code, per the "use an existing package" goal).

RandomForestRegressor is used because it supports multi-output regression
natively (all 15 menus in one model, sharing tree structure) and needs
little tuning, which suits a hackathon timeline. Swapping in another
scikit-learn-compatible regressor is a one-line change in _default_estimator.
"""

from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor

from features import FEATURE_COLUMNS
from schema import AMOUNT_COLUMNS, MENU_SLOTS


def _default_estimator() -> RandomForestRegressor:
    return RandomForestRegressor(
        n_estimators=300,
        max_depth=None,
        min_samples_leaf=2,
        n_jobs=-1,
        random_state=42,
    )


class DemandModel:
    def __init__(self, estimator=None):
        self.estimator = estimator or _default_estimator()
        self.feature_columns_ = FEATURE_COLUMNS
        self.target_columns_ = AMOUNT_COLUMNS

    def fit(self, X: pd.DataFrame, y: pd.DataFrame) -> "DemandModel":
        self.estimator.fit(X[self.feature_columns_], y[self.target_columns_])
        return self

    def predict(self, X: pd.DataFrame) -> pd.DataFrame:
        raw = self.estimator.predict(X[self.feature_columns_])
        raw = np.clip(np.round(raw), 0, None).astype(int)
        return pd.DataFrame(raw, columns=self.target_columns_, index=X.index)

    def predict_by_menu(self, X: pd.DataFrame) -> pd.DataFrame:
        """One row per (input row, menu) -- convenient for a dashboard
        table instead of 15 wide columns."""
        wide = self.predict(X)
        long_rows = []
        for idx in wide.index:
            for slot in MENU_SLOTS:
                long_rows.append({
                    "row": idx,
                    "menu": slot,
                    "predicted_amount": int(wide.loc[idx, f"{slot}_amount"]),
                })
        return pd.DataFrame(long_rows)

    def save(self, path: str) -> None:
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        joblib.dump(self, path)

    @classmethod
    def load(cls, path: str) -> "DemandModel":
        return joblib.load(path)
