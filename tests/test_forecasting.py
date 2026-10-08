import numpy as np
import pytest

import catalog
from forecasting.cv import compute_confidence_label, rolling_origin_cv, select_best, smape
from forecasting.forecast import REFUSAL, forecastable_entities, ratio_series, run_forecast
from forecasting.models import ALL_MODELS, SeasonalNaive, available_models

SYN = np.array([1.08, 1.0, 0.95, 0.96, 1.03, 1.02, 0.96, 0.92, 1.01, 1.04, 0.91, 1.04])


@pytest.mark.parametrize("cls", ALL_MODELS, ids=lambda c: c.name)
def test_all_models_produce_intervals(cls):
    r = cls().fit(SYN).forecast(4)
    assert r.point.shape == (4,)
    for lo, hi in ((r.pi_80_low, r.pi_80_high), (r.pi_95_low, r.pi_95_high)):
        assert np.all(lo <= r.point + 1e-12) and np.all(hi >= r.point - 1e-12)
    assert np.all(r.pi_95_high - r.pi_95_low >= r.pi_80_high - r.pi_80_low - 1e-9)
    assert np.all(r.pi_95_high - r.pi_95_low > 0)
    assert np.all((r.pi_95_high - r.pi_95_low) > (r.pi_80_high - r.pi_80_low) + 1e-9), 'intervals must be nested and distinct'


def test_models_are_deterministic():
    a = ALL_MODELS[0]().fit(SYN).forecast(4)
    b = ALL_MODELS[0]().fit(SYN).forecast(4)
    assert np.array_equal(a.pi_95_low, b.pi_95_low)


def test_seasonal_naive_requires_8_quarters():
    with pytest.raises(ValueError):
        SeasonalNaive().fit(SYN[:7])
    assert SeasonalNaive not in available_models(7) and SeasonalNaive in available_models(8)
    assert SeasonalNaive().fit(SYN[:8]).forecast(4, intervals=False).point.tolist() == SYN[4:8].tolist()


def test_cv_fold_counts():
    assert rolling_origin_cv(SYN[:8]) == {}
    cv = rolling_origin_cv(SYN[:9])
    assert cv and all(v["folds"] == 1 for v in cv.values())
    cv = rolling_origin_cv(SYN)
    assert all(v["folds"] == 4 for v in cv.values()) and "SeasonalNaive" in cv
    assert select_best(cv) in cv


def test_cv_naive_matches_hand_calculation():
    cv = rolling_origin_cv(SYN, [ALL_MODELS[0]])
    expected = np.mean([abs(SYN[i] - SYN[i - 1]) for i in range(8, 12)])
    assert cv["Naive"]["mae"] == pytest.approx(expected)
    assert smape(np.array([1.0]), np.array([1.0])) == 0


@pytest.mark.parametrize("n,mae,sm,w,expected", [
    (6, 0.01, 1.0, 0.1, "Low"), (8, 0.01, 1.0, 0.1, "Low"), (9, 0.01, 1.0, 0.1, "Low"),
    (12, 0.15, 5.0, 0.1, "Low"), (12, 0.14, 5.0, 0.1, "Medium"), (12, 0.04, 9.0, 0.1, "High"),
    (12, 0.04, 9.0, 0.31, "Medium"), (12, 0.04, 30.0, 0.1, "Low"), (12, 0.04, 10.0, 0.1, "Medium"),
    (10, 0.05, 9.0, 0.1, "Medium"), (12, None, None, 0.1, "Low"),
])
def test_confidence_label_logic(n, mae, sm, w, expected):
    assert compute_confidence_label(n, mae, sm, w) == expected


@pytest.fixture
def ds(client):
    def make(variant):
        did = client.post("/upload/sample", params={"variant": variant}).json()["dataset_id"]
        return did, catalog.connect_dataset(did)
    return make


@pytest.mark.slow
def test_run_forecast_total(ds):
    did, conn = ds("original")
    r = run_forecast(conn, did, "total")
    assert r.confidence_label in ("High", "Medium", "Low") and len(r.points) == 4
    assert [p.forecast_quarter for p in r.points] == ["FY2027 Q1", "FY2027 Q2", "FY2027 Q3", "FY2027 Q4"]
    assert all(p.dollar_forecast is not None and p.dollar_pi_95_low is not None for p in r.points)
    assert r.dollar_forecast_available and r.stl_available and r.n_quarters == 12
    p = r.points[0]
    assert p.dollar_forecast == pytest.approx(p.ratio_forecast * r.planned_budget_total)


@pytest.mark.slow
@pytest.mark.parametrize("variant,expected", [("original", 33), ("enhanced", 43)])
def test_all_entities_forecast(ds, variant, expected):
    did, conn = ds(variant)
    ents = forecastable_entities(conn)
    assert len(ents) == expected
    for level, name in ents:
        r = run_forecast(conn, did, level, name)
        assert len(r.points) == 4 and r.model_name and not r.entity_not_found, (level, name)
        assert all(np.isfinite(p.ratio_forecast) for p in r.points)


@pytest.mark.slow
def test_dept_x_category_refusal(ds):
    did, conn = ds("original")
    r = run_forecast(conn, did, "dept_x_category", "College of Medicine | Consulting & Contracts")
    assert r.refusal == REFUSAL and r.points == [] and r.cv_mae is None


@pytest.mark.slow
def test_forecast_persisted_and_cached(ds):
    did, conn = ds("original")
    a = run_forecast(conn, did, "department", "College of Medicine")
    assert conn.execute("SELECT COUNT(*) FROM forecast_results").fetchone()[0] == 4
    b = run_forecast(conn, did, "department", "College of Medicine")
    assert a.model_dump() == b.model_dump()
    c = run_forecast(conn, did, "department", "College of Medicine", planned_budget_total=1_000_000.0)
    assert c.planned_budget_total == 1_000_000.0 and c.points[0].dollar_forecast == pytest.approx(c.points[0].ratio_forecast * 1e6)
    assert conn.execute("SELECT COUNT(*) FROM forecast_results").fetchone()[0] == 4


@pytest.mark.slow
def test_entity_not_found(ds):
    did, conn = ds("original")
    assert run_forecast(conn, did, "department", "Nope").entity_not_found is True


@pytest.mark.slow
def test_liberal_arts_low_confidence(ds):
    did, conn = ds("original")
    assert len(ratio_series(conn, "department", "College of Liberal Arts & Sciences")) == 6
    r = run_forecast(conn, did, "department", "College of Liberal Arts & Sciences")
    assert r.confidence_label == "Low" and r.cv_mae is None and r.stl_available is False
    assert "6 quarters" in r.stl_note


@pytest.mark.slow
def test_travel_conferences_no_seasonal_naive(ds):
    did, conn = ds("original")
    assert len(ratio_series(conn, "category", "Travel & Conferences")) == 7
    r = run_forecast(conn, did, "category", "Travel & Conferences")
    assert r.model_name != "SeasonalNaive" and r.confidence_label == "Low" and not r.stl_available
