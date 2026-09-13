"""MiseCast demand API -- the "local adapter" the Node backend calls into
for predictions, per the project's model-integration plan: the model runs
in its own Python runtime rather than being rewritten in JS.

Deliberately has no MongoDB access. Node owns assembling the feature row
from the database; this service only runs the model. That keeps this half
of the system testable and deployable on its own, independent of the
Node/Mongo side (see /predict/demo, which works with zero other services
running, using the data shipped in ml_pipeline/data/).
"""

import json
import sys
from contextlib import asynccontextmanager
from pathlib import Path

import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, create_model

ML_PIPELINE_DIR = Path(__file__).resolve().parent.parent / "ml_pipeline"
sys.path.insert(0, str(ML_PIPELINE_DIR))

import schema as s  # noqa: E402
from data_loader import load_ml_model_input  # noqa: E402
from model import DemandModel  # noqa: E402
from predict import predict_for_row  # noqa: E402
from retrain import retrain as run_retrain  # noqa: E402

DATA_DIR = ML_PIPELINE_DIR / "data"
MODELS_DIR = ML_PIPELINE_DIR / "models"
DEFAULT_FEATURES_PATH = DATA_DIR / "ML_model_input.csv"
DEFAULT_TARGETS_PATH = DATA_DIR / "predicted_sales_from_ml.csv"

# Mirrors schema.ML_MODEL_INPUT_COLUMNS exactly, so the request body is
# always in sync with what the model was actually trained on.
_field_types = {"date": (str, ...)}
for _slot in s.MENU_SLOTS:
    _field_types[_slot] = (str, ...)
    _field_types[f"{_slot}_price_after_discount"] = (float, ...)
_field_types["total_reservation"] = (int, ...)
_field_types["avg_temp"] = (float, ...)
_field_types["rain"] = (bool, ...)
_field_types["public_holiday"] = (bool, ...)
_field_types["num_of_event"] = (int, ...)

PredictRequest = create_model("PredictRequest", **_field_types)


class PredictResponse(BaseModel):
    date: str
    predictions: dict[str, int]
    model_trained_at: str | None = None


class RetrainResponse(BaseModel):
    promoted: bool
    overall_mae: float
    previous_overall_mae: float | None
    regression_pct: float


state: dict = {"model": None, "metrics": None, "demo_features": None}


def _latest_model_path() -> Path:
    latest = MODELS_DIR / "latest.joblib"
    return latest if latest.exists() else MODELS_DIR / "demand_model.joblib"


def _load_model_and_metrics() -> None:
    model_path = _latest_model_path()
    if not model_path.exists():
        state["model"], state["metrics"] = None, None
        return
    state["model"] = DemandModel.load(str(model_path))
    metrics_path = MODELS_DIR / ("latest_metrics.json" if model_path.name == "latest.joblib" else "metrics.json")
    state["metrics"] = json.loads(metrics_path.read_text()) if metrics_path.exists() else None


@asynccontextmanager
async def lifespan(app: FastAPI):
    _load_model_and_metrics()
    if DEFAULT_FEATURES_PATH.exists():
        state["demo_features"] = load_ml_model_input(str(DEFAULT_FEATURES_PATH))
    yield


app = FastAPI(title="MiseCast Demand API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten to the dashboard's real origin once it has one
    allow_methods=["*"],
    allow_headers=["*"],
)


def _require_model() -> DemandModel:
    if state["model"] is None:
        raise HTTPException(503, "no trained model available -- run POST /retrain, or ship ml_pipeline/models/demand_model.joblib")
    return state["model"]


@app.get("/")
def root():
    return {"service": "misecast-demand-api", "docs": "/docs"}


@app.get("/health")
def health():
    return {"status": "ok", "model_loaded": state["model"] is not None}


@app.get("/model/status")
def model_status():
    if state["metrics"] is None:
        raise HTTPException(404, "no model trained yet")
    return state["metrics"]


@app.post("/predict", response_model=PredictResponse)
def predict(payload: PredictRequest):
    """Production contract: the caller assembles one ml_model_input row
    for a date (from Mongo, or wherever) and gets amounts back."""
    model = _require_model()
    row = pd.Series(payload.model_dump())
    row["date"] = pd.Timestamp(row["date"])
    try:
        predictions = predict_for_row(model, row)
    except Exception as e:
        raise HTTPException(422, f"couldn't predict from payload: {e}")
    return PredictResponse(
        date=str(row["date"].date()),
        predictions=predictions,
        model_trained_at=(state["metrics"] or {}).get("trained_at"),
    )


@app.get("/predict/demo", response_model=PredictResponse)
def predict_demo(target_date: str):
    """Testing/demo path: looks the date up in the data shipped with this
    repo instead of requiring a caller-built payload. Works standalone --
    no Node, no Mongo."""
    model = _require_model()
    demo = state["demo_features"]
    if demo is None:
        raise HTTPException(503, f"no local demo data at {DEFAULT_FEATURES_PATH}")
    ts = pd.Timestamp(target_date)
    match = demo[demo["date"] == ts]
    if match.empty:
        raise HTTPException(
            404,
            f"{target_date} isn't in the demo dataset "
            f"(covers {demo['date'].min().date()} to {demo['date'].max().date()})",
        )
    predictions = predict_for_row(model, match.iloc[0])
    return PredictResponse(
        date=target_date,
        predictions=predictions,
        model_trained_at=(state["metrics"] or {}).get("trained_at"),
    )


@app.post("/retrain", response_model=RetrainResponse)
def retrain_endpoint():
    """Retrains against the data shipped in ml_pipeline/data/, and only
    promotes the new model if accuracy hasn't regressed (see retrain.py).
    Reloads this service's in-memory model afterward either way."""
    result = run_retrain(str(DEFAULT_FEATURES_PATH), str(DEFAULT_TARGETS_PATH))
    _load_model_and_metrics()
    return RetrainResponse(**{k: result[k] for k in ("promoted", "overall_mae", "previous_overall_mae", "regression_pct")})
