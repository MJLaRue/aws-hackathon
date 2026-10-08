"""Budget Forecasting Analyst — FastAPI application entry point."""

from fastapi import FastAPI

app = FastAPI(title="Budget Forecasting Analyst", version="0.1.0")


@app.get("/health")
def health() -> dict:
    """Liveness probe."""
    return {"status": "ok"}
