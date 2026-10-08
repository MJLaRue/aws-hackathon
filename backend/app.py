"""
app.py
======
Flask API server for local development.
The same handler logic is re-used by lambda_handler.py for AWS Lambda.

Endpoints  (Phase 1)
--------------------
GET /api/health                  liveness check
GET /api/filters                 filter dimension options
GET /api/summary                 KPI summary card data
GET /api/trends/monthly          monthly budget vs actual vs forecast
GET /api/breakdown/department    budget/actual per department
GET /api/breakdown/category      budget/actual per category
GET /api/anomalies               anomaly records table
GET /api/anomalies/summary       anomaly counts by type and status
GET /api/series                  monthly series for one dept+category combo

Endpoints  (Phase 2 – ML Forecasting & Scenarios)
--------------------------------------------------
POST /api/forecast/run           train models + generate Jul-Dec 2026 forecasts
GET  /api/forecast/results       all series forecasts (from saved artifact)
GET  /api/forecast/metrics       MAE/WAPE comparison between GB and naive

GET  /api/scenarios/presets      list available preset scenarios
POST /api/scenarios/run          run a custom what-if scenario
GET  /api/scenarios/preset/<id>  run a named preset scenario

All GET endpoints accept these optional query parameters:
  fiscal_year, department, category, fund_source,
  report_status, month_start, month_end, include_synthetic (true/false)

Run locally:
    pip install flask flask-cors python-dotenv
    python app.py
"""

import os
import math
from flask import Flask, jsonify, request
from flask_cors import CORS

# Load .env when running locally
try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
except ImportError:
    pass

from data_loader import get_dataframe, get_totals_df
from analytics import (
    apply_filters,
    kpi_summary,
    monthly_trend,
    department_breakdown,
    category_breakdown,
    anomaly_records,
    anomaly_summary,
    filter_options,
    series_trend,
)
from forecasting import run_forecasting, load_results, load_metrics
from scenarios  import run_scenario, run_preset, get_preset_list

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": os.environ.get("CORS_ORIGIN", os.environ.get("APP_ORIGIN", "http://127.0.0.1:5173"))}})


# ── helpers ───────────────────────────────────────────────────────────────────

def _query_filters() -> dict:
    """Extract common filter params from the current request."""
    p = request.args
    return {
        "fiscal_year":        p.get("fiscal_year"),
        "department":         p.get("department"),
        "category":           p.get("category"),
        "fund_source":        p.get("fund_source"),
        "report_status":      p.get("report_status"),
        "month_start":        p.get("month_start"),
        "month_end":          p.get("month_end"),
        "include_synthetic":  p.get("include_synthetic", "true").lower() != "false",
    }


def _error(msg: str, status: int = 400):
    return jsonify({"error": msg}), status


# ── routes ────────────────────────────────────────────────────────────────────

@app.route("/api/health")
def health():
    try:
        df = get_dataframe()
        return jsonify({
            "status":  "ok",
            "rows":    len(df),
            "columns": list(df.columns),
        })
    except Exception as exc:
        return _error(str(exc), 500)


@app.route("/api/filters")
def filters():
    try:
        df = get_totals_df()
        return jsonify(filter_options(df))
    except Exception as exc:
        return _error(str(exc), 500)


@app.route("/api/summary")
def summary():
    try:
        df  = get_totals_df()
        flt = _query_filters()
        df  = apply_filters(df, **flt)
        return jsonify(kpi_summary(df))
    except Exception as exc:
        return _error(str(exc), 500)


@app.route("/api/trends/monthly")
def trends_monthly():
    try:
        df  = get_totals_df()
        flt = _query_filters()
        df  = apply_filters(df, **flt)
        return jsonify(monthly_trend(df))
    except Exception as exc:
        return _error(str(exc), 500)


@app.route("/api/breakdown/department")
def breakdown_dept():
    try:
        df  = get_totals_df()
        flt = _query_filters()
        df  = apply_filters(df, **flt)
        return jsonify(department_breakdown(df))
    except Exception as exc:
        return _error(str(exc), 500)


@app.route("/api/breakdown/category")
def breakdown_cat():
    try:
        df  = get_totals_df()
        flt = _query_filters()
        df  = apply_filters(df, **flt)
        return jsonify(category_breakdown(df))
    except Exception as exc:
        return _error(str(exc), 500)


@app.route("/api/anomalies")
def anomalies():
    try:
        limit = int(request.args.get("limit", 200))
        df    = get_totals_df()
        flt   = _query_filters()
        df    = apply_filters(df, **flt)
        return jsonify(anomaly_records(df, limit=limit))
    except Exception as exc:
        return _error(str(exc), 500)


@app.route("/api/anomalies/summary")
def anomalies_summary():
    try:
        df  = get_totals_df()
        flt = _query_filters()
        df  = apply_filters(df, **flt)
        return jsonify(anomaly_summary(df))
    except Exception as exc:
        return _error(str(exc), 500)


@app.route("/api/series")
def series():
    """
    GET /api/series?department=College+of+Pharmacy&category=Personnel+%26+Salaries
    Returns the 36-month (or available) trend for one dept+category.
    """
    try:
        department = request.args.get("department")
        category   = request.args.get("category")
        if not department or not category:
            return _error("department and category query params are required")

        df  = get_totals_df()
        flt = _query_filters()
        # Don't filter by dept/category from query_filters — use the dedicated params
        flt["department"] = None
        flt["category"]   = None
        df  = apply_filters(df, **flt)
        return jsonify(series_trend(df, department, category))
    except Exception as exc:
        return _error(str(exc), 500)


# ── Phase 2: forecasting routes ───────────────────────────────────────────────

@app.route("/api/forecast/run", methods=["POST"])
def forecast_run():
    """
    Train/retrain the GB model and regenerate Jul-Dec 2026 forecasts.
    Saves artifacts to disk.  Can take ~5-10s on first run.
    """
    try:
        df      = get_totals_df()
        results = run_forecasting(df)
        # Return only the metrics to keep the response small
        return jsonify({
            "status":  "ok",
            "metrics": results["metrics"],
            "series_keys": list(results["series"].keys()),
        })
    except Exception as exc:
        return _error(str(exc), 500)


@app.route("/api/forecast/results")
def forecast_results():
    """
    Return all saved forecast series (Jul-Dec 2026 point forecasts + validation rows).
    Optionally filter by ?department= or ?category=.
    Run POST /api/forecast/run first.
    """
    try:
        results  = load_results()
        dept_flt = request.args.get("department")
        cat_flt  = request.args.get("category")

        series = results["series"]
        if dept_flt:
            series = {k: v for k, v in series.items()
                      if dept_flt.lower() in v["department"].lower()}
        if cat_flt:
            series = {k: v for k, v in series.items()
                      if cat_flt.lower() in v["category"].lower()}

        return jsonify({
            "metrics": results["metrics"],
            "series":  list(series.values()),
        })
    except FileNotFoundError as exc:
        return _error(str(exc), 404)
    except Exception as exc:
        return _error(str(exc), 500)


@app.route("/api/forecast/metrics")
def forecast_metrics():
    """Return MAE / WAPE comparison between GB and seasonal-naive."""
    try:
        return jsonify(load_metrics())
    except FileNotFoundError as exc:
        return _error(str(exc), 404)
    except Exception as exc:
        return _error(str(exc), 500)


# ── Phase 2: scenario routes ──────────────────────────────────────────────────

@app.route("/api/scenarios/presets")
def scenario_presets():
    """List available preset what-if scenarios."""
    try:
        return jsonify(get_preset_list())
    except Exception as exc:
        return _error(str(exc), 500)


@app.route("/api/scenarios/run", methods=["POST"])
def scenario_run():
    """
    Run a custom what-if scenario.

    POST body (JSON):
    {
      "scenario_name": "My Scenario",
      "adjustments": [
        {"type": "category",   "name": "Personnel & Salaries",   "change_pct": 5.0},
        {"type": "category",   "name": "Travel & Conferences",   "change_pct": -10.0},
        {"type": "department", "name": "IT Services",            "change_pct": 12.0}
      ]
    }
    """
    try:
        body        = request.get_json(force=True) or {}
        adjustments = body.get("adjustments", [])
        name        = body.get("scenario_name")
        if not adjustments:
            return _error("adjustments list is required and must not be empty")
        return jsonify(run_scenario(adjustments, scenario_name=name))
    except FileNotFoundError as exc:
        return _error(str(exc), 404)
    except Exception as exc:
        return _error(str(exc), 500)


@app.route("/api/scenarios/preset/<preset_id>")
def scenario_preset(preset_id: str):
    """
    Run a named preset scenario.
    Available IDs: salary_increase_5pct, travel_cut_10pct,
                   tech_investment_8pct, austerity, research_push
    """
    try:
        return jsonify(run_preset(preset_id))
    except ValueError as exc:
        return _error(str(exc), 404)
    except FileNotFoundError as exc:
        return _error(str(exc), 404)
    except Exception as exc:
        return _error(str(exc), 500)


# ── local dev entry point ─────────────────────────────────────────────────────

if __name__ == "__main__":
    port = int(os.environ.get("ANALYTICS_PORT", 8001))
    debug = os.environ.get("FLASK_DEBUG", "false").lower() == "true"
    print(f"Starting Budget API on http://localhost:{port}")
    app.run(host="127.0.0.1", port=port, debug=debug)
