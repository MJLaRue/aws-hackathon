import pytest

import catalog
from analysis.health import DESCRIPTIVE_NOTE, get_reporting_health
from analysis.kpis import get_kpis
from analysis.variance import build_variance_query, explain_variance, query_entity_rows


@pytest.fixture
def loaded(client):
    """(dataset_id, conn) for the original and enhanced sample files."""
    def make(variant):
        did = client.post("/upload/sample", params={"variant": variant}).json()["dataset_id"]
        return did, catalog.connect_dataset(did)
    return make


@pytest.mark.slow
def test_explain_variance_cc(loaded):
    did, conn = loaded("original")
    r = explain_variance(conn, did, "category", "Consulting & Contracts")
    assert abs(r.total_variance_pct - 14.85) < 0.05
    assert len(r.top_department_contributors) <= 5 and len(r.top_record_contributors) <= 10
    assert 0 <= r.persistent_pattern_share <= 1 and 0 <= r.one_time_outlier_share <= 1
    assert len(r.quarterly_time_series) == 11  # C&C has no rows in one of the 12 quarters
    assert r.fund_source_split and abs(sum(f.share_of_total_variance for f in r.fund_source_split) - 1) < 1e-9


@pytest.mark.slow
def test_explain_variance_entity_not_found(loaded):
    did, conn = loaded("original")
    assert explain_variance(conn, did, "department", "Nope").entity_not_found is True


@pytest.mark.slow
def test_explain_variance_flags_bud_00018_dq(loaded):
    did, conn = loaded("original")
    r = explain_variance(conn, did, "total")
    ids = {x.record_id for x in r.top_record_contributors}
    assert (("BUD-00018" in ids) == any("BUD-00018" in w for w in r.dq_warnings))


def test_build_variance_query_levels():
    for lvl in ("total", "department", "category", "fund_source", "dept_x_category"):
        sql, _ = build_variance_query(lvl)
        assert "budget_totals" in sql and "NULLIF(SUM(budget), 0)" in sql
    sql, params = build_variance_query("department", "X", fiscal_year="FY2025", period_index_from=2)
    assert params == ["X", "FY2025", 2] and "period_index IS NOT NULL" in sql


@pytest.mark.slow
def test_kpi_panel_matches_query_actuals(loaded):
    for variant, top in (("original", "College of Architecture"), ("enhanced", "College of Architecture")):
        did, conn = loaded(variant)
        kpi = get_kpis(conn, did)
        rows = query_entity_rows(conn, "department")
        assert kpi.top_over_departments[0].entity_name == top
        tool_row = next(r for r in rows if r["entity_name"] == top)
        assert abs(kpi.top_over_departments[0].variance_pct_agg - tool_row["variance_pct_agg"]) < 0.01
        assert kpi.anomaly_count > 0 and len(kpi.fiscal_year_summary) == 3
        fy = get_kpis(conn, did, "FY2025")
        assert fy.fiscal_year_filter == "FY2025" and len(fy.fiscal_year_summary) == 3


@pytest.mark.slow
def test_kpis_endpoint(client):
    did = client.post("/upload/sample", params={"variant": "original"}).json()["dataset_id"]
    r = client.get("/kpis", params={"dataset_id": did})
    assert r.status_code == 200 and abs(r.json()["total_variance_pct"] + 2.2) < 1.0
    assert client.get("/kpis", params={"dataset_id": "nope"}).status_code == 404


@pytest.mark.slow
def test_descriptive_only_enforcement(loaded):
    from agent.prompts import DESCRIPTIVE_ONLY, SYSTEM_PROMPT
    assert "DESCRIPTIVE ONLY" in SYSTEM_PROMPT and DESCRIPTIVE_ONLY in SYSTEM_PROMPT
    did, conn = loaded("enhanced")
    r = get_reporting_health(conn, did, "department")
    assert r.rows and "causal" in r.descriptive_note.lower() and r.descriptive_note == DESCRIPTIVE_NOTE
    assert "causal" in r.model_dump()["descriptive_note"].lower()


@pytest.mark.slow
def test_health_dedupes_to_source_records(loaded):
    did, conn = loaded("original")
    total = get_reporting_health(conn, did, "total").rows[0]
    assert total.row_count == 300 and total.group_value is None
    did2, conn2 = loaded("enhanced")
    t2 = get_reporting_health(conn2, did2, "total").rows[0]
    assert t2.row_count < 794 + 360 and 0 <= t2.pct_delayed <= 1 and 0 <= t2.pct_with_errors <= 1
    assert get_reporting_health(conn2, did2, "report_type", "NoSuch").rows == []


# ---------------------------------------------------------------- tool schemas + dispatcher (T22/T23)
from tools.definitions import TOOL_NAMES, TOOL_SCHEMAS  # noqa: E402
from tools.dispatcher import ToolError, dispatch_tool  # noqa: E402


def test_tool_schemas():
    assert len(TOOL_SCHEMAS) == 7 and TOOL_NAMES == [
        "list_entities", "query_actuals", "run_forecast", "detect_anomalies", "compare_periods", "explain_variance", "get_reporting_health"]
    by = {t["name"]: t for t in TOOL_SCHEMAS}
    assert "never compute these numbers yourself" in by["query_actuals"]["description"]
    assert "never compute these numbers yourself" in by["compare_periods"]["description"]
    assert "DESCRIPTIVE ONLY" in by["get_reporting_health"]["description"]
    assert "dept_x_category" not in by["run_forecast"]["inputSchema"]["json"]["properties"]["entity_level"]["enum"]


SAMPLE_CALLS = [
    ("list_entities", {}),
    ("query_actuals", {"entity_level": "department"}),
    ("query_actuals", {"entity_level": "category", "entity_name": "Consulting & Contracts", "fiscal_year": "FY2025"}),
    ("run_forecast", {"entity_level": "total"}),
    ("detect_anomalies", {"entity_level": "total"}),
    ("compare_periods", {"entity_level": "total", "period_a": {"fiscal_year": "FY2024", "fiscal_quarter": "Q1"},
                         "period_b": {"fiscal_year": "FY2025", "fiscal_quarter": "Q1"}}),
    ("explain_variance", {"entity_level": "category", "entity_name": "Consulting & Contracts"}),
    ("get_reporting_health", {"grouping": "department"}),
]


@pytest.mark.slow
@pytest.mark.parametrize("variant", ["original", "enhanced"])
def test_all_tools_dispatch(loaded, variant):
    import json
    did, conn = loaded(variant)
    for name, inp in SAMPLE_CALLS:
        out = dispatch_tool(name, {**inp, "dataset_id": "ignored-by-dispatcher"}, conn, did)
        json.dumps(out)  # JSON-serialisable
    assert dispatch_tool("list_entities", {}, conn, did)["entities"]["total_rows"] in (300, 1154)


@pytest.mark.slow
def test_dispatch_query_actuals_matches_variance_helper(loaded):
    did, conn = loaded("original")
    out = dispatch_tool("query_actuals", {"entity_level": "category", "entity_name": "Consulting & Contracts"}, conn, did)
    row = out["rows"][0]
    assert abs(row["variance_pct_agg"] - 14.85) < 0.05 and row["row_count"] > 0 and "budget_totals" in out["query_sql"]
    assert dispatch_tool("query_actuals", {"entity_level": "department", "entity_name": "Nope"}, conn, did)["entity_not_found"] is True
    with pytest.raises(ToolError):
        dispatch_tool("query_actuals", {"entity_level": "total", "period_index_from": 5, "period_index_to": 2}, conn, did)


@pytest.mark.slow
def test_dispatch_query_actuals_dq_warning_bud_00018(loaded):
    did, conn = loaded("original")
    out = dispatch_tool("query_actuals", {"entity_level": "total"}, conn, did)
    assert any("BUD-00018" in w for w in out["rows"][0]["dq_warnings"]) and any("capped" in w for w in out["rows"][0]["dq_warnings"])


@pytest.mark.slow
def test_dispatch_compare_periods(loaded):
    did, conn = loaded("original")
    a, b = {"fiscal_year": "FY2024", "fiscal_quarter": "Q1"}, {"fiscal_year": "FY2025", "fiscal_quarter": "Q1"}
    out = dispatch_tool("compare_periods", {"entity_level": "total", "period_a": a, "period_b": b}, conn, did)
    assert out["actual_delta_usd"] == pytest.approx(out["period_b"]["actual"] - out["period_a"]["actual"])
    assert out["variance_pct_delta"] == pytest.approx(out["period_b"]["variance_pct_agg"] - out["period_a"]["variance_pct_agg"])
    missing = dispatch_tool("compare_periods", {"entity_level": "total", "period_a": a,
                                                "period_b": {"fiscal_year": "FY2027", "fiscal_quarter": "Q1"}}, conn, did)
    assert missing["period_not_found"] == ["FY2027 Q1"] and missing["actual_delta_usd"] is None
    with pytest.raises(ToolError):
        dispatch_tool("compare_periods", {"entity_level": "total", "period_a": a, "period_b": a}, conn, did)


@pytest.mark.slow
def test_dispatch_detect_anomalies_ground_truth_and_scope(loaded):
    did, conn = loaded("original")
    out = dispatch_tool("detect_anomalies", {"entity_level": "total"}, conn, did)
    ids = {a["record_id"] for a in out["anomalies"]}
    assert {"BUD-00237", "BUD-00241", "BUD-00156"} <= ids and out["total_records_scanned"] == 300
    cm = out["confusion_matrix"]
    assert sum(cm.values()) == 300
    scoped = dispatch_tool("detect_anomalies", {"entity_level": "category", "entity_name": "Professional Development"}, conn, did)
    assert scoped["anomalies"] and all(a["category"] == "Professional Development" for a in scoped["anomalies"])
    assert all(p["entity_name"] == "Professional Development" for p in scoped["persistent_patterns"])
    with pytest.raises(ToolError):
        dispatch_tool("detect_anomalies", {"entity_level": "total", "sensitivity": 9}, conn, did)


@pytest.mark.slow
def test_dispatch_forecast_refusal_and_unknown(loaded):
    did, conn = loaded("original")
    out = dispatch_tool("run_forecast", {"entity_level": "dept_x_category", "entity_name": "A | B"}, conn, did)
    assert out["refusal"].startswith("Department × Category forecasting is not supported") and out["points"] == []
    with pytest.raises(ToolError):
        dispatch_tool("drop_tables", {}, conn, did)


def test_system_prompt_constraints():
    from agent.prompts import SYSTEM_PROMPT as P
    low = P.lower()
    assert "before making at least one tool call" in low                 # (a)
    assert "insufficient data" in low                                     # (b)
    assert "too short to forecast" in low and "stl_available" in P       # (c)
    assert "hypothesis" in low                                            # (d)
    assert "dollar_forecast_available is false" in P and "refusal" in low
    assert "never compute, estimate" in low                               # SYS-01


# ------------------------------------------------------------------ agent loop (T27, T45) with mocked Bedrock
import asyncio
import json as _j

from conftest import FakeBedrock, FakeClientError, parse_sse, text_events, tool_events, types as _types

NO_NUMBERS = "That office does not appear in this dataset, so there is insufficient data to answer."


def _run_loop(dataset_id, message, script, history=None, **kw):
    from agent import loop
    fake = FakeBedrock(script)
    hist = [] if history is None else history

    async def go():
        return [c async for c in loop.run_agent_loop("s1", dataset_id, message, hist, bedrock_client=fake, **kw)]

    chunks = asyncio.run(go())
    return parse_sse("".join(chunks)), fake, hist


@pytest.fixture
def model_env(monkeypatch):
    monkeypatch.setenv("BEDROCK_MODEL_ID", "test-model")


def test_agent_loop_mock_bedrock(sample_dataset, model_env):
    script = [tool_events("list_entities", {"dataset_id": "ignored"}, lead_text="Checking entities. "),
              text_events(NO_NUMBERS)]
    events, fake, hist = _run_loop(sample_dataset, "What did the Bursar's office spend?", script)
    t = _types(events)
    assert t[0] == "token" and "tool_call" in t and "tool_result" in t
    assert t.index("tool_call") < t.index("tool_result") < len(t) - 3
    assert t[-3:] == ["grounding_ok", "sources", "[DONE]"]
    first = fake.calls[0]
    assert first["inferenceConfig"] == {"maxTokens": 2048, "temperature": 0.0}
    assert len(first["toolConfig"]["tools"]) == 7
    assert sample_dataset in first["system"][0]["text"]
    # tool result fed back on iteration 2
    assert "toolResult" in fake.calls[1]["messages"][-2]["content"][0]
    # compact history: user + final assistant text only
    assert [m["role"] for m in hist] == ["user", "assistant"]
    assert "toolUse" not in _j.dumps(hist)
    src = next(e for e in events if isinstance(e, dict) and e["type"] == "sources")
    assert src["calls"][0]["tool"] == "list_entities"


def test_dispatcher_overrides_model_dataset_id(sample_dataset, model_env):
    script = [tool_events("list_entities", {"dataset_id": "does-not-exist"}), text_events(NO_NUMBERS)]
    events, _, _ = _run_loop(sample_dataset, "q", script)
    res = next(e for e in events if isinstance(e, dict) and e["type"] == "tool_result")
    assert "error" not in res["summary"].lower()


def test_retry_backoff(sample_dataset, model_env, monkeypatch):
    sleeps = []
    monkeypatch.setattr("time.sleep", lambda s: sleeps.append(s))
    script = [FakeClientError("ThrottlingException"), FakeClientError("ServiceUnavailableException"), text_events(NO_NUMBERS)]
    events, fake, _ = _run_loop(sample_dataset, "q", script)
    assert sleeps == [1, 2] and len(fake.calls) == 3
    assert _types(events)[-1] == "[DONE]" and "error" not in _types(events)


def test_retry_exhausted_emits_error(sample_dataset, model_env, monkeypatch):
    monkeypatch.setattr("time.sleep", lambda s: None)
    script = [FakeClientError("ThrottlingException")] * 4
    events, fake, hist = _run_loop(sample_dataset, "q", script)
    assert len(fake.calls) == 4
    assert _types(events) == ["error", "[DONE]"] and hist == []


def test_max_iterations_warning(sample_dataset, model_env):
    script = [tool_events("list_entities", {}, tool_id=f"t{i}") for i in range(10)]
    events, fake, _ = _run_loop(sample_dataset, "q", script)
    assert len(fake.calls) == 10
    assert any(isinstance(e, dict) and e["type"] == "warning" and "maximum" in e["message"] for e in events)
    assert _types(events)[-1] == "[DONE]"


def test_max_tokens_warning(sample_dataset, model_env):
    events, _, _ = _run_loop(sample_dataset, "q", [text_events(NO_NUMBERS, stop="max_tokens")])
    assert any(isinstance(e, dict) and e["type"] == "warning" and "token limit" in e["message"] for e in events)


def test_missing_model_id_and_unknown_dataset(sample_dataset, monkeypatch):
    monkeypatch.delenv("BEDROCK_MODEL_ID", raising=False)
    events, _, _ = _run_loop(sample_dataset, "q", [])
    assert _types(events) == ["error", "[DONE]"]
    events, _, _ = _run_loop("nope", "q", [])
    assert _types(events) == ["error", "[DONE]"]


def test_chat_endpoint_with_mock_bedrock(client, sample_dataset, model_env, monkeypatch):
    fake = FakeBedrock([text_events(NO_NUMBERS)])
    monkeypatch.setattr("agent.loop.make_bedrock_client", lambda: fake)
    r = client.post("/chat", json={"session_id": "e2e", "dataset_id": sample_dataset, "message": "hi"})
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/event-stream")
    assert _types(parse_sse(r.text))[-1] == "[DONE]"


def test_bursar_live_path(sample_dataset, model_env):
    script = [tool_events("list_entities", {}), text_events(NO_NUMBERS)]
    events, _, _ = _run_loop(sample_dataset, "What did the Bursar's office spend on travel?", script)
    text = "".join(e["text"] for e in events if isinstance(e, dict) and e["type"] == "token")
    assert "insufficient data" in text and "$" not in text
    assert "grounding_ok" in _types(events)


def test_bursar_replay_trace():
    from agent import loop

    async def go():
        return [c async for c in loop.run_agent_loop("s", "sample", "What did the Bursar's office spend on travel?", [], replay_mode=True)]

    events = parse_sse("".join(asyncio.run(go())))
    text = "".join(e["text"] for e in events if isinstance(e, dict) and e["type"] == "token")
    assert "insufficient data" in text.lower() and "$" not in text
    assert "College of Engineering" in text or "IT Services" in text
    assert "grounding_ok" in _types(events)


def test_kpi_panel_matches_query_actuals(client, sample_dataset):
    """§3.7 invariant: KPI panel and chat tools produce identical numbers."""
    from tools.dispatcher import dispatch_tool
    kpi = client.get("/kpis", params={"dataset_id": sample_dataset}).json()
    top = kpi["top_over_departments"][0]
    assert top["entity_name"] == "College of Architecture"
    conn = catalog.connect_dataset(sample_dataset)
    try:
        res = dispatch_tool("query_actuals", {"entity_level": "department", "entity_name": top["entity_name"]},
                            conn, sample_dataset)
    finally:
        conn.close()
    rows = [r for r in res["rows"] if r["entity_name"] == top["entity_name"]]
    assert rows
    actual = sum(r["total_actual"] for r in rows)
    budget = sum(r["total_budget"] for r in rows)
    assert abs(actual - top["total_actual"]) < 0.01 and abs(budget - top["total_budget"]) < 0.01
    assert abs((actual - budget) / budget * 100 - top["variance_pct_agg"]) < 0.01
    assert abs(kpi["total_actual"] - sum(r["total_actual"] for r in dispatch_tool(
        "query_actuals", {"entity_level": "total"}, catalog.connect_dataset(sample_dataset), sample_dataset)["rows"])) < 0.01


def test_explain_variance_stl_gating(client, sample_dataset):
    from tools.dispatcher import dispatch_tool
    conn = catalog.connect_dataset(sample_dataset)
    try:
        ok = dispatch_tool("explain_variance", {"entity_level": "department", "entity_name": "College of Architecture"}, conn, sample_dataset)
        short = dispatch_tool("explain_variance", {"entity_level": "category", "entity_name": "Travel & Conferences"}, conn, sample_dataset)
    finally:
        conn.close()
    assert ok["stl_available"] and all("stl_trend" in p for p in ok["quarterly_time_series"])
    assert not short["stl_available"] and "7 quarters" in short["stl_note"]
    assert all("stl_trend" not in p for p in short["quarterly_time_series"])


def test_dashboard_endpoints(client, sample_dataset):
    p = {"dataset_id": sample_dataset}
    a = client.get("/anomalies", params=p).json()
    assert a["anomalies"] and set(a["confusion_matrix"]) == {"tp", "fp", "fn", "tn"}
    v = client.get("/variance", params={**p, "entity_level": "department", "entity_name": "College of Architecture"}).json()
    assert v["stl_available"] and v["quarterly_time_series"]
    b = client.get("/benchmark", params=p).json()
    assert b["mean_gap"] is not None and b["caveat"] and "not used as a model input" in b["caveat"]
    assert (b["mean_gap"] < 5) == ("unusually close" in b["caveat"])
    mc = b["model_comparison"]
    assert mc and sum(m["selected"] for m in mc) == 1 and mc[0]["selected"] and mc == sorted(mc, key=lambda m: m["cv_mae"])
    assert mc[0]["model"] == b["model_name"] and mc[0]["cv_mae"] == pytest.approx(b["cv_mae"])
    assert sum(g["rows"] for g in b["gap_histogram"]) == b["source_rows_compared"]
    assert 0 <= b["gap_under_1pct_share"] <= 1 and b["gap_median"] <= b["max_gap"]
    assert client.get("/benchmark", params={"dataset_id": "nope"}).status_code == 404
    assert client.get("/anomalies", params={**p, "entity_level": "bogus"}).status_code == 422


def test_benchmark_caveat_branches():
    from analysis.dashboard import caveat_text
    assert "unusually close" in caveat_text(4.1, 14.46)
    assert "upper-bound" in caveat_text(8.0, 20.0) and caveat_text(None, None) is None


def test_error_hints_for_config_problems(sample_dataset, model_env):
    for code, text in [("AccessDeniedException", "model access"), ("ValidationException", "BEDROCK_MODEL_ID"),
                       ("UnrecognizedClientException", "credentials")]:
        events, _, _ = _run_loop(sample_dataset, "q", [FakeClientError(code)])
        assert text in events[0]["message"]


def test_temperature_rejected_retries_without_it(sample_dataset, model_env):
    err = FakeClientError("ValidationException")
    err.response["Error"]["Message"] = "temperature is not supported for this model"
    events, fake, _ = _run_loop(sample_dataset, "q", [err, text_events(NO_NUMBERS)])
    assert "temperature" in fake.calls[0]["inferenceConfig"] and "temperature" not in fake.calls[1]["inferenceConfig"]
    assert "error" not in _types(events) and _types(events)[-1] == "[DONE]"
