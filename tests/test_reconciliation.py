"""Reconciliation tests (design §11.4 + Rev 5 §0.9). Original file: Rev 4 numbers. Enhanced: tests/ground_truth_enhanced.md."""
import pytest

pytestmark = pytest.mark.slow


def agg(df, col, val):
    sub = df[df[col] == val]
    return (sub["actual"].sum() / sub["budget"].sum() - 1) * 100


# ---------------------------- original file (Team6Dataset.xlsx) ----------------------------
def test_row_count(full_df):
    assert len(full_df) == 300


def test_dimensions(full_df):
    assert (full_df["department"].nunique(), full_df["category"].nunique(), full_df["fund_source"].nunique()) == (16, 10, 6)


def test_forecast_accuracy_pct_mean(full_df):
    assert abs(full_df["forecast_accuracy_pct"].mean() - 95.91) < 0.05


@pytest.mark.parametrize("fy,expected", [("FY2024", -1.0), ("FY2025", -2.6), ("FY2026", -3.1)])
def test_fy_variance(full_df, fy, expected):
    assert abs(agg(full_df, "fiscal_year", fy) - expected) < 0.1


@pytest.mark.parametrize("cat,expected", [
    ("Consulting & Contracts", 14.8), ("Travel & Conferences", -14.8), ("Professional Development", -12.6),
    ("Administrative Overhead", -10.4), ("Research Operations", -8.9), ("Facility Maintenance", -5.2),
    ("Supplies & Materials", 3.6), ("Personnel & Salaries", 3.4), ("Student Aid & Scholarships", 2.3),
    ("Equipment & Technology", 5.5),
])
def test_category_variance(full_df, cat, expected):
    assert abs(agg(full_df, "category", cat) - expected) < 0.2


@pytest.mark.parametrize("dept,expected", [
    ("College of Architecture", 13.5), ("College of Pharmacy", 10.1), ("Office of Research", 7.9),
    ("College of Education", -10.9), ("School of Public Health", -10.8), ("College of Nursing", -9.8),
])
def test_department_variance(full_df, dept, expected):
    assert abs(agg(full_df, "department", dept) - expected) < 0.2


def test_natural_key_non_unique(full_df):
    k = ["department", "category", "fiscal_year", "fiscal_quarter"]
    g = full_df.groupby(k).size()
    assert (g > 1).sum() == 23 and g[g > 1].sum() == 47


def test_6col_key_unique(full_df):
    k = ["department", "category", "fiscal_year", "fiscal_quarter", "fund_source", "report_type"]
    assert len(full_df.drop_duplicates(k)) == 300


# ---------------------------- enhanced file ----------------------------
def test_enhanced_rows_and_dimensions(enhanced_df):
    assert len(enhanced_df) == 1147
    assert (enhanced_df["department"].nunique(), enhanced_df["category"].nunique(), enhanced_df["fund_source"].nunique()) == (21, 14, 7)
    assert enhanced_df["is_synthetic"].sum() == 360


@pytest.mark.parametrize("fy,expected", [("FY2024", 0.03), ("FY2025", -1.74), ("FY2026", -0.91)])
def test_enhanced_fy_variance(enhanced_df, fy, expected):
    assert abs(agg(enhanced_df, "fiscal_year", fy) - expected) < 0.1


@pytest.mark.parametrize("cat,expected", [
    ("Travel & Conferences", -14.81), ("Professional Development", -12.63), ("Consulting & Contracts", 12.67),
    ("Equipment & Technology", 6.19), ("Administrative Costs", 3.50), ("Technology & Equipment", 4.44),
])
def test_enhanced_category_variance(enhanced_df, cat, expected):
    assert abs(agg(enhanced_df, "category", cat) - expected) < 0.2


@pytest.mark.parametrize("dept,expected", [
    ("College of Architecture", 10.64), ("College of Education", -10.94), ("School of Public Health", -10.77),
    ("IT Services", 4.44), ("Research Institute", 5.95),
])
def test_enhanced_department_variance(enhanced_df, dept, expected):
    assert abs(agg(enhanced_df, "department", dept) - expected) < 0.2


def test_enhanced_quarterly_ratios(enhanced_df):
    expected = {(1,): 1.0861, (4,): 0.9588, (8,): 0.9200, (12,): 1.0371}
    g = enhanced_df.groupby("period_index")[["actual", "budget"]].sum()
    for (p,), v in expected.items():
        assert abs(g.loc[p, "actual"] / g.loc[p, "budget"] - v) < 0.0005


def test_enhanced_monthly_sums_match_quarterly(enhanced_df):
    """Monthly rows of a source record sum to the quarterly figures in the original file
    (excluding the 3 source records that have include_in_totals=FALSE months)."""
    import pandas as pd
    orig = pd.read_excel("data/Team6Dataset.xlsx").set_index("record_id")
    real = enhanced_df[~enhanced_df["is_synthetic"]].groupby("source_record_id")[["budget", "actual"]].sum()
    keep = real.index.intersection(orig.index).difference(["BUD-00038", "BUD-00069", "BUD-00007"])
    assert len(keep) == 297
    assert (real.loc[keep, "budget"] - orig.loc[keep, "budgeted_amount_usd"]).abs().max() < 1.0
    assert (real.loc[keep, "actual"] - orig.loc[keep, "actual_spend_usd"]).abs().max() < 1.0
