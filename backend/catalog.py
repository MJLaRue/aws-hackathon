"""Dataset catalog (design §2.8): catalog.ddb with a `datasets` table; one .ddb per dataset."""

from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path

import duckdb

CREATE_DATASETS_SQL = """
CREATE TABLE IF NOT EXISTS datasets (
    dataset_id   VARCHAR PRIMARY KEY,
    name         VARCHAR NOT NULL,
    created_at   TIMESTAMP NOT NULL,
    row_count    INTEGER,
    db_path      VARCHAR NOT NULL
)
"""


def data_dir() -> Path:
    d = Path(os.environ.get("DUCKDB_DATA_DIR", "/data/dbs"))
    d.mkdir(parents=True, exist_ok=True)
    return d


def dataset_db_path(dataset_id: str) -> Path:
    return data_dir() / f"{dataset_id}.ddb"


def _connect() -> duckdb.DuckDBPyConnection:
    conn = duckdb.connect(str(data_dir() / "catalog.ddb"))
    conn.execute(CREATE_DATASETS_SQL)
    return conn


def register_dataset(dataset_id: str, name: str, row_count: int, db_path: Path) -> None:
    conn = _connect()
    try:
        conn.execute(
            "INSERT INTO datasets VALUES (?, ?, ?, ?, ?)",
            [dataset_id, name, datetime.now(timezone.utc).replace(tzinfo=None), row_count, str(db_path)],
        )
    finally:
        conn.close()


def list_datasets() -> list[dict]:
    conn = _connect()
    try:
        rows = conn.execute(
            "SELECT dataset_id, name, created_at, row_count, db_path FROM datasets ORDER BY created_at DESC"
        ).fetchall()
    finally:
        conn.close()
    return [
        {"dataset_id": r[0], "name": r[1], "created_at": r[2].isoformat(), "row_count": r[3], "db_path": r[4]}
        for r in rows
    ]


def get_dataset(dataset_id: str) -> dict | None:
    return next((d for d in list_datasets() if d["dataset_id"] == dataset_id), None)


def connect_dataset(dataset_id: str, read_only: bool = False) -> duckdb.DuckDBPyConnection:
    """Open the per-dataset DuckDB file; raises KeyError for an unknown dataset_id."""
    ds = get_dataset(dataset_id)
    if ds is None:
        raise KeyError(dataset_id)
    return duckdb.connect(ds["db_path"], read_only=read_only)
