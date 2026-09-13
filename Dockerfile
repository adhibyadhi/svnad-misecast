# Serves ml_pipeline's demand model over HTTP (api/main.py) for Cloud Run.
# Not used by backend/ -- that's a separate Node app with its own deploy.

FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY ml_pipeline/ ml_pipeline/
COPY api/ api/

# Train at build time so the image always ships a model that matches the
# committed data/code. Cloud Run containers are stateless -- baking the
# artifact into the image (rather than training at startup, or committing
# a large binary to git) guarantees every instance has a model, the same
# approach used for the Render deploy's build step.
RUN python ml_pipeline/train.py \
    --features ml_pipeline/data/ML_model_input.csv \
    --targets ml_pipeline/data/predicted_sales_from_ml.csv \
    --model-out ml_pipeline/models/demand_model.joblib \
    --metrics-out ml_pipeline/models/metrics.json

ENV PORT=8080
EXPOSE 8080

CMD exec uvicorn api.main:app --host 0.0.0.0 --port ${PORT}
