"""Rolling-origin cross-validation and confidence labelling (design §5.4, §5.5)."""

from __future__ import annotations

import os
import warnings

import numpy as np

from forecasting.models import available_models

MIN_TRAIN = 8
MAX_FOLDS = 4


def _env(name: str, default: float) -> float:
    return float(os.environ.get(name, default))


def smape(actual: np.ndarray, pred: np.ndarray) -> float:
    denom = (np.abs(actual) + np.abs(pred)) / 2
    return float(100 * np.mean(np.where(denom == 0, 0.0, np.abs(pred - actual) / np.where(denom == 0, 1, denom))))


def rolling_origin_cv(series, models=None, min_train: int = MIN_TRAIN, max_folds: int = MAX_FOLDS) -> dict:
    """Return {model_name: {"mae", "smape", "folds"}} for the models that could be fitted on every fold.

    Fold i trains on the first (min_train + i - 1) points and predicts the next one. Needs >= min_train + 1
    points; otherwise the result is empty.
    """
    y = np.asarray(series, float)
    n = len(y)
    n_folds = min(max_folds, n - min_train)
    if n_folds < 1:
        return {}
    models = models if models is not None else available_models(n)
    results = {}
    for cls in models:
        errs, preds, acts = [], [], []
        try:
            for i in range(n_folds):
                end = min_train + i
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore")
                    f = cls().fit(y[:end]).forecast(1, intervals=False).point[0]
                preds.append(f)
                acts.append(y[end])
        except Exception:
            continue
        preds, acts = np.array(preds), np.array(acts)
        results[cls.name] = {"mae": float(np.mean(np.abs(preds - acts))), "smape": smape(acts, preds), "folds": n_folds}
    return results


def select_best(cv_results: dict) -> str | None:
    """Lowest MAE wins; sMAPE breaks exact ties."""
    if not cv_results:
        return None
    return min(cv_results, key=lambda m: (round(cv_results[m]["mae"], 12), cv_results[m]["smape"]))


def compute_confidence_label(n_quarters: int, cv_mae: float | None, cv_smape: float | None,
                             pi_95_width: float | None) -> str:
    """Decision table of §5.5, evaluated in order (first match wins)."""
    mae_hi, mae_lo = _env("FORECAST_MAE_HIGH", 0.05), _env("FORECAST_MAE_LOW", 0.15)
    sm_hi, sm_lo = _env("FORECAST_SMAPE_HIGH", 10.0), _env("FORECAST_SMAPE_LOW", 30.0)
    width_med = _env("FORECAST_PI_WIDTH_MEDIUM", 0.3)
    if n_quarters < 9 or n_quarters == 9 or cv_mae is None or cv_smape is None:
        return "Low"  # <9: cannot score; 9: single fold, capped at Low
    if cv_mae >= mae_lo or cv_smape >= sm_lo:
        return "Low"
    if cv_mae < mae_hi and cv_smape < sm_hi:
        return "Medium" if (pi_95_width is not None and pi_95_width > width_med) else "High"
    return "Medium"
