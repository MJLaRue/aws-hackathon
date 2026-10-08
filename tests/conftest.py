import os
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
FIX = ROOT / "tests" / "fixtures"
os.environ.setdefault("SAMPLE_DATA_DIR", str(ROOT / "data"))


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("DUCKDB_DATA_DIR", str(tmp_path / "dbs"))
    return tmp_path / "dbs"


@pytest.fixture
def tmp_duckdb(tmp_path):
    return str(tmp_path / "t.ddb")


@pytest.fixture
def client(data_dir):
    from fastapi.testclient import TestClient
    from main import app
    return TestClient(app)


@pytest.fixture(scope="session")
def fixture_xlsx():
    return FIX / "test_dataset.xlsx"


@pytest.fixture(scope="session")
def original_schema_xlsx():
    return FIX / "test_dataset_original_schema.xlsx"


def _load(path, tmp_path_factory):
    import duckdb
    import pandas as pd
    from ingestion.pipeline import run_ingestion_pipeline
    db = str(tmp_path_factory.mktemp("ds") / "d.ddb")
    run_ingestion_pipeline(pd.read_excel(path), db=db)
    conn = duckdb.connect(db, read_only=True)
    try:
        return conn.execute("SELECT * FROM budget_totals").df()
    finally:
        conn.close()


@pytest.fixture(scope="session")
def full_df(tmp_path_factory):
    """Original 300-row file via the ingestion pipeline (rows in budget_totals)."""
    return _load(ROOT / "data" / "Team6Dataset.xlsx", tmp_path_factory)


@pytest.fixture(scope="session")
def enhanced_df(tmp_path_factory):
    """Enhanced file via the ingestion pipeline, include_in_totals rows only."""
    return _load(ROOT / "data" / "Team6Dataset_Enhanced 1.xlsx", tmp_path_factory)


# ------------------------------------------------------------------ fake Bedrock + SSE helpers
import json as _json


class FakeClientError(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.response = {"Error": {"Code": code, "Message": code}}


def text_events(text, stop="end_turn", idx=0):
    third = max(1, len(text) // 3)
    parts = [text[i:i + third] for i in range(0, len(text), third)]
    return ([{"contentBlockDelta": {"contentBlockIndex": idx, "delta": {"text": p}}} for p in parts]
            + [{"contentBlockStop": {"contentBlockIndex": idx}}, {"messageStop": {"stopReason": stop}}])


def tool_events(name, tool_input, tool_id="tu-1", idx=0, lead_text=None):
    ev = []
    if lead_text:
        ev += [{"contentBlockDelta": {"contentBlockIndex": idx, "delta": {"text": lead_text}}}, {"contentBlockStop": {"contentBlockIndex": idx}}]
        idx += 1
    raw = _json.dumps(tool_input)
    ev += [{"contentBlockStart": {"contentBlockIndex": idx, "start": {"toolUse": {"toolUseId": tool_id, "name": name}}}},
           {"contentBlockDelta": {"contentBlockIndex": idx, "delta": {"toolUse": {"input": raw[:5]}}}},
           {"contentBlockDelta": {"contentBlockIndex": idx, "delta": {"toolUse": {"input": raw[5:]}}}},
           {"contentBlockStop": {"contentBlockIndex": idx}}, {"messageStop": {"stopReason": "tool_use"}}]
    return ev


class FakeBedrock:
    """Scripted bedrock-runtime client. script items: list of stream events, or an Exception instance to raise."""

    def __init__(self, script):
        self.script, self.calls = list(script), []

    def converse_stream(self, **kwargs):
        self.calls.append(kwargs)
        item = self.script.pop(0)
        if isinstance(item, Exception):
            raise item
        return {"stream": iter(item)}


def parse_sse(body: str) -> list:
    out = []
    for block in body.split("\n\n"):
        block = block.strip()
        if block.startswith("data: "):
            payload = block[6:]
            out.append("[DONE]" if payload == "[DONE]" else _json.loads(payload))
    return out


def types(events):
    return [e if isinstance(e, str) else e["type"] for e in events]


@pytest.fixture
def sample_dataset(client):
    return client.post("/upload/sample", params={"variant": "enhanced"}).json()["dataset_id"]
