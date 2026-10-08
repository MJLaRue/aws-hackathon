"""Anomaly and persistent-pattern detection (design §3.2, §3.4, §3.5; Rev 5 §0.5).

Rev 5 hybrid rule: a row is flagged when |modified z| > sensitivity (category peer group,
department fallback when MAD = 0) OR |variance_pct| >= abs_floor.
Source anomaly columns are carried for lineage only and never used for detection.
"""

from __future__ import annotations

import os

import numpy as np
import pandas as pd

DEFAULT_SENSITIVITY = float(os.environ.get("ANOMALY_SENSITIVITY", "2.5"))
DEFAULT_ABS_FLOOR = float(os.environ.get("ANOMALY_ABS_FLOOR", "30.0"))
Z_SCALE = 0.6745

OUTPUT_COLUMNS = [
    "record_id", "source_record_id", "department", "category", "fiscal_year", "fiscal_quarter",
    "period_index", "actual", "budget", "variance_pct", "is_synthetic", "peer_group", "peer_median",
    "peer_mad", "z_score", "detector_reason", "severity", "source_anomaly_flag", "source_anomaly_type",
]


def _severity(z: float, v: float) -> str:
    if abs(z) > 4 or abs(v) >= 45:
        return "high"
    if abs(z) > 3 or abs(v) >= 30:
        return "medium"
    return "low"


def _z_table(df: pd.DataFrame) -> pd.DataFrame:
    """Per-row peer_group, peer_median, peer_mad and z (NaN z when no peer spread exists)."""
    out = pd.DataFrame(index=df.index, columns=["peer_group", "peer_median", "peer_mad", "z_score"], dtype=object)
    out["peer_group"] = "category"
    out["z_score"] = 0.0
    for _, grp in df.groupby("category"):
        med = grp["variance_pct"].median()
        mad = (grp["variance_pct"] - med).abs().median()
        if mad > 0:
            out.loc[grp.index, "peer_median"] = med
            out.loc[grp.index, "peer_mad"] = mad
            out.loc[grp.index, "z_score"] = Z_SCALE * (grp["variance_pct"] - med) / mad
            continue
        for _, sub in grp.groupby("department"):  # fallback: department peers
            smed = sub["variance_pct"].median()
            smad = (sub["variance_pct"] - smed).abs().median()
            out.loc[sub.index, "peer_group"] = "department"
            out.loc[sub.index, "peer_median"] = smed
            out.loc[sub.index, "peer_mad"] = smad
            if smad > 0:
                out.loc[sub.index, "z_score"] = Z_SCALE * (sub["variance_pct"] - smed) / smad
    out["peer_median"] = pd.to_numeric(out["peer_median"]).fillna(0.0)
    out["peer_mad"] = pd.to_numeric(out["peer_mad"]).fillna(0.0)
    out["z_score"] = pd.to_numeric(out["z_score"]).fillna(0.0)
    return out


def detect_anomalies(df: pd.DataFrame, sensitivity: float = DEFAULT_SENSITIVITY,
                     abs_floor: float | None = DEFAULT_ABS_FLOOR) -> pd.DataFrame:
    """Return the flagged rows of ``df`` (canonical columns) with detector metadata.

    ``df`` should already be restricted to include_in_totals rows (read from budget_totals).
    Pass ``abs_floor=None`` for the pure Rev 4 z-score rule.
    """
    work = df.dropna(subset=["variance_pct"]).copy()
    if "is_synthetic" not in work.columns:
        work["is_synthetic"] = False
    if "source_record_id" not in work.columns:
        work["source_record_id"] = work["record_id"]
    z = _z_table(work)
    work = work.join(z)
    by_z = work["z_score"].abs() > sensitivity
    by_floor = (work["variance_pct"].abs() >= abs_floor) if abs_floor is not None else pd.Series(False, index=work.index)
    flagged = work[by_z | by_floor].copy()
    flagged["detector_reason"] = np.where(by_z[flagged.index] & by_floor[flagged.index], "both",
                                          np.where(by_z[flagged.index], "zscore", "abs_floor"))
    flagged["severity"] = [_severity(zv, v) for zv, v in zip(flagged["z_score"], flagged["variance_pct"])]
    for col in OUTPUT_COLUMNS:
        if col not in flagged.columns:
            flagged[col] = None
    return flagged[OUTPUT_COLUMNS].reset_index(drop=True)


def detect_persistent_patterns(df: pd.DataFrame, threshold: float = 5.0) -> list[dict]:
    """Entities with same-sign aggregate variance beyond ±threshold in >= 2 of the fiscal years (§3.5)."""
    patterns: list[dict] = []
    for entity_col in ("category", "department"):
        sums = df.groupby([entity_col, "fiscal_year"])[["actual", "budget"]].sum()
        sums["variance_pct_agg"] = (sums["actual"] / sums["budget"] - 1) * 100
        for entity, grp in sums.reset_index().groupby(entity_col):
            yr_map = dict(zip(grp["fiscal_year"], grp["variance_pct_agg"]))
            for direction, years in (
                ("over", [y for y, v in yr_map.items() if v >= threshold]),
                ("under", [y for y, v in yr_map.items() if v <= -threshold]),
            ):
                if len(years) >= 2:
                    patterns.append({
                        "entity_type": entity_col, "entity_name": entity, "direction": direction,
                        "qualifying_years": sorted(years), "per_year_variance": yr_map,
                    })
    return patterns


def compute_confusion_matrix(flagged_ids: set[str], full_df: pd.DataFrame) -> dict[str, int]:
    """Detector-vs-source-flag matrix (§3.4). Keys: tp, fp (source only), fn (detector only), tn."""
    det = full_df["record_id"].isin(flagged_ids)
    src = full_df["source_anomaly_flag"].fillna(0).astype(int) == 1
    return {
        "tp": int((det & src).sum()),
        "fp": int((~det & src).sum()),
        "fn": int((det & ~src).sum()),
        "tn": int((~det & ~src).sum()),
    }


# ---------------------------------------------------------------------------
# Persistence of detector runs (design §3.2 tables, §3.7 KPI counts)
# ---------------------------------------------------------------------------
import uuid  # noqa: E402
from datetime import datetime, timezone  # noqa: E402

_RESULTS_DDL = """
CREATE TABLE IF NOT EXISTS anomaly_results (
    run_id VARCHAR NOT NULL, dataset_id VARCHAR NOT NULL, record_id VARCHAR NOT NULL,
    detector_flag INTEGER NOT NULL, z_score DOUBLE, peer_group VARCHAR,
    sensitivity DOUBLE NOT NULL, computed_at TIMESTAMP NOT NULL
)"""
_SUMMARY_DDL = """
CREATE TABLE IF NOT EXISTS anomaly_run_summary (
    run_id VARCHAR PRIMARY KEY, dataset_id VARCHAR NOT NULL, sensitivity DOUBLE NOT NULL,
    tp INTEGER, fp INTEGER, fn INTEGER, tn INTEGER, computed_at TIMESTAMP NOT NULL
)"""


def run_and_store(conn, dataset_id: str, sensitivity: float = DEFAULT_SENSITIVITY,
                  abs_floor: float | None = DEFAULT_ABS_FLOOR) -> dict:
    """Run the detector over budget_totals, persist flagged rows + confusion matrix, return the summary."""
    conn.execute(_RESULTS_DDL)
    conn.execute(_SUMMARY_DDL)
    df = conn.execute("SELECT * FROM budget_totals").df()
    flagged = detect_anomalies(df, sensitivity, abs_floor)
    cm = compute_confusion_matrix(set(flagged["record_id"]), df)
    run_id, now = str(uuid.uuid4()), datetime.now(timezone.utc).replace(tzinfo=None)
    rows = [(run_id, dataset_id, r.record_id, 1, float(r.z_score), r.peer_group, sensitivity, now)
            for r in flagged.itertuples()]
    if rows:
        conn.executemany("INSERT INTO anomaly_results VALUES (?,?,?,?,?,?,?,?)", rows)
    conn.execute("INSERT INTO anomaly_run_summary VALUES (?,?,?,?,?,?,?,?)",
                 [run_id, dataset_id, sensitivity, cm["tp"], cm["fp"], cm["fn"], cm["tn"], now])
    return {"run_id": run_id, "anomaly_count": len(flagged), **cm}


def latest_run_summary(conn, dataset_id: str) -> dict | None:
    conn.execute(_SUMMARY_DDL)
    r = conn.execute("SELECT run_id, tp, fp, fn, tn FROM anomaly_run_summary WHERE dataset_id = ? "
                     "ORDER BY computed_at DESC LIMIT 1", [dataset_id]).fetchone()
    if not r:
        return None
    n = conn.execute("SELECT COUNT(*) FROM anomaly_results WHERE run_id = ? AND detector_flag = 1", [r[0]]).fetchone()[0]
    return {"run_id": r[0], "tp": r[1], "fp": r[2], "fn": r[3], "tn": r[4], "anomaly_count": int(n)}
