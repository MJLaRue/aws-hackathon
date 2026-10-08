"""Permitted forecasting models (design §5.3, §5.6). No Prophet, no deep learning.

Implemented on numpy/statsmodels so behaviour does not depend on the statsforecast release
(the design allows the statsmodels ETS fallback). Intervals: bootstrap over training residuals
(1000 paths, fixed seed) for Naive / Drift / SeasonalNaive / ETS, analytic OLS interval for LinearTrend.
Series are the spend-vs-budget ratio per observed quarter, oldest first.
"""

from __future__ import annotations

import warnings
from dataclasses import dataclass

import numpy as np
from scipy import stats

N_BOOT = 1000
SEED = 42
SEASON = 4
MIN_SEASONAL_QUARTERS = 8


@dataclass
class ForecastResult:
    point: np.ndarray
    pi_80_low: np.ndarray
    pi_80_high: np.ndarray
    pi_95_low: np.ndarray
    pi_95_high: np.ndarray


def _from_paths(point: np.ndarray, paths: np.ndarray) -> ForecastResult:
    """Quantile intervals from simulated paths (n_paths x horizon), widened to always contain the point."""
    lo80, hi80 = np.percentile(paths, [10, 90], axis=0)
    lo95, hi95 = np.percentile(paths, [2.5, 97.5], axis=0)
    return ForecastResult(point, np.minimum(lo80, point), np.maximum(hi80, point),
                          np.minimum(lo95, point), np.maximum(hi95, point))


def _bootstrap_walk(base: np.ndarray, resid: np.ndarray, steps: np.ndarray, rng) -> np.ndarray:
    """paths[b, k] = base[k] + sum of steps[k] resampled residuals (random-walk error accumulation).

    Smoothed bootstrap: each draw adds Gaussian noise with a Silverman-rule bandwidth. With only a handful of
    training residuals a plain bootstrap is discrete and would give identical 80% and 95% bounds.
    """
    resid = resid[np.isfinite(resid)]
    if resid.size == 0:
        resid = np.zeros(1)
    sd = float(np.std(resid, ddof=1)) if resid.size > 1 else 0.0
    iqr = float(np.subtract(*np.percentile(resid, [75, 25])))
    spread = min(sd, iqr / 1.34) if iqr > 0 else sd
    bw = 0.9 * spread * resid.size ** (-0.2)
    h = len(base)
    out = np.empty((N_BOOT, h))
    for k in range(h):
        draws = rng.choice(resid, size=(N_BOOT, int(steps[k]))) + rng.normal(0.0, bw, size=(N_BOOT, int(steps[k])))
        out[:, k] = base[k] + draws.sum(axis=1)
    return out


class Naive:
    name = "Naive"

    def fit(self, y):
        self.y = np.asarray(y, float)
        if len(self.y) < 2:
            raise ValueError("Naive needs at least 2 observations")
        return self

    def forecast(self, h, intervals=True):
        point = np.repeat(self.y[-1], h)
        if not intervals:
            return ForecastResult(point, point, point, point, point)
        rng = np.random.default_rng(SEED)
        return _from_paths(point, _bootstrap_walk(point, np.diff(self.y), np.arange(1, h + 1), rng))


class Drift:
    name = "Drift"

    def fit(self, y):
        self.y = np.asarray(y, float)
        if len(self.y) < 3:
            raise ValueError("Drift needs at least 3 observations")
        self.d = (self.y[-1] - self.y[0]) / (len(self.y) - 1)
        return self

    def forecast(self, h, intervals=True):
        steps = np.arange(1, h + 1)
        point = self.y[-1] + self.d * steps
        if not intervals:
            return ForecastResult(point, point, point, point, point)
        rng = np.random.default_rng(SEED)
        return _from_paths(point, _bootstrap_walk(point, np.diff(self.y) - self.d, steps, rng))


class SeasonalNaive:
    name = "SeasonalNaive"

    def fit(self, y):
        self.y = np.asarray(y, float)
        if len(self.y) < MIN_SEASONAL_QUARTERS:
            raise ValueError(f"SeasonalNaive requires >= {MIN_SEASONAL_QUARTERS} quarters, got {len(self.y)}")
        return self

    def forecast(self, h, intervals=True):
        n = len(self.y)
        steps = np.arange(1, h + 1)
        point = np.array([self.y[n - SEASON + ((k - 1) % SEASON)] for k in steps])
        if not intervals:
            return ForecastResult(point, point, point, point, point)
        rng = np.random.default_rng(SEED)
        resid = self.y[SEASON:] - self.y[:-SEASON]
        return _from_paths(point, _bootstrap_walk(point, resid, np.ceil(steps / SEASON), rng))


class LinearTrend:
    name = "LinearTrend"

    def fit(self, y):
        self.y = np.asarray(y, float)
        n = len(self.y)
        if n < 3:
            raise ValueError("LinearTrend needs at least 3 observations")
        self.x = np.arange(n, dtype=float)
        self.slope, self.intercept = np.polyfit(self.x, self.y, 1)
        resid = self.y - (self.intercept + self.slope * self.x)
        self.s = float(np.sqrt(resid @ resid / (n - 2)))
        self.sxx = float(((self.x - self.x.mean()) ** 2).sum())
        return self

    def forecast(self, h, intervals=True):
        n = len(self.y)
        xs = np.arange(n, n + h, dtype=float)
        point = self.intercept + self.slope * xs
        if not intervals:
            return ForecastResult(point, point, point, point, point)
        se = self.s * np.sqrt(1 + 1 / n + (xs - self.x.mean()) ** 2 / self.sxx)
        t80, t95 = stats.t.ppf(0.90, n - 2), stats.t.ppf(0.975, n - 2)
        return ForecastResult(point, point - t80 * se, point + t80 * se, point - t95 * se, point + t95 * se)


class ETSDampedTrend:
    """Additive-error, additive damped-trend, non-seasonal exponential smoothing (statsmodels)."""
    name = "ETS"

    def fit(self, y):
        from statsmodels.tsa.holtwinters import ExponentialSmoothing
        self.y = np.asarray(y, float)
        if len(self.y) < 5:
            raise ValueError("ETS needs at least 5 observations")
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            self.res = ExponentialSmoothing(self.y, trend="add", damped_trend=True, seasonal=None,
                                            initialization_method="estimated").fit()
        return self

    def forecast(self, h, intervals=True):
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            point = np.asarray(self.res.forecast(h), float)
            if not intervals:
                return ForecastResult(point, point, point, point, point)
            paths = np.asarray(self.res.simulate(h, repetitions=N_BOOT, error="add",
                                                 random_errors="bootstrap", random_state=SEED))
        return _from_paths(point, paths.reshape(h, -1).T)


ALL_MODELS = (Naive, SeasonalNaive, Drift, ETSDampedTrend, LinearTrend)


def available_models(n_quarters: int) -> list:
    """Model classes permitted for a series of this length (SeasonalNaive needs >= 8 quarters)."""
    return [m for m in ALL_MODELS if m is not SeasonalNaive or n_quarters >= MIN_SEASONAL_QUARTERS]
