"""
data_loader.py
==============
Loads Team6Dataset_Enhanced.xlsx from local disk or S3 and returns a
clean pandas DataFrame.  Results are cached in-process so Lambda warm
invocations don't re-read the file on every request.

Environment variables
---------------------
DATA_SOURCE      "local" (default) | "s3"
S3_BUCKET        bucket name when DATA_SOURCE=s3
S3_KEY           object key, default "data/Team6Dataset_Enhanced.xlsx"
LOCAL_DATA_PATH  absolute path when DATA_SOURCE=local (defaults to sibling
                 directory of this file)
"""

import os
import io
import functools
import math
import pandas as pd

# ── configuration ─────────────────────────────────────────────────────────────
DATA_SOURCE     = os.environ.get("DATA_SOURCE",  "local")
S3_BUCKET       = os.environ.get("S3_BUCKET",    "")
S3_KEY          = os.environ.get("S3_KEY",       "data/Team6Dataset_Enhanced.xlsx")
LOCAL_DATA_PATH = os.environ.get(
    "LOCAL_DATA_PATH",
    os.path.join(os.path.dirname(os.path.abspath(__file__)),
                 "..", "Team6Dataset_Enhanced.xlsx")
)
SHEET_NAME = "Budget_Forecast_Data"

# ── module-level cache (survives Lambda warm starts) ─────────────────────────
_cache: dict = {}


def _load_from_s3() -> pd.DataFrame:
    import boto3
    s3 = boto3.client("s3")
    obj = s3.get_object(Bucket=S3_BUCKET, Key=S3_KEY)
    buf = io.BytesIO(obj["Body"].read())
    return pd.read_excel(buf, sheet_name=SHEET_NAME, engine="openpyxl")


def _load_from_local() -> pd.DataFrame:
    path = os.path.abspath(LOCAL_DATA_PATH)
    if not os.path.exists(path):
        raise FileNotFoundError(f"Dataset not found at: {path}")
    return pd.read_excel(path, sheet_name=SHEET_NAME, engine="openpyxl")


def _clean(df: pd.DataFrame) -> pd.DataFrame:
    """Normalise column names and types after loading."""
    df.columns = [c.strip() for c in df.columns]

    # Boolean flags
    for col in ("is_synthetic", "include_in_totals"):
        if col in df.columns:
            df[col] = df[col].fillna(False).astype(bool)
        else:
            df[col] = False

    # Dates
    if "month" in df.columns:
        df["month"] = pd.to_datetime(df["month"], errors="coerce")

    # Numerics
    float_cols = [
        "budgeted_amount_usd", "actual_spend_usd", "forecasted_amount_usd",
        "variance_usd", "variance_pct", "prior_year_spend_usd",
        "yoy_change_pct", "forecast_accuracy_pct", "days_to_produce_report",
    ]
    int_cols = [
        "anomaly_detected", "num_spreadsheet_versions",
        "manual_adjustments_count", "data_entry_errors",
        "approval_cycles", "stakeholders_involved", "confidence_score_1to5",
    ]
    for c in float_cols:
        if c in df.columns:
            df[c] = pd.to_numeric(df[c], errors="coerce")
    for c in int_cols:
        if c in df.columns:
            df[c] = pd.to_numeric(df[c], errors="coerce")

    return df


def get_dataframe(force_reload: bool = False) -> pd.DataFrame:
    """
    Return the cleaned DataFrame, loading from source if not cached.
    Pass force_reload=True to bypass the cache (e.g. after an S3 upload).
    """
    if not force_reload and "df" in _cache:
        return _cache["df"]

    if DATA_SOURCE == "s3":
        raw = _load_from_s3()
    else:
        raw = _load_from_local()

    df = _clean(raw)
    _cache["df"] = df
    return df


def get_totals_df(force_reload: bool = False) -> pd.DataFrame:
    """
    Convenience: return only rows where include_in_totals is True.
    Use this for all financial aggregations to avoid double-counting.
    """
    return get_dataframe(force_reload)[
        get_dataframe(force_reload)["include_in_totals"] == True
    ].copy()
