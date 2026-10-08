"""
chatbot.py
==========
Amazon Bedrock financial chatbot.

Design
------
1. The user's question + active dashboard filters arrive from the API.
2. build_context() calls existing analytics functions to assemble a
   concise JSON snapshot of the relevant financial data.  Bedrock
   never touches the raw DataFrame directly.
3. The context + question are sent to Bedrock via the Converse API.
4. The model returns a grounded, narrative answer.

Safety rules enforced in the system prompt
-------------------------------------------
- Never invent financial figures not present in the context.
- Always cite the source period, department, and figures.
- Clearly label synthetic data.
- Never suggest modifying finalized records.
- If a question can't be answered from the context, say so explicitly.

Supported Bedrock models (set BEDROCK_MODEL_ID in .env)
-------------------------------------------------------
  amazon.titan-text-premier-v1:0          (default – widely available)
  anthropic.claude-3-haiku-20240307-v1:0  (faster/cheaper)
  anthropic.claude-3-sonnet-20240229-v1:0 (higher quality)
  amazon.nova-lite-v1:0                   (fast, low cost)
  amazon.nova-pro-v1:0

All models use the same boto3 Converse API so switching is one env var.
"""

import os
import json
import math
import logging

import boto3
from botocore.exceptions import ClientError, NoCredentialsError

from data_loader import get_totals_df
from analytics import (
    apply_filters,
    kpi_summary,
    monthly_trend,
    department_breakdown,
    category_breakdown,
    anomaly_summary,
    anomaly_records,
)
from forecasting import load_results, load_metrics
from scenarios   import run_scenario

logger = logging.getLogger(__name__)

# ── configuration ─────────────────────────────────────────────────────────────
BEDROCK_MODEL_ID = os.environ.get(
    "BEDROCK_MODEL_ID", "amazon.titan-text-premier-v1:0"
)
BEDROCK_REGION = os.environ.get("BEDROCK_REGION", "us-east-1")
MAX_TOKENS     = int(os.environ.get("BEDROCK_MAX_TOKENS", "1024"))
TEMPERATURE    = float(os.environ.get("BEDROCK_TEMPERATURE", "0.2"))

# ── system prompt ─────────────────────────────────────────────────────────────
SYSTEM_PROMPT = """You are a financial analyst assistant for a university budgeting dashboard.
You answer questions using ONLY the financial data provided in the <context> block.
You must NEVER invent, estimate, or assume financial figures not present in the context.

Rules you must follow:
1. Always cite specific figures, departments, periods, and categories from the context.
2. When data is labelled synthetic, mention that clearly in your answer.
3. Never suggest modifying, correcting, or overriding finalized records.
4. If the context does not contain enough information to answer the question, say:
   "I don't have enough data in the current view to answer that. Try adjusting the filters."
5. Keep answers concise — 3 to 6 sentences unless the question requires more detail.
6. Format dollar amounts as $X,XXX or $X.XM. Format percentages as X.X%.
7. When comparing budget vs actual, always state both figures and the variance.
"""

# ── context builder ───────────────────────────────────────────────────────────

def _safe(v, decimals=2):
    """Return a JSON-serialisable scalar."""
    if v is None:
        return None
    try:
        f = float(v)
        return None if math.isnan(f) else round(f, decimals)
    except (TypeError, ValueError):
        return v


def build_context(filters: dict) -> dict:
    """
    Call existing analytics functions and assemble a concise context dict.
    Keeps size manageable: top-N breakdowns, latest anomalies, forecast summary.
    """
    df = get_totals_df()
    fdf = apply_filters(df, **filters)

    ctx = {}

    # ── KPI summary ───────────────────────────────────────────────────────────
    try:
        s = kpi_summary(fdf)
        ctx["kpi"] = {k: _safe(v) for k, v in s.items()}
    except Exception as e:
        ctx["kpi"] = {"error": str(e)}

    # ── Active filters ────────────────────────────────────────────────────────
    ctx["active_filters"] = {k: v for k, v in filters.items() if v not in (None, "", True)}

    # ── Department breakdown (top 10 by actual spend) ─────────────────────────
    try:
        dept = department_breakdown(fdf)
        ctx["departments"] = [
            {
                "department":   d["department"],
                "budget":       _safe(d["budget"]),
                "actual":       _safe(d["actual"]),
                "variance_usd": _safe(d["variance_usd"]),
                "variance_pct": _safe(d["variance_pct"], 1),
                "anomaly_count": d["anomaly_count"],
            }
            for d in sorted(dept, key=lambda x: abs(x.get("variance_usd") or 0), reverse=True)[:10]
        ]
    except Exception as e:
        ctx["departments"] = [{"error": str(e)}]

    # ── Category breakdown ────────────────────────────────────────────────────
    try:
        cat = category_breakdown(fdf)
        ctx["categories"] = [
            {
                "category":     c["category"],
                "budget":       _safe(c["budget"]),
                "actual":       _safe(c["actual"]),
                "variance_usd": _safe(c["variance_usd"]),
                "variance_pct": _safe(c["variance_pct"], 1),
            }
            for c in sorted(cat, key=lambda x: abs(x.get("variance_usd") or 0), reverse=True)[:8]
        ]
    except Exception as e:
        ctx["categories"] = [{"error": str(e)}]

    # ── Anomaly summary ───────────────────────────────────────────────────────
    try:
        anom_sum = anomaly_summary(fdf)
        ctx["anomaly_summary"] = anom_sum
        # Top 5 anomaly records
        top_anom = anomaly_records(fdf, limit=5)
        ctx["top_anomalies"] = [
            {
                "month":       a.get("month"),
                "department":  a.get("department"),
                "category":    a.get("budget_category"),
                "actual":      _safe(a.get("actual_spend_usd")),
                "budget":      _safe(a.get("budgeted_amount_usd")),
                "variance_usd":_safe(a.get("variance_usd")),
                "variance_pct":_safe(a.get("variance_pct"), 1),
                "type":        a.get("anomaly_type"),
                "status":      a.get("report_status"),
                "review":      a.get("anomaly_review_status"),
                "synthetic":   a.get("is_synthetic", False),
            }
            for a in top_anom
        ]
    except Exception as e:
        ctx["anomaly_summary"] = {"error": str(e)}
        ctx["top_anomalies"]   = []

    # ── Monthly trend (last 12 months) ────────────────────────────────────────
    try:
        trend = monthly_trend(fdf)
        ctx["monthly_trend_last_12"] = trend[-12:] if len(trend) > 12 else trend
    except Exception as e:
        ctx["monthly_trend_last_12"] = [{"error": str(e)}]

    # ── Forecast summary (if artifacts exist) ────────────────────────────────
    try:
        metrics = load_metrics()
        fc_res  = load_results()
        fc_series = list(fc_res.get("series", {}).values())

        # Aggregate Jul-Dec 2026 totals across all series
        total_fc_gb    = sum(
            f["forecast_gb"] or 0
            for s in fc_series
            for f in s.get("forecasts", [])
        )
        total_fc_naive = sum(
            f["forecast_naive"] or 0
            for s in fc_series
            for f in s.get("forecasts", [])
            if f.get("forecast_naive") is not None
        )
        ctx["forecast"] = {
            "period":           "Jul 2026 – Dec 2026",
            "model_used":       metrics.get("model_used_for_forecast"),
            "total_gb_6m":      _safe(total_fc_gb),
            "total_naive_6m":   _safe(total_fc_naive),
            "gb_val_mae":       _safe(metrics["gradient_boosting"]["val_mae"]),
            "gb_val_wape_pct":  _safe(metrics["gradient_boosting"]["val_wape"], 1),
            "naive_val_mae":    _safe(metrics["seasonal_naive"]["val_mae"]),
            "note":             metrics.get("note"),
            "series_count":     len(fc_series),
            "series_are_synthetic": True,
            # Per-series Jul 2026 forecast for the first 5 series
            "series_sample": [
                {
                    "department": s["department"],
                    "category":   s["category"],
                    "forecasts": [
                        {"month": f["month"], "gb": _safe(f["forecast_gb"])}
                        for f in s.get("forecasts", [])
                    ],
                }
                for s in fc_series[:5]
            ],
        }
    except FileNotFoundError:
        ctx["forecast"] = {"note": "Forecast not yet generated. Run POST /api/forecast/run first."}
    except Exception as e:
        ctx["forecast"] = {"error": str(e)}

    return ctx


# ── Bedrock client ─────────────────────────────────────────────────────────────

def _get_bedrock_client():
    return boto3.client("bedrock-runtime", region_name=BEDROCK_REGION)


def _build_converse_messages(question: str, context: dict, history: list) -> list:
    """
    Assemble the messages list for the Converse API.
    history is a list of {"role": "user"|"assistant", "text": str} dicts.
    """
    messages = []

    # Rebuild prior conversation turns
    for turn in history[-6:]:   # keep last 6 turns (3 exchanges) for context window
        messages.append({
            "role": turn["role"],
            "content": [{"text": turn["text"]}],
        })

    # Current turn: inject the context + question
    context_block = json.dumps(context, indent=2, default=str)
    user_text = (
        f"<context>\n{context_block}\n</context>\n\n"
        f"Question: {question}"
    )
    messages.append({
        "role": "user",
        "content": [{"text": user_text}],
    })

    return messages


def ask_bedrock(question: str, context: dict, history: list) -> str:
    """
    Send question + context to Bedrock via the Converse API.
    Returns the model's text response.
    Raises BedrockUnavailableError on credential/access issues.
    """
    client   = _get_bedrock_client()
    messages = _build_converse_messages(question, context, history)

    try:
        response = client.converse(
            modelId=BEDROCK_MODEL_ID,
            system=[{"text": SYSTEM_PROMPT}],
            messages=messages,
            inferenceConfig={
                "maxTokens":   MAX_TOKENS,
                "temperature": TEMPERATURE,
            },
        )
        return response["output"]["message"]["content"][0]["text"]

    except NoCredentialsError:
        raise BedrockUnavailableError(
            "AWS credentials not configured. "
            "Set AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY or use an IAM role."
        )
    except ClientError as e:
        code = e.response["Error"]["Code"]
        msg  = e.response["Error"]["Message"]
        if code in ("AccessDeniedException", "UnauthorizedClientException"):
            raise BedrockUnavailableError(
                f"Bedrock access denied for model '{BEDROCK_MODEL_ID}'. "
                f"Ensure the model is enabled in your AWS account and the IAM role "
                f"has bedrock:InvokeModel permission. AWS: {msg}"
            )
        raise BedrockUnavailableError(f"Bedrock error ({code}): {msg}")


class BedrockUnavailableError(Exception):
    """Raised when Bedrock is unreachable or not configured."""


# ── Scenario question handler ──────────────────────────────────────────────────

def handle_scenario_question(question: str, context: dict) -> str:
    """
    Detect simple 'what if X increases/decreases by Y%' questions and run
    the scenario engine, then ask Bedrock to narrate the result.
    """
    import re
    # Detect pattern: "what if <category> increase/decrease by <N>%"
    pattern = re.compile(
        r"what\s+if\s+(.+?)\s+(increase|decrease|rises?|falls?|drops?)\s+by\s+(\d+(?:\.\d+)?)\s*%",
        re.IGNORECASE,
    )
    m = pattern.search(question)
    if not m:
        return None  # not a scenario question; let normal flow handle it

    subject  = m.group(1).strip()
    direction = m.group(2).lower()
    pct       = float(m.group(3))
    change    = pct if "increase" in direction or "rise" in direction else -pct

    # Match subject to known categories or departments
    CATEGORY_MAP = {
        "salary":      "Personnel & Salaries",
        "salaries":    "Personnel & Salaries",
        "personnel":   "Personnel & Salaries",
        "travel":      "Travel & Conferences",
        "technology":  "Technology & Equipment",
        "tech":        "Technology & Equipment",
        "research":    "Research Operations",
        "consulting":  "Consulting & Contracts",
        "maintenance": "Maintenance & Repairs",
        "scholarship": "Student Scholarships",
        "admin":       "Administrative Costs",
        "administrative": "Administrative Costs",
    }

    matched_cat = None
    for keyword, cat_name in CATEGORY_MAP.items():
        if keyword in subject.lower():
            matched_cat = cat_name
            break

    if not matched_cat:
        return None  # can't match; fall through to normal Bedrock call

    try:
        sc_result = run_scenario(
            [{"type": "category", "name": matched_cat, "change_pct": change}],
            scenario_name=f"{matched_cat} {'+' if change > 0 else ''}{change}%",
        )
        sm = sc_result["summary"]
        sc_ctx = {
            "scenario_name":     sc_result["scenario_name"],
            "period":            sm["period"],
            "baseline_total_6m": _safe(sm["baseline_total_6m"]),
            "adjusted_total_6m": _safe(sm["adjusted_total_6m"]),
            "difference_usd":    _safe(sm["difference_usd"]),
            "difference_pct":    _safe(sm["difference_pct"], 1),
            "series_affected":   sm["series_affected"],
            "note":              sm["note"],
        }
        # Narrate via Bedrock
        combined_ctx = {**context, "scenario_result": sc_ctx}
        narrative = ask_bedrock(question, combined_ctx, [])
        return narrative
    except Exception:
        return None  # fall through to normal call


# ── Main entry point ──────────────────────────────────────────────────────────

def answer_question(question: str, filters: dict, history: list) -> dict:
    """
    Full pipeline: build context → (optionally run scenario) → call Bedrock.

    Returns:
      {
        "answer": str,
        "context_summary": { top-level keys used },
        "model": str,
        "bedrock_available": bool,
        "error": str|None,
      }
    """
    ctx = build_context(filters)

    try:
        # Try scenario detection first
        scenario_answer = handle_scenario_question(question, ctx)
        if scenario_answer:
            return {
                "answer":          scenario_answer,
                "context_summary": list(ctx.keys()),
                "model":           BEDROCK_MODEL_ID,
                "bedrock_available": True,
                "error":           None,
            }

        # Normal Bedrock call
        answer = ask_bedrock(question, ctx, history)
        return {
            "answer":          answer,
            "context_summary": list(ctx.keys()),
            "model":           BEDROCK_MODEL_ID,
            "bedrock_available": True,
            "error":           None,
        }

    except BedrockUnavailableError as e:
        # Return a graceful fallback using only the context (no LLM)
        fallback = _rule_based_fallback(question, ctx)
        return {
            "answer":          fallback,
            "context_summary": list(ctx.keys()),
            "model":           "rule-based-fallback",
            "bedrock_available": False,
            "error":           str(e),
        }
    except Exception as e:
        logger.exception("Unexpected chatbot error")
        return {
            "answer":          "An unexpected error occurred. Please try again.",
            "context_summary": [],
            "model":           BEDROCK_MODEL_ID,
            "bedrock_available": False,
            "error":           str(e),
        }


# ── Rule-based fallback (no Bedrock) ──────────────────────────────────────────

def _rule_based_fallback(question: str, ctx: dict) -> str:
    """
    When Bedrock is unavailable, produce a structured text answer
    using only the pre-computed context dict.
    """
    q = question.lower()
    lines = []

    kpi = ctx.get("kpi", {})
    filters_active = ctx.get("active_filters", {})
    filter_str = ", ".join(f"{k}={v}" for k, v in filters_active.items()) if filters_active else "all data"

    lines.append(f"📊 **Financial Summary** ({filter_str})")

    if kpi:
        lines.append(
            f"Budget: ${kpi.get('total_budget', 0):,.0f}  |  "
            f"Actual: ${kpi.get('total_actual', 0):,.0f}  |  "
            f"Variance: ${kpi.get('total_variance_usd', 0):+,.0f} "
            f"({kpi.get('total_variance_pct', 0):+.1f}%)"
        )
        lines.append(f"Anomalies: {kpi.get('anomaly_count', 0)} ({kpi.get('anomaly_rate_pct', 0):.1f}%)")

    if "anomal" in q or "spike" in q or "overrun" in q:
        anom_sum = ctx.get("anomaly_summary", {})
        lines.append(f"\n⚑ **Anomaly Breakdown**")
        for t, c in (anom_sum.get("by_type") or {}).items():
            lines.append(f"  {t}: {c}")
        top = ctx.get("top_anomalies", [])
        if top:
            lines.append("\nTop anomalies:")
            for a in top[:3]:
                synth = " [synthetic]" if a.get("synthetic") else ""
                lines.append(
                    f"  • {a['department']} · {a['category']} · {a['month']}: "
                    f"Actual ${a['actual']:,.0f}, Budget ${a['budget']:,.0f}, "
                    f"Variance ${a['variance_usd']:+,.0f} ({a['variance_pct']:+.1f}%){synth}"
                )

    elif "department" in q or "dept" in q:
        lines.append("\n🏛 **Department Variances (top 5)**")
        for d in (ctx.get("departments") or [])[:5]:
            lines.append(
                f"  {d['department']}: Actual ${d['actual']:,.0f}, "
                f"Variance ${d['variance_usd']:+,.0f} ({d['variance_pct']:+.1f}%)"
            )

    elif "forecast" in q:
        fc = ctx.get("forecast", {})
        if "error" not in fc and "note" not in fc:
            lines.append(f"\n📈 **Forecast ({fc.get('period')})**")
            lines.append(f"Model: {fc.get('model_used')}  |  6-month total: ${fc.get('total_gb_6m', 0):,.0f}")
            lines.append(f"Validation MAE: ${fc.get('gb_val_mae', 0):,.0f}  |  WAPE: {fc.get('gb_val_wape_pct', 0):.1f}%")
            lines.append("⚠ Based on synthetic historical data — illustrative only.")
        else:
            lines.append("\nForecast not yet generated. Run the forecast first.")

    lines.append(
        "\n_Note: Amazon Bedrock is not currently available. "
        "Showing a structured data summary instead. "
        "Configure AWS credentials and BEDROCK_MODEL_ID to enable AI explanations._"
    )

    return "\n".join(lines)
