"""Regenerate backend/replay/prompt_*.json from the enhanced dataset (design §9.2, Rev 5).

Every tool result is produced by the real dispatcher; every number in assistant_text is formatted from those
results and the grounding check is run on each trace before it is written.
Usage (repo root): python scripts/build_replay_traces.py
"""
import json
import os
import sys
import tempfile
from pathlib import Path

import duckdb
import pandas as pd

os.environ.setdefault("DUCKDB_DATA_DIR", tempfile.mkdtemp(prefix="replay_catalog_"))
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))
from agent.grounding import run_grounding_check  # noqa: E402
from ingestion.pipeline import run_ingestion_pipeline  # noqa: E402
from tools.dispatcher import dispatch_tool  # noqa: E402

OUT = ROOT / "backend" / "replay"
GT = set("BUD-00237 BUD-00189 BUD-00176 BUD-00005 BUD-00190 BUD-00285 BUD-00213 BUD-00267 BUD-00160 BUD-00156 "
         "BUD-00228 BUD-00293 BUD-00087 BUD-00202 BUD-00116 BUD-00028 BUD-00241".split())

db = tempfile.mktemp(suffix=".ddb")
run_ingestion_pipeline(pd.read_excel(ROOT / "data" / "Team6Dataset_Enhanced 1.xlsx"), db=db)
conn = duckdb.connect(db)


def call(tool: str, **inp) -> dict:
    inp = {"dataset_id": "sample", **inp}
    return {"tool": tool, "input": inp, "result": dispatch_tool(tool, inp, conn, "sample")}


pct = lambda v: f"{abs(v):.1f}%"            # noqa: E731  magnitude; direction is stated in words
usd = lambda v: f"${abs(v):,.0f}"           # noqa: E731
sign = lambda v: "over" if v > 0 else "under"  # noqa: E731
join = lambda xs: ", ".join(xs[:-1]) + f", and {xs[-1]}" if len(xs) > 2 else " and ".join(xs)  # noqa: E731

traces = {}

# 01 over-budget departments
c = call("query_actuals", entity_level="department")
top = c["result"]["rows"][:3]
parts = [f"{r['entity_name']} at {pct(r['variance_pct_agg'])} over budget ({usd(r['variance_usd'])})" for r in top]
traces["prompt_01_over_budget_depts"] = ("Which departments are furthest over budget, and by how much?", [c],
    f"The three departments furthest over budget across all fiscal years are {join(parts)}. "
    "Figures are actual spend against budget for rows included in totals.")

# 02 Consulting & Contracts
e = call("explain_variance", entity_level="category", entity_name="Consulting & Contracts")
d = call("detect_anomalies", entity_level="category", entity_name="Consulting & Contracts")
pat = next(p for p in d["result"]["persistent_patterns"] if p["entity_name"] == "Consulting & Contracts")
yrs = [f"{y} at {pct(v)}" for y, v in sorted(pat["per_year_variance"].items())]
dc = e["result"]["top_department_contributors"][0]
traces["prompt_02_consulting_contracts"] = ("Why is Consulting & Contracts over budget?", [e, d],
    f"Consulting & Contracts is {pct(e['result']['total_variance_pct'])} over budget overall ({usd(e['result']['total_variance_usd'])}). "
    f"The overrun is a persistent pattern: it is over budget in every fiscal year, with {join(yrs)}. "
    f"The largest contributor is {dc['entity_name']} at {usd(dc['variance_usd'])}. "
    "The data shows where the overrun sits but not why it happens. One hypothesis is recurring contract commitments "
    "that are under-budgeted, and that cannot be confirmed from this dataset.")

# 03 underspending categories
d = call("detect_anomalies", entity_level="category")
under = [p for p in d["result"]["persistent_patterns"] if p["entity_type"] == "category" and p["direction"] == "under"]
lines = []
for p in under:
    vals = ", ".join(f"{y} {pct(v)}" for y, v in sorted(p["per_year_variance"].items()))
    lines.append(f"{p['entity_name']} (under budget in {', '.join(p['qualifying_years'])}; {vals})")
traces["prompt_03_underspending"] = ("Where are we consistently underspending?", [d],
    "These categories are persistently under budget, meaning at least five percent under in at least two of the three fiscal years: "
    + "; ".join(lines) + ". Spending below budget is not necessarily good news, so it is worth checking whether the plans were too high or work was deferred.")

# 04 forecast
f = call("run_forecast", entity_level="total", horizon=4)
fr = f["result"]
p1 = fr["points"][0]
pts = [f"{p['forecast_quarter']} at {p['ratio_forecast']:.2f}" for p in fr["points"]]
traces["prompt_04_fy2027_forecast"] = ("What is the FY2027 forecast for total spend versus budget, and how confident are you?", [f],
    f"The forecast is the spend-to-budget ratio, where a value above parity means over budget. The ratio forecasts are {join(pts)}. "
    f"For {p1['forecast_quarter']}, the dollar forecast is {usd(p1['dollar_forecast'])} against a planned budget base of {usd(fr['planned_budget_total'])}, "
    f"with an 80% interval of {usd(p1['dollar_pi_80_low'])} to {usd(p1['dollar_pi_80_high'])} and a 95% interval of {usd(p1['dollar_pi_95_low'])} to {usd(p1['dollar_pi_95_high'])}. "
    f"The selected model is {fr['model_name']}, with cross-validated error of {fr['cv_mae']:.3f} MAE and {fr['cv_smape']:.1f}% sMAPE. "
    f"Confidence is {fr['confidence_label']}. Caveat: the history is short, only a few validation folds were possible, "
    "and the intervals are bootstrap-based, so treat them as approximate rather than guaranteed coverage.")

# 05 outliers
d = call("detect_anomalies", entity_level="total")
dr = d["result"]
by_src = {}
for a in dr["anomalies"]:
    if not a["is_synthetic"] and abs(a["variance_pct"]) >= 30 and a["source_record_id"] not in by_src:
        by_src[a["source_record_id"]] = a
assert set(by_src) == GT, set(by_src) ^ GT
rows = sorted(by_src.values(), key=lambda a: a["variance_pct"])
lines = [f"{a['source_record_id']} ({a['department']}, {a['category']}) variance {a['variance_pct']:.1f}%, z-score {a['z_score']:.1f}" for a in rows]
cm = dr["confusion_matrix"]
traces["prompt_05_outlier_records"] = ("Which individual records are the biggest outliers?", [d],
    "These source records have the largest variances, all at least thirty percent from budget: " + "; ".join(lines) + ". "
    f"Detector versus source flag, counted over monthly rows: both flagged {cm['tp']}, the source flagged but the detector did not {cm['fp']}, "
    f"and the detector flagged but the source did not {cm['fn']}. The source flags are not ground truth, so both views are shown side by side.")

# 06 process health
h1 = call("get_reporting_health", grouping="total")
h2 = call("get_reporting_health", grouping="department")
t = h1["result"]["rows"][0]
worst = max(h2["result"]["rows"], key=lambda r: r["avg_data_entry_errors"])
traces["prompt_06_process_health"] = ("How long do reports take to produce, and where are the errors?", [h1, h2],
    f"Across all reports, the average time to produce is {t['avg_days_to_produce']:.1f} days, with {t['avg_spreadsheet_versions']:.1f} spreadsheet versions "
    f"and {t['avg_manual_adjustments']:.1f} manual adjustments on average. Average data entry errors are {t['avg_data_entry_errors']:.2f} per report, "
    f"and {t['pct_with_errors'] * 100:.1f}% of reports have at least one error. The highest department average is {worst['group_value']} at {worst['avg_data_entry_errors']:.2f}. "
    "These are descriptive statistics only. They do not show that process characteristics cause any budget variance.")

# 07 unanswerable
l = call("list_entities")
depts = l["result"]["entities"]["departments"]
assert not any("bursar" in d.lower() for d in depts)
traces["prompt_07_bursar_insufficient"] = ("What did the Bursar's office spend on travel?", [l],
    "There is insufficient data to answer that. The loaded dataset has no entity called the Bursar's Office, so I will not guess a figure. "
    "The departments in the dataset are: " + "; ".join(depts) + ".")

for name, (prompt, calls, text) in traces.items():
    g = run_grounding_check(text, calls)
    assert not g["failed_values"], (name, g["failed_values"])
    (OUT / f"{name}.json").write_text(json.dumps(
        {"prompt": prompt, "tool_calls": calls, "assistant_text": text, "grounding_check": "pass"}, indent=1, ensure_ascii=False), encoding="utf-8")
    print(name, len(text), "chars,", g["extracted_count"], "numerics grounded")
