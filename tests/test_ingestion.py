import io

import duckdb
import pandas as pd
import pytest
from fastapi import HTTPException

from ingestion.pipeline import (
    MAX_UPLOAD_BYTES,
    detect_and_parse,
    run_ingestion_pipeline,
    suggest_column_mapping,
    validate_mapping,
)
from ingestion.schema import CANONICAL_COLUMNS, CREATE_TABLE_SQL, PERIOD_MAP, derive_period_index


def make_test_row(**over):
    row = {
        "record_id": "T-0001", "department": "Dept A", "budget_category": "Cat A",
        "fiscal_year": "FY2024", "fiscal_quarter": "Q1", "fund_source": "General",
        "report_type": "Quarterly", "budgeted_amount_usd": 100.0, "actual_spend_usd": 110.0,
        "variance_usd": 10.0, "variance_pct": 10.0,
    }
    row.update(over)
    return row


def test_schema_ddl_matches_canonical_columns():
    conn = duckdb.connect(":memory:")
    conn.execute(CREATE_TABLE_SQL)
    assert [r[0] for r in conn.execute("DESCRIBE budget_records").fetchall()] == CANONICAL_COLUMNS
    assert len(CANONICAL_COLUMNS) == 31


def test_period_map_has_12_periods():
    assert sorted(PERIOD_MAP.values()) == list(range(1, 13))
    df = derive_period_index(pd.DataFrame({"fiscal_year": ["FY2024", "FY2023"], "fiscal_quarter": ["Q2", "Q1"]}))
    assert df["period_index"].tolist()[0] == 2 and pd.isna(df["period_index"].tolist()[1])


def test_column_mapping_suggestion():
    cols = ["Department", "Budget_Category", "fiscal_year", "FISCAL_QUARTER", "budgeted_amount_usd",
            "actual_spend_usd", "mystery"]
    s = suggest_column_mapping(cols)
    assert s["Department"] == "department" and s["Budget_Category"] == "category"
    assert s["budgeted_amount_usd"] == "budget" and s["actual_spend_usd"] == "actual"
    assert s["mystery"] is None
    assert validate_mapping(s) == []
    assert validate_mapping({"a": "department"}) == ["fiscal_year", "fiscal_quarter", "category", "budget", "actual"]


def test_unmapped_period_row_accepted(tmp_duckdb):
    rows = [make_test_row(), make_test_row(record_id="T-0002", fiscal_year="FY2023")]
    report = run_ingestion_pipeline(rows, db=tmp_duckdb)
    assert report.rows_rejected == 0
    assert report.rows_unmapped_period == 1
    conn = duckdb.connect(tmp_duckdb)
    assert conn.execute("SELECT period_index FROM budget_records WHERE fiscal_year='FY2023'").fetchone()[0] is None


def test_invalid_rows_rejected_and_duplicate_record_id(tmp_duckdb):
    rows = [make_test_row(), make_test_row(), make_test_row(record_id="T-3", budgeted_amount_usd="n/a")]
    report = run_ingestion_pipeline(rows, db=tmp_duckdb)
    assert report.total_rows == 3 and report.rows_accepted == 1 and report.rows_rejected == 2


def test_missing_required_columns_422(tmp_duckdb):
    with pytest.raises(HTTPException) as exc:
        run_ingestion_pipeline([{"department": "x", "foo": 1}], db=tmp_duckdb)
    assert exc.value.status_code == 422 and "budget" in exc.value.detail["missing"]


def test_validation_report_sample_data(original_schema_xlsx, tmp_duckdb):
    report = run_ingestion_pipeline(pd.read_excel(original_schema_xlsx), db=tmp_duckdb)
    assert report.rows_accepted == 60 and report.rows_rejected == 0
    assert (report.department_count, report.category_count, report.fund_source_count) == (16, 10, 6)
    assert report.variance_usd_mismatches == 0
    assert {f.code for f in report.dq_findings} >= {
        "variance_zero_nonzero_pct", "source_forecast_gap", "duplicate_keys",
        "anomaly_sign_inconsistency", "variance_pct_cap", "rows_at_plus_cap"}


def test_bud_00018_dq_finding(original_schema_xlsx, tmp_duckdb):
    report = run_ingestion_pipeline(pd.read_excel(original_schema_xlsx), db=tmp_duckdb)
    f = next(f for f in report.dq_findings if f.code == "variance_zero_nonzero_pct")
    assert "BUD-00018" in f.record_ids


def test_duplicate_key_warning(original_schema_xlsx, tmp_duckdb):
    report = run_ingestion_pipeline(pd.read_excel(original_schema_xlsx), db=tmp_duckdb)
    assert report.duplicate_key_combos >= 1 and report.duplicate_key_rows >= 2
    assert any(f.code == "duplicate_keys" and "duplicate" in f.message for f in report.dq_findings)


def test_rows_at_plus_cap_always_reported(original_schema_xlsx, tmp_duckdb):
    report = run_ingestion_pipeline(pd.read_excel(original_schema_xlsx), db=tmp_duckdb)
    assert next(f for f in report.dq_findings if f.code == "rows_at_plus_cap").message == "Rows at +50 cap: 0"


def test_enhanced_fixture_coverage_and_exclusions(fixture_xlsx, tmp_duckdb):
    report = run_ingestion_pipeline(pd.read_excel(fixture_xlsx), db=tmp_duckdb)
    assert (report.department_count, report.category_count, report.fund_source_count) == (21, 14, 7)
    assert report.rows_excluded_from_totals >= 1 and report.rows_synthetic >= 3
    conn = duckdb.connect(tmp_duckdb)
    total = conn.execute("SELECT COUNT(*) FROM budget_records").fetchone()[0]
    assert conn.execute("SELECT COUNT(*) FROM budget_totals").fetchone()[0] == total - report.rows_excluded_from_totals


def test_original_schema_defaults(original_schema_xlsx, tmp_duckdb):
    run_ingestion_pipeline(pd.read_excel(original_schema_xlsx), db=tmp_duckdb)
    conn = duckdb.connect(tmp_duckdb)
    assert conn.execute("SELECT COUNT(*) FROM budget_records WHERE include_in_totals AND NOT is_synthetic "
                        "AND source_record_id = record_id AND month IS NULL").fetchone()[0] == 60


def test_xlsx_detection(fixture_xlsx):
    df = detect_and_parse(fixture_xlsx.read_bytes(), "whatever.dat")
    assert len(df) == 66


def test_csv_detection():
    assert detect_and_parse(b"a,b\n1,2\n", "x.csv").shape == (1, 2)


def test_csv_latin1_fallback():
    df = detect_and_parse("dept,note\nA,caf\xe9\n".encode("latin-1"), "x.csv")
    assert df["note"].iloc[0] == "caf\xe9"


def test_file_too_large_rejected():
    with pytest.raises(HTTPException) as exc:
        detect_and_parse(b"x" * (MAX_UPLOAD_BYTES + 1), "big.csv")
    assert exc.value.status_code == 413


def test_upload_confirm_flow(client):
    csv = ("department,budget_category,fiscal_year,fiscal_quarter,budgeted_amount_usd,actual_spend_usd\n"
           "A,B,FY2024,Q1,10,12\n")
    r = client.post("/upload", files={"file": ("t.csv", csv.encode())}, data={"dataset_name": "t"})
    assert r.status_code == 200 and r.json()["unmapped_required"] == []
    p = r.json()
    r = client.post("/upload/confirm", json={"dataset_name": "t", "upload_id": p["upload_id"], "mapping": p["suggestions"]})
    assert r.status_code == 200 and r.json()["report"]["rows_accepted"] == 1
    assert [d["name"] for d in client.get("/datasets").json()] == ["t"]


def test_upload_confirm_missing_fields_422(client):
    r = client.post("/upload", files={"file": ("t.csv", b"a,b\n1,2\n")}, data={"dataset_name": "t"})
    p = r.json()
    r = client.post("/upload/confirm", json={"dataset_name": "t", "upload_id": p["upload_id"], "mapping": {"a": "department"}})
    assert r.status_code == 422


def test_upload_confirm_rejects_bad_upload_id(client):
    assert client.post("/upload/confirm", json={"dataset_name": "t", "upload_id": "../x", "mapping": {}}).status_code == 404


@pytest.mark.slow
def test_sample_upload_returns_300_rows(client):
    r = client.post("/upload/sample", params={"variant": "original"})
    assert r.status_code == 200
    rep = r.json()["report"]
    assert rep["rows_accepted"] == 300 and (rep["department_count"], rep["category_count"], rep["fund_source_count"]) == (16, 10, 6)
    assert (rep["duplicate_key_combos"], rep["duplicate_key_rows"]) == (23, 47)


@pytest.mark.slow
def test_sample_upload_enhanced_default(client):
    r = client.post("/upload/sample")
    rep = r.json()["report"]
    assert rep["rows_accepted"] == 1154 and rep["rows_excluded_from_totals"] == 7 and rep["rows_synthetic"] == 360
    assert (rep["department_count"], rep["category_count"], rep["fund_source_count"]) == (21, 14, 7)
