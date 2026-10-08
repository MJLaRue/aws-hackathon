"""Budget Forecasting Analyst — FastAPI application entry point."""

from __future__ import annotations

import os
import uuid
from pathlib import Path

import pandas as pd
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import catalog
from agent.loop import run_agent_loop
from forecasting.forecast import RunForecastRequest, RunForecastResponse, run_forecast
from replay.loader import replay_active
from analysis.kpis import KpiResponse, get_kpis
from analysis.dashboard import BenchmarkResponse, anomalies_view, get_benchmark, get_outlook, variance_view
from tools.dispatcher import ToolError
from ingestion.pipeline import (
    ColumnMappingProposal,
    ColumnMappingRequest,
    ValidationReport,
    apply_mapping,
    build_mapping_proposal,
    detect_and_parse,
    load_to_duckdb,
    suggest_column_mapping,
    validate_mapping,
)

app = FastAPI(title="Budget Forecasting Analyst", version="0.1.0")

_origins = {"http://localhost:3000", "http://127.0.0.1:3000"}
if os.environ.get("VITE_API_BASE_URL"):
    _origins.add(os.environ["VITE_API_BASE_URL"].rstrip("/"))
if os.environ.get("CORS_ORIGINS"):
    _origins.update(o.strip() for o in os.environ["CORS_ORIGINS"].split(",") if o.strip())
app.add_middleware(CORSMiddleware, allow_origins=sorted(_origins), allow_methods=["*"], allow_headers=["*"])

SAMPLE_FILES = {"enhanced": "Team6Dataset_Enhanced 1.xlsx", "original": "Team6Dataset.xlsx"}


class UploadProposal(ColumnMappingProposal):
    upload_id: str


class ConfirmRequest(ColumnMappingRequest):
    upload_id: str


class UploadResult(BaseModel):
    dataset_id: str
    dataset_name: str
    report: ValidationReport


def _sample_dir() -> Path:
    env = os.environ.get("SAMPLE_DATA_DIR")
    if env:
        return Path(env)
    for p in (Path(__file__).resolve().parent / "data", Path(__file__).resolve().parent.parent / "data"):
        if p.is_dir():
            return p
    return Path("/app/data")


def _staging(upload_id: str) -> Path:
    try:
        upload_id = str(uuid.UUID(upload_id))  # rejects path-traversal / arbitrary strings
    except ValueError:
        raise HTTPException(status_code=404, detail="Unknown or expired upload_id")
    d = catalog.data_dir() / "staging"
    d.mkdir(parents=True, exist_ok=True)
    return d / f"{upload_id}.csv"


def _finalize(df: pd.DataFrame, mapping: dict[str, str | None], dataset_name: str) -> UploadResult:
    missing = validate_mapping(mapping)
    if missing:
        raise HTTPException(status_code=422, detail={"error": "missing_required_fields", "missing": missing})
    clean, rejected = apply_mapping(df, mapping)
    dataset_id = str(uuid.uuid4())
    db_path = catalog.dataset_db_path(dataset_id)
    try:
        report = load_to_duckdb(clean, dataset_id, db_path, total_rows=len(df), rows_rejected=rejected)
    except Exception:
        db_path.unlink(missing_ok=True)
        raise
    catalog.register_dataset(dataset_id, dataset_name, report.rows_accepted, db_path)
    return UploadResult(dataset_id=dataset_id, dataset_name=dataset_name, report=report)


@app.get("/health")
def health() -> dict:
    """Liveness probe."""
    return {"status": "ok"}


@app.post("/upload", response_model=UploadProposal)
async def upload(file: UploadFile = File(...), dataset_name: str = Form(..., max_length=128)) -> UploadProposal:
    """Parse the file, stage it, and return a column-mapping proposal (§2.1-§2.3)."""
    if not dataset_name.strip():
        raise HTTPException(status_code=422, detail="dataset_name is required")
    df = detect_and_parse(await file.read(), file.filename or "")
    upload_id = str(uuid.uuid4())
    df.to_csv(_staging(upload_id), index=False)
    proposal = build_mapping_proposal(dataset_name.strip(), df)
    return UploadProposal(**proposal.model_dump(), upload_id=upload_id)


@app.post("/upload/confirm", response_model=UploadResult)
def upload_confirm(req: ConfirmRequest) -> UploadResult:
    """Apply the user-confirmed mapping, load DuckDB, return the ValidationReport."""
    staged = _staging(req.upload_id)
    if not staged.exists():
        raise HTTPException(status_code=404, detail="Unknown or expired upload_id")
    df = pd.read_csv(staged, dtype=str, keep_default_na=False, na_values=[""])
    result = _finalize(df, dict(req.mapping), req.dataset_name)
    staged.unlink(missing_ok=True)
    return result


@app.post("/upload/sample", response_model=UploadResult)
def upload_sample(variant: str = "enhanced") -> UploadResult:
    """Load a bundled sample file with the canonical mapping auto-confirmed (§2.7, Rev 5 §0.1)."""
    if variant not in SAMPLE_FILES:
        raise HTTPException(status_code=422, detail=f"variant must be one of {sorted(SAMPLE_FILES)}")
    path = _sample_dir() / SAMPLE_FILES[variant]
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Sample file not found: {path.name}")
    df = pd.read_excel(path, engine="openpyxl")
    mapping = suggest_column_mapping([str(c) for c in df.columns])
    return _finalize(df, mapping, f"Sample data ({variant})")


@app.get("/datasets")
def datasets() -> list[dict]:
    return [{k: v for k, v in d.items() if k != "db_path"} for d in catalog.list_datasets()]


@app.get("/kpis", response_model=KpiResponse)
def kpis(dataset_id: str, fiscal_year: str | None = None) -> KpiResponse:
    """Dashboard KPI panel (§3.7); always queries budget_totals live."""
    try:
        conn = catalog.connect_dataset(dataset_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Unknown dataset_id")
    try:
        return get_kpis(conn, dataset_id, fiscal_year)
    finally:
        conn.close()


class ChatRequest(BaseModel):
    session_id: str
    dataset_id: str
    message: str
    replay_mode: bool = False


SESSIONS: dict[str, list[dict]] = {}   # session_id -> compact conversation history (R5-06)


def _view(dataset_id: str, fn, *args, **kw):
    try:
        conn = catalog.connect_dataset(dataset_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Unknown dataset_id")
    try:
        return fn(conn, dataset_id, *args, **kw)
    except ToolError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    finally:
        conn.close()


@app.get("/anomalies")
def anomalies(dataset_id: str, entity_level: str = "total", entity_name: str | None = None,
              sensitivity: float = 2.5) -> dict:
    """Dashboard anomaly table; same dispatcher as the detect_anomalies chat tool."""
    return _view(dataset_id, anomalies_view, entity_level, entity_name, sensitivity)


@app.get("/variance")
def variance(dataset_id: str, entity_level: str = "total", entity_name: str | None = None, grain: str = "quarter") -> dict:
    """Dashboard trend data; same dispatcher as the explain_variance chat tool."""
    return _view(dataset_id, variance_view, entity_level, entity_name, grain)


@app.get("/entities")
def entities(dataset_id: str) -> dict:
    """Dimension values for dashboard selectors (same payload as the list_entities chat tool)."""
    from tools.dispatcher import dispatch_tool
    return _view(dataset_id, lambda conn, ds: dispatch_tool("list_entities", {}, conn, ds))


@app.get("/outlook")
def outlook(dataset_id: str) -> list[dict]:
    """FY2027 projected spend vs the FY2026 budget for the total and every department, category and fund source."""
    return [r.model_dump() for r in _view(dataset_id, get_outlook)]


@app.get("/benchmark", response_model=BenchmarkResponse)
def benchmark(dataset_id: str) -> BenchmarkResponse:
    return _view(dataset_id, get_benchmark)


@app.post("/chat")
async def chat(req: ChatRequest) -> StreamingResponse:
    """SSE chat endpoint (§8.1). Replay mode bypasses the agent loop and never creates a Bedrock client."""
    history = SESSIONS.setdefault(req.session_id, [])
    stream = run_agent_loop(req.session_id, req.dataset_id, req.message, history,
                            replay_mode=req.replay_mode or replay_active())
    return StreamingResponse(stream, media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.post("/forecast", response_model=RunForecastResponse)
def forecast(req: RunForecastRequest) -> RunForecastResponse:
    """Compute (or return the cached) forecast for one entity; used to pre-compute series on demand."""
    try:
        conn = catalog.connect_dataset(req.dataset_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Unknown dataset_id")
    try:
        return run_forecast(conn, req.dataset_id, req.entity_level, req.entity_name, req.horizon,
                            req.planned_budget_total, req.force_recompute, req.grain)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    finally:
        conn.close()
