"""Load ml_model_input-shaped data (see data.txt) from CSV or JSON into a
normalized DataFrame, regardless of which format the source system sends."""

import json

import pandas as pd

from schema import BOOLEAN_COLUMNS, ML_MODEL_INPUT_COLUMNS, MENU_SLOTS, require_columns


def _coerce_types(df: pd.DataFrame) -> pd.DataFrame:
    df["date"] = pd.to_datetime(df["date"])
    for col in BOOLEAN_COLUMNS:
        if df[col].dtype != bool:
            df[col] = df[col].astype(str).str.strip().str.lower().isin({"true", "1", "yes"})
    numeric_cols = [c for c in df.columns if c not in ("date", *BOOLEAN_COLUMNS, *MENU_SLOTS)]
    for col in numeric_cols:
        df[col] = pd.to_numeric(df[col], errors="coerce")
    return df


def _clean(df: pd.DataFrame, source: str) -> pd.DataFrame:
    df = df.dropna(how="all")
    df = df.loc[:, ~df.columns.str.contains("^Unnamed")]
    df.columns = [c.strip() for c in df.columns]
    require_columns(df, ML_MODEL_INPUT_COLUMNS, source)
    df = _coerce_types(df)
    df = df.sort_values("date").reset_index(drop=True)
    if df["date"].duplicated().any():
        dupes = df.loc[df["date"].duplicated(), "date"].dt.date.tolist()
        raise ValueError(f"duplicate date(s) in {source}: {dupes}")
    return df


def load_ml_model_input_csv(path: str, sep: str = ",") -> pd.DataFrame:
    df = pd.read_csv(path, sep=sep)
    return _clean(df, path)


def load_ml_model_input_json(path: str) -> pd.DataFrame:
    with open(path) as f:
        payload = json.load(f)
    records = payload if isinstance(payload, list) else payload.get("records", payload)
    df = pd.json_normalize(records)
    return _clean(df, path)


def load_ml_model_input(path: str) -> pd.DataFrame:
    """Dispatches on file extension. Use this from train.py/predict.py so
    swapping the source format later (CSV vs JSON) doesn't touch callers."""
    if path.endswith(".json"):
        return load_ml_model_input_json(path)
    return load_ml_model_input_csv(path)
