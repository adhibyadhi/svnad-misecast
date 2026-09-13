"""Load and join data.txt's `ml_model_input` and `predicted_sales_from_ml`
tables -- delivered as two separate CSV/JSON files, matched by `_id`, not
one merged file.

The real export pads out to a fixed row count by repeating whole days
under fresh `_id`s (e.g. 987 real dates repeated ~10x each to reach exactly
10,000 rows). Those repeats carry no extra information for training, and
would let the same day land in both the train and holdout split, so
`load_training_data` collapses them back to one row per date.
"""

import json

import pandas as pd

from schema import (
    BOOLEAN_COLUMNS,
    ID_COLUMN,
    MENU_SLOTS,
    ML_MODEL_INPUT_REQUIRED_COLUMNS,
    PREDICTED_SALES_REQUIRED_COLUMNS,
    require_columns,
)

NON_NUMERIC_COLUMNS = {"date", ID_COLUMN, *BOOLEAN_COLUMNS, *MENU_SLOTS}


def _sniff_separator(path: str) -> str:
    with open(path) as f:
        header = f.readline()
    return ";" if header.count(";") > header.count(",") else ","


def _read_table(path: str, sep: str | None) -> pd.DataFrame:
    if path.endswith(".json"):
        with open(path) as f:
            payload = json.load(f)
        records = payload if isinstance(payload, list) else payload.get("records", payload)
        return pd.json_normalize(records)
    return pd.read_csv(path, sep=sep or _sniff_separator(path))


def _clean(df: pd.DataFrame) -> pd.DataFrame:
    df = df.dropna(how="all")
    df = df.loc[:, ~df.columns.str.contains("^Unnamed")]
    df.columns = [c.strip() for c in df.columns]
    return df


def _coerce_types(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    for col in BOOLEAN_COLUMNS:
        if col in df.columns and df[col].dtype != bool:
            df[col] = df[col].astype(str).str.strip().str.lower().isin({"true", "1", "yes"})
    numeric_cols = [c for c in df.columns if c not in NON_NUMERIC_COLUMNS]
    for col in numeric_cols:
        df[col] = pd.to_numeric(df[col], errors="coerce")
    return df


def load_ml_model_input(path: str, sep: str | None = None) -> pd.DataFrame:
    df = _clean(_read_table(path, sep))
    require_columns(df, ML_MODEL_INPUT_REQUIRED_COLUMNS, path)
    df["date"] = pd.to_datetime(df["date"])
    return _coerce_types(df)


def load_predicted_sales(path: str, sep: str | None = None) -> pd.DataFrame:
    df = _clean(_read_table(path, sep))
    require_columns(df, PREDICTED_SALES_REQUIRED_COLUMNS, path)
    return _coerce_types(df)


def collapse_duplicate_dates(df: pd.DataFrame) -> pd.DataFrame:
    """Keep one row per date. Raises if same-date rows disagree on any
    value -- that would be a real data inconsistency, not padding, and
    silently picking one would hide it."""
    check_cols = [c for c in df.columns if c != ID_COLUMN]
    conflicting = df.groupby("date")[check_cols].nunique().gt(1).any(axis=1)
    if conflicting.any():
        bad_dates = conflicting[conflicting].index.astype(str).tolist()
        raise ValueError(
            f"{len(bad_dates)} date(s) have repeated rows with conflicting values, "
            f"not just padding -- can't safely collapse: {bad_dates[:5]}"
        )
    return df.drop_duplicates(subset="date", keep="first").sort_values("date").reset_index(drop=True)


def slot_menu_names(features_df: pd.DataFrame) -> dict[str, str]:
    """menu_i holds that slot's real menu name (e.g. "Chicken Teriyaki
    Bowl"), constant across every row -- read it from data rather than
    assuming a naming convention like MENU_1..MENU_15."""
    return {slot: str(features_df[slot].iloc[0]) for slot in MENU_SLOTS}


def load_training_data(features_path: str, targets_path: str, features_sep: str | None = None, targets_sep: str | None = None) -> pd.DataFrame:
    """One row per date, features + target amounts joined, padding collapsed."""
    features = load_ml_model_input(features_path, features_sep)
    targets = load_predicted_sales(targets_path, targets_sep)

    amount_cols = [c for c in targets.columns if c.endswith("_amount")]
    merged = features.merge(targets[[ID_COLUMN, *amount_cols]], on=ID_COLUMN, how="inner", validate="one_to_one")
    if len(merged) != len(features):
        raise ValueError(f"{len(features) - len(merged)} row(s) in {features_path} had no matching _id in {targets_path}")

    return collapse_duplicate_dates(merged)
