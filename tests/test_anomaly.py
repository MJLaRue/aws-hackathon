import pytest

from analysis.anomaly import compute_confusion_matrix, detect_anomalies, detect_persistent_patterns

GT_IDS = {
    "BUD-00237", "BUD-00189", "BUD-00176", "BUD-00005", "BUD-00190", "BUD-00285", "BUD-00213",
    "BUD-00267", "BUD-00160", "BUD-00156", "BUD-00228", "BUD-00293", "BUD-00087", "BUD-00202",
    "BUD-00116", "BUD-00028", "BUD-00241",
}

pytestmark = pytest.mark.slow


def test_anomaly_ground_truth(full_df):
    """Original file: all 17 GT rows flagged, <= 5 extras (Rev 5 hybrid rule, design §0.5)."""
    flagged = detect_anomalies(full_df, sensitivity=2.5)
    ids = set(flagged["record_id"])
    assert GT_IDS <= ids, f"Missed: {GT_IDS - ids}"
    extra = ids - GT_IDS
    assert len(extra) <= 5, f"Too many extra flags: {extra}"
    assert extra == {"BUD-00061", "BUD-00081", "BUD-00299"}


def test_anomaly_ground_truth_enhanced(enhanced_df):
    """Enhanced file: GT matched by source_record_id; synthetic flags reported separately."""
    flagged = detect_anomalies(enhanced_df, sensitivity=2.5)
    real = flagged[~flagged["is_synthetic"].astype(bool)]
    src = set(real["source_record_id"])
    assert GT_IDS <= src, f"Missed: {GT_IDS - src}"
    extra = src - GT_IDS
    assert len(extra) <= 5
    assert extra == {"BUD-00032", "BUD-00081", "BUD-00148", "BUD-00299"}
    assert int(flagged["is_synthetic"].astype(bool).sum()) == 15


def test_pure_zscore_rule_documented_defect(full_df):
    """Regression guard for the Rev 4 defect: z-only at 2.5 misses ground-truth rows."""
    ids = set(detect_anomalies(full_df, sensitivity=2.5, abs_floor=None)["record_id"])
    assert len(GT_IDS - ids) == 9


def test_detector_reason_and_severity(full_df):
    f = detect_anomalies(full_df)
    assert set(f["detector_reason"]) <= {"zscore", "abs_floor", "both"}
    row = f[f["record_id"] == "BUD-00237"].iloc[0]
    assert row["severity"] == "high" and row["variance_pct"] == -50.0
    assert f["source_anomaly_flag"].notna().all()


def test_detector_source_agreement(full_df):
    ids = set(detect_anomalies(full_df)["record_id"])
    cm = compute_confusion_matrix(ids, full_df)
    assert sum(cm.values()) == len(full_df) == 300
    assert cm["tp"] + cm["fn"] == len(ids)


def test_sensitivity_is_configurable(full_df):
    loose = len(detect_anomalies(full_df, sensitivity=1.5))
    strict = len(detect_anomalies(full_df, sensitivity=4.0))
    assert loose > strict >= 17


def _find(patterns, etype, name, direction):
    m = [p for p in patterns if p["entity_type"] == etype and p["entity_name"] == name and p["direction"] == direction]
    return m[0] if m else None


def test_persistent_pattern_sign_consistency(full_df):
    for p in detect_persistent_patterns(full_df):
        sign = 1 if p["direction"] == "over" else -1
        assert all(sign * p["per_year_variance"][y] > 0 for y in p["qualifying_years"]), p["entity_name"]


def test_clas_fy2025_excluded_from_over_qualifying_years(full_df):
    clas = [p for p in detect_persistent_patterns(full_df)
            if p["entity_name"] == "College of Liberal Arts & Sciences" and p["direction"] == "over"]
    assert len(clas) == 1 and "FY2025" not in clas[0]["qualifying_years"]


@pytest.mark.parametrize("name,direction,expected", [
    ("Consulting & Contracts", "over", {"FY2024": 16.1, "FY2025": 13.9, "FY2026": 14.7}),
    ("Travel & Conferences", "under", {"FY2024": -17.9, "FY2025": -14.1, "FY2026": -9.8}),
    ("Administrative Overhead", "under", {"FY2024": -22.5, "FY2025": -7.1, "FY2026": -5.0}),
    ("Facility Maintenance", "over", {"FY2024": 10.5, "FY2025": 6.1, "FY2026": -13.1}),
])
def test_persistent_category_values(full_df, name, direction, expected):
    p = _find(detect_persistent_patterns(full_df), "category", name, direction)
    assert p is not None
    for fy, v in expected.items():
        assert abs(p["per_year_variance"][fy] - v) < 0.1


def test_admin_overhead_boundary_qualifies(full_df):
    p = _find(detect_persistent_patterns(full_df), "category", "Administrative Overhead", "under")
    assert p["qualifying_years"] == ["FY2024", "FY2025", "FY2026"]


def test_facility_maintenance_reversal(full_df):
    p = _find(detect_persistent_patterns(full_df), "category", "Facility Maintenance", "over")
    assert p["qualifying_years"] == ["FY2024", "FY2025"] and p["per_year_variance"]["FY2026"] < -13


def test_persistent_patterns_full_dataset(full_df):
    got = {(p["entity_type"], p["entity_name"], p["direction"]): p["qualifying_years"]
           for p in detect_persistent_patterns(full_df)}
    all3, a, b, c = ["FY2024", "FY2025", "FY2026"], ["FY2024", "FY2025"], ["FY2025", "FY2026"], ["FY2024", "FY2026"]
    expected = {
        ("category", "Consulting & Contracts", "over"): all3, ("category", "Equipment & Technology", "over"): b,
        ("category", "Facility Maintenance", "over"): a, ("category", "Student Aid & Scholarships", "over"): b,
        ("category", "Travel & Conferences", "under"): all3, ("category", "Professional Development", "under"): all3,
        ("category", "Administrative Overhead", "under"): all3, ("category", "Research Operations", "under"): b,
        ("department", "College of Architecture", "over"): all3, ("department", "College of Pharmacy", "over"): all3,
        ("department", "Office of Research", "over"): c, ("department", "College of Applied Health Sciences", "over"): a,
        ("department", "College of Liberal Arts & Sciences", "over"): c,
        ("department", "College of Education", "under"): a, ("department", "College of Medicine", "under"): c,
        ("department", "College of Nursing", "under"): b, ("department", "College of Urban Planning", "under"): c,
        ("department", "Graduate College", "under"): b, ("department", "College of Business Administration", "under"): c,
    }
    assert got == expected


def test_persistent_patterns_enhanced(enhanced_df):
    got = {(p["entity_type"], p["entity_name"], p["direction"]) for p in detect_persistent_patterns(enhanced_df)}
    assert ("category", "Research Operations", "under") not in got
    assert ("department", "College of Pharmacy", "over") in got
    pharm = _find(detect_persistent_patterns(enhanced_df), "department", "College of Pharmacy", "over")
    assert pharm["qualifying_years"] == ["FY2024", "FY2026"]
    assert len(got) == 18  # 7 categories + 11 departments (tests/ground_truth_enhanced.md §4)
