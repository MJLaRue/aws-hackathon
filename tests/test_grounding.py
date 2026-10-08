import logging

import pytest

from agent.grounding import extract_numerics, run_grounding_check


def test_grounding_flag_triggers():
    """$204,000 is fabricated; 13.5% matches variance_pct_agg 13.52 (design §7.2 fixture plus the tool's real pct field)."""
    results = [{"tool": "query_actuals", "rows": [{"total_actual": 108693.0, "total_budget": 804131.0, "variance_pct_agg": 13.52}]}]
    text = "College of Architecture is over budget by $204,000, which represents a 13.5% overrun."
    flags = run_grounding_check(text, results)
    assert "$204,000" in flags["failed_values"] and len(flags["failed_values"]) == 1 and flags["flagged"]


def test_llm_cannot_pass_a_number_by_deriving_it():
    """13.5% is not in a result that only has actual and budget: deriving it is a SYS-01 violation and is flagged."""
    results = [{"tool": "query_actuals", "rows": [{"total_actual": 108693.0, "total_budget": 804131.0}]}]
    assert "13.5%" in run_grounding_check("A 13.5% overrun.", results)["failed_values"]


def test_grounding_exact_dollar_boundary():
    results = [{"tool": "query_actuals", "rows": [{"variance_usd": 108693.0}]}]
    assert run_grounding_check("The overrun was $108,694.", results)["failed_values"] == []
    assert run_grounding_check("The overrun was $108,693.", results)["failed_values"] == []
    assert run_grounding_check("The overrun was $108,695.", results)["failed_values"] == ["$108,695"]
    assert run_grounding_check("The overrun was $109,000.", results)["failed_values"] == ["$109,000"]


def test_abbreviated_dollar_M():
    r = [{"v": 1203552.4}]
    assert run_grounding_check("Spend was $1.2M.", r)["failed_values"] == []
    assert run_grounding_check("Spend was $1.3M.", r)["failed_values"] == ["$1.3M"]
    assert run_grounding_check("Spend was $1.15M.", [{"v": 1150000.0}])["failed_values"] == []
    for ok in (1150000, 1249999):
        assert run_grounding_check("$1.2M", [{"v": ok}])["failed_values"] == []
    for bad in (1149999, 1250000):
        assert run_grounding_check("$1.2M", [{"v": bad}])["failed_values"] == ["$1.2M"]


def test_abbreviated_dollar_K():
    # §7.1 table: $108K matches [107,500, 108,499]. (The design's T26 example of 108,693 -> "$108K" contradicts
    # its own table, since 108.693 rounds to 109; the table governs, so $109K is the grounded form of 108,693.)
    r = [{"v": 108300.0}]
    assert run_grounding_check("Variance of $108K.", r)["failed_values"] == []
    assert run_grounding_check("Variance of $109K.", r)["failed_values"] == ["$109K"]
    assert run_grounding_check("Variance of $109K.", [{"v": 108693.0}])["failed_values"] == []
    assert run_grounding_check("Variance of $108K.", [{"v": 108693.0}])["failed_values"] == ["$108K"]
    for ok in (107500, 108499):
        assert run_grounding_check("$108K", [{"v": ok}])["failed_values"] == []
    for bad in (107499, 108500):
        assert run_grounding_check("$108K", [{"v": bad}])["failed_values"] == ["$108K"]


def test_percentage_tolerance():
    r = [{"variance_pct_agg": 13.52}]
    assert run_grounding_check("Up 13.5%.", r)["failed_values"] == []
    assert run_grounding_check("Up 13.6%.", r)["failed_values"] == ["13.6%"]
    assert run_grounding_check("Up 13.57%.", r)["failed_values"] == []
    assert run_grounding_check("Under by 13.5%.", [{"variance_pct_agg": -13.52}])["failed_values"] == []


def test_fractional_fields_match_percent():
    assert run_grounding_check("45% of reports had errors.", [{"pct_with_errors": 0.45}])["failed_values"] == []
    assert run_grounding_check("45% of reports.", [{"unrelated": 0.45}])["failed_values"] == ["45%"]


def test_fiscal_period_literal():
    r = [{"period_a": {"fiscal_year": "FY2024", "fiscal_quarter": "Q3"}}, {"forecast_quarter": "FY2027 Q1"}]
    assert run_grounding_check("In FY2024 Q3 and FY2027 Q1 spend moved.", r)["failed_values"] == []
    assert run_grounding_check("In FY2025 Q3 spend moved.", r)["failed_values"] == ["FY2025 Q3"]


def test_bare_integers_and_decimals():
    r = [{"total_rows": 300, "z_score": 4.123, "n": 17}]
    assert run_grounding_check("Of 300 rows, 17 were flagged with z 4.1.", r)["failed_values"] == []
    assert run_grounding_check("18 were flagged.", r)["failed_values"] == ["18"]
    assert run_grounding_check("z of 4.2", r)["failed_values"] == ["4.2"]


def test_non_numerics_are_ignored():
    text = "1. BUD-00237 in FY2024 and 2024 for Q3 of M-000018:\n2) done"
    assert extract_numerics(text) == []


def test_no_overlap_between_patterns():
    kinds = [(n["raw_str"], n["numeric_type"]) for n in extract_numerics("$1.2M, $108,693, 13.5%, 17 in FY2024 Q3")]
    assert kinds == [("$1.2M", "abbreviated_dollar"), ("$108,693", "bare_dollar"), ("13.5%", "percentage"),
                     ("17", "bare_integer"), ("FY2024 Q3", "fiscal_period")]


def test_trailing_punctuation_not_captured():
    assert extract_numerics("It was $108,693, then 4.")[0]["raw_str"] == "$108,693"


def test_logging_has_no_values(caplog):
    with caplog.at_level(logging.WARNING, logger="grounding"):
        run_grounding_check("Overrun $204,000.", [{"x": 1.0}], turn_id="t1")
    msgs = " ".join(r.getMessage() for r in caplog.records)
    assert "1 value(s) unverified in turn t1" in msgs and "204" not in msgs


def test_evidence_from_dispatched_tool(client):
    """A real tool result grounds its own numbers; an invented one does not."""
    import catalog
    from tools.dispatcher import dispatch_tool
    did = client.post("/upload/sample", params={"variant": "original"}).json()["dataset_id"]
    conn = catalog.connect_dataset(did)
    out = dispatch_tool("query_actuals", {"entity_level": "category", "entity_name": "Consulting & Contracts"}, conn, did)
    row = out["rows"][0]
    good = f"Consulting & Contracts variance was {row['variance_pct_agg']:.1f}% (${row['variance_usd']:,.0f})."
    assert run_grounding_check(good, [out])["failed_values"] == []
    assert run_grounding_check(good + " That is 99.9% of plan.", [out])["failed_values"] == ["99.9%"]


# ------------------------------------------------------------------ live loop + grounding (T41)
def _live(dataset_id, script, caplog=None):
    import asyncio
    from agent import loop
    from conftest import FakeBedrock, parse_sse

    async def go():
        return [c async for c in loop.run_agent_loop("g", dataset_id, "q", [], bedrock_client=FakeBedrock(script))]

    return parse_sse("".join(asyncio.run(go())))


def test_live_fabricated_value_flagged(sample_dataset, monkeypatch, caplog):
    from conftest import text_events, tool_events
    monkeypatch.setenv("BEDROCK_MODEL_ID", "m")
    caplog.set_level(logging.DEBUG)
    script = [tool_events("get_reporting_health", {"grouping": "total"}), text_events("Total spend was $204,000 last year.")]
    events = _live(sample_dataset, script)
    flag = next(e for e in events if isinstance(e, dict) and e["type"] == "grounding_flag")
    assert any("204" in str(v) for v in flag["failed_values"])
    assert "grounding_ok" not in [e["type"] for e in events if isinstance(e, dict)]
    assert "204,000" not in caplog.text and "$204" not in caplog.text


def test_live_grounded_value_ok(sample_dataset, monkeypatch):
    from conftest import text_events, tool_events
    monkeypatch.setenv("BEDROCK_MODEL_ID", "m")
    script = [tool_events("get_reporting_health", {"grouping": "total"}), text_events("Reports average 16.6 days to produce across 418 rows.")]
    events = _live(sample_dataset, script)
    assert any(isinstance(e, dict) and e["type"] == "grounding_ok" for e in events)
