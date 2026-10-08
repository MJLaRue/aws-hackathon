"""
forecasting.py
==============
Monthly expenditure forecasting for the 10 series with complete 36-month history.

Design
------
- Training window : Jul 2023 – Dec 2025  (30 months per series)
- Validation      : Jan 2026 – Jun 2026   (6 months, final holdout)
- Forecast horizon: Jul 2026 – Dec 2026   (6 months forward)

Two models are compared per series and overall:
  1. Seasonal-naive baseline  — use the actual from the same month one year ago.
  2. Pooled Gradient Boosting — one GradientBoostingRegressor trained across
     all 10 series simultaneously.  Features are purely look-back and
     calendar-derived; no target-period information is used.

Features (no leakage)
---------------------
  month_of_year      (1-12)
  month_sin / _cos   (cyclic encoding)
  fy_num             (0=FY2024, 1=FY2025, 2=FY2026)
  lag_1              actual spend 1 month ago
  lag_3              actual spend 3 months ago
  lag_12             actual spend 12 months ago  (same-month prior year)
  roll_3_mean        3-month rolling mean ending at t-1
  roll_6_mean        6-month rolling mean ending at t-1
  dept_enc           label-encoded department (integer)
  cat_enc            label-encoded category   (integer)

Metrics
-------
  MAE  = mean absolute error
  WAPE = sum(|actual - predicted|) / sum(actual)  × 100

Artifacts saved to ../artifacts/
  forecast_results.json    — all point forecasts + actuals
  model_metrics.json       — MAE / WAPE comparison
  gb_model.joblib          — serialised GradientBoostingRegressor
  label_encoders.joblib    — dept / cat encoders
"""

import os
import json
import math
import warnings
import numpy as np
import pandas as pd
import joblib

from sklearn.ensemble import GradientBoostingRegressor
from sklearn.metrics  import mean_absolute_error
from sklearn.preprocessing import LabelEncoder

warnings.filterwarnings("ignore")

# ── paths ─────────────────────────────────────────────────────────────────────
BACKEND_DIR   = os.path.dirname(os.path.abspath(__file__))
ARTIFACTS_DIR = os.path.join(BACKEND_DIR, "..", "artifacts")
os.makedirs(ARTIFACTS_DIR, exist_ok=True)

FORECAST_RESULTS_PATH = os.path.join(ARTIFACTS_DIR, "forecast_results.json")
MODEL_METRICS_PATH    = os.path.join(ARTIFACTS_DIR, "model_metrics.json")
GB_MODEL_PATH         = os.path.join(ARTIFACTS_DIR, "gb_model.joblib")
ENCODERS_PATH         = os.path.join(ARTIFACTS_DIR, "label_encoders.joblib")

# ── the 10 forecasting series (must match enhance_dataset.py FORECAST_SERIES) ─
FORECAST_SERIES = [
    ("College of Pharmacy",       "Personnel & Salaries"),
    ("University Library",        "Administrative Costs"),
    ("College of Architecture",   "Research Operations"),
    ("IT Services",               "Technology & Equipment"),
    ("Student Affairs",           "Student Scholarships"),
    ("Facilities Management",     "Maintenance & Repairs"),
    ("College of Business",       "Consulting & Contracts"),
    ("Research Institute",        "Research Operations"),
    ("College of Engineering",    "Personnel & Salaries"),
    ("Finance & Administration",  "Administrative Costs"),
]

# ── chronological split boundaries ────────────────────────────────────────────
TRAIN_END      = pd.Timestamp("2025-12-01")   # inclusive
VALIDATION_START = pd.Timestamp("2026-01-01")
VALIDATION_END   = pd.Timestamp("2026-06-01")   # inclusive
FORECAST_START   = pd.Timestamp("2026-07-01")
FORECAST_END     = pd.Timestamp("2027-06-01")   # inclusive

FORECAST_MONTHS = pd.date_range(FORECAST_START, FORECAST_END, freq="MS")

# ── FY label helper ───────────────────────────────────────────────────────────
def _fy_num(ts: pd.Timestamp) -> int:
    """0=FY2024, 1=FY2025, 2=FY2026, 3=FY2027"""
    fy = ts.year + 1 if ts.month >= 7 else ts.year
    return max(0, fy - 2024)


# ─────────────────────────────────────────────────────────────────────────────
# FEATURE ENGINEERING
# ─────────────────────────────────────────────────────────────────────────────

def build_features(series_df: pd.DataFrame,
                   dept_enc: LabelEncoder,
                   cat_enc:  LabelEncoder) -> pd.DataFrame:
    """
    Build feature matrix for one or more series rows.
    series_df must have: month, department, budget_category, actual_spend_usd.
    All lag / rolling features are derived from past actuals — no leakage.
    """
    df = series_df.sort_values("month").copy()
    df = df.reset_index(drop=True)

    # Calendar features
    df["month_of_year"] = df["month"].dt.month
    df["month_sin"]     = np.sin(2 * np.pi * df["month_of_year"] / 12)
    df["month_cos"]     = np.cos(2 * np.pi * df["month_of_year"] / 12)
    df["fy_num"]        = df["month"].apply(_fy_num)

    # Entity encoding (fit externally, apply here)
    df["dept_enc"] = dept_enc.transform(df["department"])
    df["cat_enc"]  = cat_enc.transform(df["budget_category"])

    # Lag features (shift so we only see past values)
    df["lag_1"]  = df["actual_spend_usd"].shift(1)
    df["lag_3"]  = df["actual_spend_usd"].shift(3)
    df["lag_12"] = df["actual_spend_usd"].shift(12)

    # Rolling means on past values (min_periods avoids NaN when < window rows available)
    df["roll_3_mean"] = (
        df["actual_spend_usd"].shift(1).rolling(3,  min_periods=1).mean()
    )
    df["roll_6_mean"] = (
        df["actual_spend_usd"].shift(1).rolling(6,  min_periods=1).mean()
    )

    return df


FEATURE_COLS = [
    "month_of_year", "month_sin", "month_cos", "fy_num",
    "dept_enc", "cat_enc",
    "lag_1", "lag_3", "lag_12",
    "roll_3_mean", "roll_6_mean",
]


# ─────────────────────────────────────────────────────────────────────────────
# SEASONAL-NAIVE BASELINE
# ─────────────────────────────────────────────────────────────────────────────

def naive_forecast(train_df: pd.DataFrame,
                   target_months: pd.DatetimeIndex) -> pd.Series:
    """
    For each target month, return the actual from the same month one year prior.
    train_df must have month (Timestamp) and actual_spend_usd.
    Returns a Series indexed by target_months.
    """
    lookup = train_df.set_index("month")["actual_spend_usd"].to_dict()
    preds = []
    for ts in target_months:
        prior = ts - pd.DateOffset(years=1)
        # Step back month by month until we find a value (handles gaps)
        val = lookup.get(prior)
        if val is None:
            # Try two years back as fallback
            val = lookup.get(prior - pd.DateOffset(years=1))
        preds.append(val if val is not None else np.nan)
    return pd.Series(preds, index=target_months)


# ─────────────────────────────────────────────────────────────────────────────
# METRICS
# ─────────────────────────────────────────────────────────────────────────────

def _wape(actual: np.ndarray, predicted: np.ndarray) -> float:
    """Weighted Absolute Percentage Error (%)."""
    mask = ~(np.isnan(actual) | np.isnan(predicted))
    a, p = actual[mask], predicted[mask]
    if a.sum() == 0:
        return float("nan")
    return round(float(np.abs(a - p).sum() / np.abs(a).sum() * 100), 2)


def _mae(actual: np.ndarray, predicted: np.ndarray) -> float:
    mask = ~(np.isnan(actual) | np.isnan(predicted))
    a, p = actual[mask], predicted[mask]
    if len(a) == 0:
        return float("nan")
    return round(float(mean_absolute_error(a, p)), 2)


# ─────────────────────────────────────────────────────────────────────────────
# MAIN TRAINING + FORECASTING ROUTINE
# ─────────────────────────────────────────────────────────────────────────────

def run_forecasting(totals_df: pd.DataFrame) -> dict:
    """
    Main entry point.  Accepts the include_in_totals=True DataFrame.

    1. Extracts 10 series, filters to ≤ VALIDATION_END (no future actuals).
    2. Fits label encoders across all series.
    3. Builds features for all training rows.
    4. Trains a single pooled GradientBoostingRegressor.
    5. Evaluates both models on Jan–Jun 2026 holdout.
    6. Generates Jul–Dec 2026 point forecasts.
    7. Saves artifacts to disk.
    8. Returns a result dict (also serialised as JSON).

    Forecast for Jul-Dec 2026 uses iterative prediction: each step appends
    the previous prediction as if it were an actual, so lag features remain
    valid.  These months have no real actuals, so forecast_actual is null.
    """

    # ── 1. Extract series data ─────────────────────────────────────────────
    all_rows = []
    for dept, cat in FORECAST_SERIES:
        sub = totals_df[
            (totals_df["department"]      == dept) &
            (totals_df["budget_category"] == cat)
        ][["month", "department", "budget_category",
           "actual_spend_usd", "is_synthetic"]].copy()
        sub = sub.dropna(subset=["month", "actual_spend_usd"])
        sub = sub[sub["month"] <= VALIDATION_END]   # strictly no future actuals
        sub = sub.sort_values("month")
        all_rows.append(sub)

    combined = pd.concat(all_rows, ignore_index=True)

    # ── 2. Label encode entities ───────────────────────────────────────────
    dept_enc = LabelEncoder().fit(combined["department"].unique())
    cat_enc  = LabelEncoder().fit(combined["budget_category"].unique())

    # ── 3. Build features per series (lags must be computed within-series) ─
    featured_parts = []
    for sub in all_rows:
        feat = build_features(sub, dept_enc, cat_enc)
        featured_parts.append(feat)

    all_featured = pd.concat(featured_parts, ignore_index=True)

    # Training rows: up to TRAIN_END (remove rows where lags are NaN due to
    # insufficient history — need at least lag_12, so rows 0-11 of each series
    # will have NaN lag_12; drop them)
    train_feat = all_featured[
        (all_featured["month"] <= TRAIN_END) &
        all_featured[FEATURE_COLS].notna().all(axis=1)
    ]

    val_feat = all_featured[
        (all_featured["month"] >= VALIDATION_START) &
        (all_featured["month"] <= VALIDATION_END) &
        all_featured[FEATURE_COLS].notna().all(axis=1)
    ]

    X_train = train_feat[FEATURE_COLS].values
    y_train = train_feat["actual_spend_usd"].values
    X_val   = val_feat[FEATURE_COLS].values
    y_val   = val_feat["actual_spend_usd"].values

    # ── 4. Train GradientBoosting ──────────────────────────────────────────
    gb = GradientBoostingRegressor(
        n_estimators=200,
        max_depth=4,
        learning_rate=0.08,
        subsample=0.85,
        min_samples_leaf=3,
        random_state=42,
    )
    gb.fit(X_train, y_train)

    # ── 5. Validation metrics ──────────────────────────────────────────────
    gb_val_preds   = gb.predict(X_val)

    # Naive baseline on validation
    naive_val_preds_list = []
    for sub in all_rows:
        train_part = sub[sub["month"] <= TRAIN_END]
        val_months = pd.date_range(VALIDATION_START, VALIDATION_END, freq="MS")
        naive_preds = naive_forecast(train_part, val_months)
        naive_val_preds_list.append(naive_preds.values)

    naive_val_preds = np.concatenate(naive_val_preds_list)
    # Align length with y_val (naive has 6 months × 10 series = 60 rows)
    # val_feat may have fewer if some rows had NaN features; sync by index
    val_months_index = val_feat["month"].values
    naive_aligned = np.full(len(val_feat), np.nan)
    for i, ts in enumerate(val_months_index):
        ts_pd = pd.Timestamp(ts)
        for sub in all_rows:
            row = sub[sub["month"] == ts_pd]
            if len(row) == 0:
                continue
            dept = row.iloc[0]["department"]
            cat  = row.iloc[0]["budget_category"]
            if (val_feat.iloc[i]["department"] == dept and
                    val_feat.iloc[i]["budget_category"] == cat):
                prior = ts_pd - pd.DateOffset(years=1)
                prior_row = sub[sub["month"] == prior]
                if len(prior_row) > 0:
                    naive_aligned[i] = float(prior_row.iloc[0]["actual_spend_usd"])
                break

    gb_mae    = _mae(y_val, gb_val_preds)
    gb_wape   = _wape(y_val, gb_val_preds)
    naive_mae  = _mae(y_val, naive_aligned)
    naive_wape = _wape(y_val, naive_aligned)

    # Choose better model for the forward forecast
    use_gb = (gb_mae <= naive_mae) if not math.isnan(gb_mae) and not math.isnan(naive_mae) else True

    # ── 6. Jul-Dec 2026 iterative forecast ────────────────────────────────
    series_forecasts = {}

    for sub in all_rows:
        dept = sub.iloc[0]["department"]
        cat  = sub.iloc[0]["budget_category"]
        is_synth = bool(sub["is_synthetic"].all())

        # Extend the series iteratively
        working = sub.copy()

        monthly_forecasts = []
        for ts in FORECAST_MONTHS:
            feat_df = build_features(working, dept_enc, cat_enc)
            last_row = feat_df.iloc[[-1]].copy()
            # Overwrite month with the forecast target
            last_row["month"]         = ts
            last_row["month_of_year"] = ts.month
            last_row["month_sin"]     = math.sin(2 * math.pi * ts.month / 12)
            last_row["month_cos"]     = math.cos(2 * math.pi * ts.month / 12)
            last_row["fy_num"]        = _fy_num(ts)

            # Recompute lags from working series
            actuals = working["actual_spend_usd"].values
            last_row["lag_1"]  = actuals[-1]  if len(actuals) >= 1  else np.nan
            last_row["lag_3"]  = actuals[-3]  if len(actuals) >= 3  else np.nan
            last_row["lag_12"] = actuals[-12] if len(actuals) >= 12 else np.nan
            last_row["roll_3_mean"] = float(np.mean(actuals[-3:]))  if len(actuals) >= 3  else float(np.mean(actuals))
            last_row["roll_6_mean"] = float(np.mean(actuals[-6:]))  if len(actuals) >= 6  else float(np.mean(actuals))

            x_pred = last_row[FEATURE_COLS].values.reshape(1, -1)

            if use_gb:
                point = float(gb.predict(x_pred)[0])
            else:
                prior = ts - pd.DateOffset(years=1)
                prior_row = working[working["month"] == prior]
                point = float(prior_row.iloc[0]["actual_spend_usd"]) if len(prior_row) > 0 else float(actuals[-12]) if len(actuals) >= 12 else float(np.mean(actuals))

            point = max(0.0, round(point, 2))

            # Also compute naive for this month
            prior_ts = ts - pd.DateOffset(years=1)
            prior_row_n = working[working["month"] == prior_ts]
            naive_pt = float(prior_row_n.iloc[0]["actual_spend_usd"]) if len(prior_row_n) > 0 else None

            monthly_forecasts.append({
                "month":               ts.strftime("%Y-%m"),
                "forecast_gb":         point,
                "forecast_naive":      round(naive_pt, 2) if naive_pt is not None else None,
                "forecast_actual":     None,   # no actuals exist yet for Jul-Dec 2026
                "is_forecast":         True,
                "history_is_synthetic": is_synth,
            })

            # Append predicted value so next iteration's lags are correct
            new_row = pd.DataFrame([{
                "month":            ts,
                "department":       dept,
                "budget_category":  cat,
                "actual_spend_usd": point,
                "is_synthetic":     True,
            }])
            working = pd.concat([working, new_row], ignore_index=True)

        # Validation actuals (for reference in response)
        val_rows = []
        for vsub in all_rows:
            if vsub.iloc[0]["department"] == dept and vsub.iloc[0]["budget_category"] == cat:
                for _, vr in vsub[vsub["month"] >= VALIDATION_START].iterrows():
                    val_rows.append({
                        "month":          vr["month"].strftime("%Y-%m"),
                        "actual":         round(float(vr["actual_spend_usd"]), 2),
                        "is_forecast":    False,
                        "history_is_synthetic": bool(vr["is_synthetic"]),
                    })

        series_forecasts[f"{dept}|{cat}"] = {
            "department":  dept,
            "category":    cat,
            "history_is_synthetic": is_synth,
            "validation": val_rows,
            "forecasts":  monthly_forecasts,
        }

    # ── 7. Save artifacts ─────────────────────────────────────────────────
    metrics = {
        "model_used_for_forecast": "gradient_boosting" if use_gb else "seasonal_naive",
        "train_window":  f"Jul 2023 – Dec 2025  ({len(train_feat)} row-months)",
        "val_window":    "Jan 2026 – Jun 2026",
        "forecast_window": "Jul 2026 – Dec 2026",
        "series_count":  len(FORECAST_SERIES),
        "note": (
            "All series are based on synthetic historical data. "
            "Metrics are illustrative of model behavior, not real-world accuracy."
        ),
        "gradient_boosting": {
            "val_mae":  gb_mae,
            "val_wape": gb_wape,
        },
        "seasonal_naive": {
            "val_mae":  naive_mae,
            "val_wape": naive_wape,
        },
    }

    results = {
        "metrics":  metrics,
        "series":   series_forecasts,
    }

    with open(FORECAST_RESULTS_PATH, "w") as f:
        json.dump(results, f, indent=2, default=str)

    with open(MODEL_METRICS_PATH, "w") as f:
        json.dump(metrics, f, indent=2)

    joblib.dump(gb, GB_MODEL_PATH)
    joblib.dump({"dept_enc": dept_enc, "cat_enc": cat_enc}, ENCODERS_PATH)

    print(f"\nForecasting complete.")
    print(f"  GB   MAE={gb_mae:>10,.2f}   WAPE={gb_wape:.2f}%")
    print(f"  Naive MAE={naive_mae:>10,.2f}   WAPE={naive_wape:.2f}%")
    print(f"  Model chosen for Jul-Dec 2026: {'Gradient Boosting' if use_gb else 'Seasonal Naive'}")
    print(f"  Artifacts saved to: {ARTIFACTS_DIR}")

    return results


# ─────────────────────────────────────────────────────────────────────────────
# LOAD CACHED RESULTS  (used by API without re-training)
# ─────────────────────────────────────────────────────────────────────────────

def load_results() -> dict:
    """Load previously saved forecast results from disk."""
    if not os.path.exists(FORECAST_RESULTS_PATH):
        raise FileNotFoundError(
            "Forecast results not found. Run POST /api/forecast/run first."
        )
    with open(FORECAST_RESULTS_PATH) as f:
        return json.load(f)


def load_metrics() -> dict:
    """Load model comparison metrics from disk."""
    if not os.path.exists(MODEL_METRICS_PATH):
        raise FileNotFoundError(
            "Model metrics not found. Run POST /api/forecast/run first."
        )
    with open(MODEL_METRICS_PATH) as f:
        return json.load(f)
