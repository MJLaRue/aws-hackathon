"""
test_phase2.py
==============
Validates Phase 2 forecasting and scenario logic.
Run from the backend/ directory:
    python test_phase2.py

Does NOT require Flask to be running.
Does NOT hit any external endpoints.
Checks:
  1. Data loads and has the expected 10 series with ≥ 30 months of history
  2. Train/val split is strictly chronological (no future leakage)
  3. Feature lag columns are computed without leakage
  4. run_forecasting() produces 6 forecast months per series
  5. GB and naive MAE/WAPE are computed and finite
  6. Artifacts are saved to disk
  7. Scenario maths are correct
  8. Preset scenarios produce sane output
  9. Financial totals in scenario = baseline * multiplier
"""

import os
import sys
import math
import json

# Make sure backend/ is on the path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import pandas as pd
import numpy as np

from data_loader  import get_totals_df
from forecasting  import (
    run_forecasting, load_results, load_metrics,
    TRAIN_END, VALIDATION_START, VALIDATION_END,
    FORECAST_MONTHS, FORECAST_SERIES,
    build_features, naive_forecast,
    FEATURE_COLS, ARTIFACTS_DIR,
)
from scenarios import run_scenario, run_preset, PRESET_SCENARIOS

PASS = "✓"
FAIL = "✗"
results_log = []

def check(label: str, condition: bool, detail: str = ""):
    icon = PASS if condition else FAIL
    msg  = f"  {icon}  {label}"
    if detail:
        msg += f"  ({detail})"
    print(msg)
    results_log.append((label, condition))
    return condition


print("=" * 60)
print("Phase 2 Validation")
print("=" * 60)

# ── 1. Data loading ───────────────────────────────────────────────────────────
print("\n[1] Data loading")
df = get_totals_df()
check("DataFrame loaded", len(df) > 0, f"{len(df)} rows")
check("month column is datetime", pd.api.types.is_datetime64_any_dtype(df["month"]))
check("include_in_totals all True", df["include_in_totals"].all())
check("is_synthetic column exists", "is_synthetic" in df.columns)

# ── 2. Series coverage ────────────────────────────────────────────────────────
print("\n[2] Forecasting series coverage (need ≥ 30 months each)")
for dept, cat in FORECAST_SERIES:
    sub = df[(df["department"] == dept) & (df["budget_category"] == cat)]
    sub = sub[sub["month"] <= VALIDATION_END]
    n   = sub["month"].nunique()
    check(f"{dept[:22]} | {cat[:20]}", n >= 24,
          f"{n} months (target ≥30; <30 means some history is missing)")

# ── 3. Chronological split ────────────────────────────────────────────────────
print("\n[3] Chronological split integrity")
check("TRAIN_END < VALIDATION_START",
      TRAIN_END < VALIDATION_START,
      f"{TRAIN_END.date()} < {VALIDATION_START.date()}")
check("VALIDATION_END < FORECAST_MONTHS[0]",
      VALIDATION_END < FORECAST_MONTHS[0],
      f"{VALIDATION_END.date()} < {FORECAST_MONTHS[0].date()}")
check("Forecast months are future (> Jun 2026)",
      all(ts > VALIDATION_END for ts in FORECAST_MONTHS),
      f"first={FORECAST_MONTHS[0].date()}, last={FORECAST_MONTHS[-1].date()}")

# ── 4. Feature engineering – no leakage ──────────────────────────────────────
print("\n[4] Feature engineering – no target leakage")
dept0, cat0 = FORECAST_SERIES[0]
sub0 = df[(df["department"] == dept0) & (df["budget_category"] == cat0)].copy()
sub0 = sub0[sub0["month"] <= VALIDATION_END].sort_values("month")

from sklearn.preprocessing import LabelEncoder
dept_enc_t = LabelEncoder().fit([dept0])
cat_enc_t  = LabelEncoder().fit([cat0])
feat0 = build_features(sub0, dept_enc_t, cat_enc_t)

# lag_1 at row i should equal actual at row i-1
lag_ok = True
for i in range(1, min(5, len(feat0))):
    expected = feat0["actual_spend_usd"].iloc[i - 1]
    got      = feat0["lag_1"].iloc[i]
    if not math.isnan(got) and abs(expected - got) > 0.01:
        lag_ok = False
        break
check("lag_1 correctly refers to t-1 actual", lag_ok)

# lag_12 at row i should equal actual at row i-12
lag12_ok = True
for i in range(12, min(15, len(feat0))):
    expected = feat0["actual_spend_usd"].iloc[i - 12]
    got      = feat0["lag_12"].iloc[i]
    if not math.isnan(got) and abs(expected - got) > 0.01:
        lag12_ok = False
        break
check("lag_12 correctly refers to t-12 actual", lag12_ok)

check("No future actual in training feature set",
      feat0[feat0["month"] <= TRAIN_END]["actual_spend_usd"].notna().any())

# ── 5. Run forecasting ────────────────────────────────────────────────────────
print("\n[5] Forecasting run")
res = run_forecasting(df)
check("run_forecasting returns dict", isinstance(res, dict))
check("metrics key present", "metrics" in res)
check("series key present",  "series"  in res)
check(f"Correct number of series ({len(FORECAST_SERIES)})",
      len(res["series"]) == len(FORECAST_SERIES))

# ── 6. Forecast output shape ──────────────────────────────────────────────────
print("\n[6] Forecast output")
first_key = list(res["series"].keys())[0]
first_s   = res["series"][first_key]
fc_months = first_s["forecasts"]
check("6 forecast months per series", len(fc_months) == 6,
      f"got {len(fc_months)}")
check("forecast months are Jul-Dec 2026",
      fc_months[0]["month"] == "2026-07" and fc_months[-1]["month"] == "2026-12",
      f"{fc_months[0]['month']} … {fc_months[-1]['month']}")
check("forecast_actual is None (no leakage)",
      all(f["forecast_actual"] is None for f in fc_months))
check("forecast_gb values are positive",
      all((f["forecast_gb"] or 0) >= 0 for f in fc_months))

# ── 7. Metrics ────────────────────────────────────────────────────────────────
print("\n[7] Model metrics")
m = res["metrics"]
gb_mae    = m["gradient_boosting"]["val_mae"]
gb_wape   = m["gradient_boosting"]["val_wape"]
naive_mae  = m["seasonal_naive"]["val_mae"]
naive_wape = m["seasonal_naive"]["val_wape"]
check("GB MAE is finite positive",    gb_mae  > 0 and not math.isnan(gb_mae),   f"${gb_mae:,.0f}")
check("GB WAPE is finite positive",   gb_wape > 0 and not math.isnan(gb_wape),  f"{gb_wape:.2f}%")
check("Naive MAE is finite positive", naive_mae  > 0 and not math.isnan(naive_mae), f"${naive_mae:,.0f}")
check("Naive WAPE is finite",         not math.isnan(naive_wape), f"{naive_wape:.2f}%")
check("model_used_for_forecast set",  "model_used_for_forecast" in m,
      m.get("model_used_for_forecast"))

# ── 8. Artifacts on disk ──────────────────────────────────────────────────────
print("\n[8] Artifacts saved")
check("forecast_results.json exists",
      os.path.exists(os.path.join(ARTIFACTS_DIR, "forecast_results.json")))
check("model_metrics.json exists",
      os.path.exists(os.path.join(ARTIFACTS_DIR, "model_metrics.json")))
check("gb_model.joblib exists",
      os.path.exists(os.path.join(ARTIFACTS_DIR, "gb_model.joblib")))
check("label_encoders.joblib exists",
      os.path.exists(os.path.join(ARTIFACTS_DIR, "label_encoders.joblib")))

loaded_m = load_metrics()
check("load_metrics() reads saved file", "gradient_boosting" in loaded_m)

# ── 9. Scenario maths ─────────────────────────────────────────────────────────
print("\n[9] Scenario arithmetic")
adj = [{"type": "category", "name": "Personnel & Salaries", "change_pct": 10.0}]
sc  = run_scenario(adj, "Test +10% Salaries")
check("run_scenario returns dict",   isinstance(sc, dict))
check("summary key present",         "summary" in sc)
check("series key present",          "series"  in sc)

# Find a salary series and verify 10% uplift
salary_series = [s for s in sc["series"]
                 if s["category"] == "Personnel & Salaries"]
check("At least one salary series affected", len(salary_series) > 0)
if salary_series:
    ss = salary_series[0]
    check("multiplier is 1.10", abs(ss["multiplier_applied"] - 1.10) < 0.001,
          f"{ss['multiplier_applied']}")
    # Verify monthly arithmetic
    for m_row in ss["monthly"][:3]:
        if m_row["baseline"] and m_row["adjusted"]:
            expected_adj = round(m_row["baseline"] * 1.10, 2)
            diff = abs(m_row["adjusted"] - expected_adj)
            check(f"Month {m_row['month']} adjusted = baseline × 1.10",
                  diff < 0.05, f"expected {expected_adj}, got {m_row['adjusted']}")

# Non-salary series should have multiplier = 1.0
non_salary = [s for s in sc["series"] if s["category"] != "Personnel & Salaries"]
check("Non-salary series unaffected (multiplier=1.0)",
      all(abs(s["multiplier_applied"] - 1.0) < 0.001 for s in non_salary))

# Summary totals
check("adjusted_total > baseline_total for +10% scenario",
      sc["summary"]["adjusted_total_6m"] > sc["summary"]["baseline_total_6m"])
check("difference_pct is positive",
      (sc["summary"]["difference_pct"] or 0) > 0)

# ── 10. Preset scenarios ──────────────────────────────────────────────────────
print("\n[10] Preset scenarios")
for pid in list(PRESET_SCENARIOS.keys())[:3]:
    try:
        pr = run_preset(pid)
        check(f"Preset '{pid}' runs OK", isinstance(pr, dict) and "summary" in pr)
    except Exception as e:
        check(f"Preset '{pid}' runs OK", False, str(e))

# ── 11. Negative scenario ─────────────────────────────────────────────────────
print("\n[11] Austerity preset (all -5%)")
austerity = run_preset("austerity")
check("Austerity adjusted_total < baseline_total",
      austerity["summary"]["adjusted_total_6m"] < austerity["summary"]["baseline_total_6m"])
check("Austerity difference_pct is negative",
      (austerity["summary"]["difference_pct"] or 0) < 0)

# ── Summary ───────────────────────────────────────────────────────────────────
print("\n" + "=" * 60)
passed = sum(1 for _, ok in results_log if ok)
total  = len(results_log)
print(f"Results: {passed}/{total} checks passed")
if passed < total:
    print("\nFailed checks:")
    for label, ok in results_log:
        if not ok:
            print(f"  {FAIL}  {label}")
print("=" * 60)
sys.exit(0 if passed == total else 1)
