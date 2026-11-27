"""
60-minute glucose forecast (v2): direction, size and range.

The forecast is a sum of effects, as in the Loop system:
    food + insulin      textbook curves and the patient's ratios, times
                        EFFECT_SHARE (0.2)
    AI model            trend, time of day, heart rate, steps; trained on
                        what food and insulin do NOT explain
The chance of a spike or a low is read from the same predicted line and
range, so the numbers on screen can never disagree with the chart.

Why not v1 (carbs and insulin as model features): the patients inject for
big meals, so v1 gave +15 mg/dL for 15 g and only +6 for 90 g.

EFFECT_SHARE was chosen on held-out patients (60 min, readings at 15/30/60):
    share   error, all   error / bias, meals without insulin
    0.0     24.4         34.2 / +12.2
    0.2     24.5         33.2 /  -2.8   <- chosen
    0.3     24.9         34.1 / -10.4
    1.0     29.4         71.0 / -57.2

Design notes
------------
* CARB UNITS. The dataset stores carbs in servings (1 serving = 10 g), but a
  few patients are clearly recorded in grams, and some have no usable meal
  records. `carbs_in_grams` converts per patient; unusable ones count as 0.
* MISSING INPUTS. App users may have one finger-prick or a full CGM, with or
  without a watch. One model is trained on randomly masked copies of each
  sample and evaluated separately in each situation.
* HONEST TESTING. Folds are grouped by patient, and scores are averaged per
  patient, because one patient supplies over half of all rows.
* The model must not be used to choose insulin. Dose effects come from the
  insulin curve (dose_simulator).

Run:  python -m ml.train_forecast <dataset folder>
"""

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import GroupKFold

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from services.forecast_features import (  # noqa: E402
    CSF_DEFAULT, EFFECT_SHARE, FEATURES, GLUCOSE_LAGS, HORIZONS, ISF_DEFAULT, WEARABLE_FEATURES,
    probability_features,
)
from services.dose_simulator import carb_fraction_absorbed  # noqa: E402
from services.iob_engine import iob_fraction_remaining  # noqa: E402

OUT = ROOT / "models" / "forecast"
STEP = 5
MAX_ROWS_PER_PATIENT = 15000   # patient 27 alone has 165k rows
QUANTILES = (0.1, 0.5, 0.9)
SEED = 42

# No usable carb amounts: none recorded, or only a constant "1" meal marker.
NO_CARBS = {"HUPA0015P", "HUPA0018P", "HUPA0020P", "HUPA0019P", "HUPA0021P"}
# Median meal of 15 or more cannot be 10 g servings (150 g+ per entry): grams.
GRAMS_MEDIAN = 15.0


def carbs_in_grams(patient: str, carbs: np.ndarray) -> np.ndarray:
    if patient in NO_CARBS:
        return np.full_like(carbs, np.nan)
    eaten = carbs[carbs > 0]
    if len(eaten) == 0:
        return np.full_like(carbs, np.nan)
    return carbs if np.median(eaten) >= GRAMS_MEDIAN else carbs * 10.0


def rolling_sum(x: np.ndarray, steps: int) -> np.ndarray:
    """Sum over the current row and the `steps` rows before it."""
    return pd.Series(x).rolling(steps + 1, min_periods=1).sum().to_numpy()


def rolling_mean(x: np.ndarray, steps: int) -> np.ndarray:
    return pd.Series(x).rolling(steps + 1, min_periods=1).mean().to_numpy()


def build_patient(path: Path) -> pd.DataFrame:
    patient = path.stem
    df = pd.read_csv(path, sep=";", parse_dates=["time"]).sort_values("time").reset_index(drop=True)
    g = df["glucose"].to_numpy(float).copy()
    g[g <= 0] = np.nan
    carbs = carbs_in_grams(patient, df["carb_input"].fillna(0).to_numpy(float))
    bolus = df["bolus_volume_delivered"].fillna(0).to_numpy(float)
    hr = df["heart_rate"].to_numpy(float).copy()
    hr[hr <= 0] = np.nan
    steps = df["steps"].fillna(0).to_numpy(float)
    n = len(df)

    # Regular 5-minute stretches only: hours before and one hour ahead.
    gap = df["time"].diff().dt.total_seconds().div(60).fillna(5).to_numpy()
    broken = (gap > 7.5) | (gap <= 0)
    seg = np.cumsum(broken)

    # Food and insulin effects on the past `lag` and the next `h` minutes.
    ate = np.nan_to_num(carbs)
    basal = df["basal_rate"].fillna(0).to_numpy(float)
    daily_dose = (bolus.sum() + basal.sum()) / (n / 288)
    isf = 1800 / daily_dose if daily_dose > 5 else ISF_DEFAULT

    def effect(start, end):
        food = [carb_fraction_absorbed(i * STEP + end) - carb_fraction_absorbed(i * STEP + start) for i in range(50)]
        drop = [iob_fraction_remaining(i * STEP + start, 240) - iob_fraction_remaining(i * STEP + end, 240)
                for i in range(62)]
        return CSF_DEFAULT * np.convolve(ate, food)[:n] - isf * np.convolve(bolus, drop)[:n]

    f = {"current_bg": g}
    for lag in GLUCOSE_LAGS:
        k = lag // STEP
        prev = np.full(n, np.nan)
        prev[k:] = g[:-k]
        # The part of the past change that food and insulin do not explain.
        f[f"delta_{lag}"] = g - prev - EFFECT_SHARE * effect(-lag, 0)
    f["hr_15m"] = rolling_mean(hr, 3)
    f["hr_60m"] = rolling_mean(hr, 12)
    f["steps_15m"] = rolling_sum(steps, 3)
    f["steps_60m"] = rolling_sum(steps, 12)
    hour = df["time"].dt.hour.to_numpy() + df["time"].dt.minute.to_numpy() / 60
    f["hour_sin"] = np.sin(2 * np.pi * hour / 24)
    f["hour_cos"] = np.cos(2 * np.pi * hour / 24)

    out = pd.DataFrame(f)
    for h in HORIZONS:
        out[f"net_{h}"] = effect(0, h)
    out["logged"] = bool(daily_dose > 5 and basal.sum() > 0 and not np.isnan(carbs).all())
    out["uncovered"] = (rolling_sum(ate, 12) >= 25) & (rolling_sum(bolus, 36) == 0)
    future = np.full((n, 12), np.nan)
    for k in range(1, 13):
        future[:-k, k - 1] = g[k:]
    for h in HORIZONS:
        out[f"y_{h}"] = future[:, h // STEP - 1] - g
    peak, trough = np.nanmax(np.where(np.isnan(future), -np.inf, future), axis=1), \
        np.nanmin(np.where(np.isnan(future), np.inf, future), axis=1)
    out["y_spike"] = ((peak - g >= 40) | ((g < 180) & (peak >= 180))).astype(int)
    out["y_low"] = (trough < 70).astype(int)
    out["patient"] = patient

    idx = np.arange(n)
    ok = (idx >= 24) & (idx < n - 12)
    same = np.zeros(n, bool)
    inside = idx[ok]
    same[inside] = seg[inside - 24] == seg[inside + 12]
    ok &= same & ~np.isnan(g) & ~np.isnan(future).any(axis=1)
    out = out[ok]
    if len(out) > MAX_ROWS_PER_PATIENT:
        out = out.sample(MAX_ROWS_PER_PATIENT, random_state=SEED)
    return out.reset_index(drop=True)


# ------------------------------------------------------------- situations

def keep_lags(x: pd.DataFrame, lags) -> pd.DataFrame:
    x = x.copy()
    x[[f"delta_{l}" for l in GLUCOSE_LAGS if l not in lags]] = np.nan
    return x


def drop_wearable(x: pd.DataFrame) -> pd.DataFrame:
    x = x.copy()
    x[WEARABLE_FEATURES] = np.nan
    return x


SITUATIONS = {
    "cgm_watch": lambda x: x,
    "cgm": drop_wearable,
    "fingerstick_3": lambda x: drop_wearable(keep_lags(x, (15, 30, 60))),
    "fingerstick_1": lambda x: drop_wearable(keep_lags(x, (30,))),
    "single_watch": lambda x: keep_lags(x, ()),
    "single": lambda x: drop_wearable(keep_lags(x, ())),
}


def masked_training_set(x: pd.DataFrame, y: pd.DataFrame, w: np.ndarray, rng):
    """Two differently masked copies of every training row."""
    names = list(SITUATIONS)
    xs, ys, ws = [], [], []
    for _ in range(2):
        pick = rng.integers(0, len(names) + 1, len(x))
        for i, name in enumerate(names):
            m = pick == i
            xs.append(SITUATIONS[name](x[m])); ys.append(y[m]); ws.append(w[m])
        m = pick == len(names)            # one earlier reading at a random lag
        part = x[m].copy()
        lag = rng.choice(GLUCOSE_LAGS, len(part))
        for l in GLUCOSE_LAGS:
            part.loc[lag != l, f"delta_{l}"] = np.nan
        xs.append(part); ys.append(y[m]); ws.append(w[m])
    return pd.concat(xs), pd.concat(ys), np.concatenate(ws)


def patient_weights(p: pd.Series) -> np.ndarray:
    n = p.map(p.value_counts()).to_numpy(float)
    w = 1.0 / np.sqrt(n)
    return w / w.mean()


def fit_all(x, y, w):
    common = dict(max_iter=250, learning_rate=0.06, max_leaf_nodes=31, min_samples_leaf=150,
                  l2_regularization=1.0, random_state=SEED)
    models, line = {}, []
    for h in HORIZONS:
        net = EFFECT_SHARE * y[f"net_{h}"].to_numpy()
        for q in QUANTILES:
            name = f"q{int(q * 100)}_{h}"
            r = HistGradientBoostingRegressor(loss="quantile", quantile=q, **common)
            models[name] = r.fit(x[FEATURES], y[f"y_{h}"].to_numpy() - net, sample_weight=w)
            if h == 60:
                line.append(models[name].predict(x[FEATURES]) + net)
    zs, zl = probability_features(x.current_bg.to_numpy(), *np.sort(np.stack(line), axis=0))
    models["spike"] = LogisticRegression().fit(zs, y.y_spike, sample_weight=w)
    models["low"] = LogisticRegression().fit(zl, y.y_low, sample_weight=w)
    return models


def predict_all(models, x, net):
    out = {}
    for h in HORIZONS:
        raw = np.stack([models[f"q{int(q * 100)}_{h}"].predict(x[FEATURES]) for q in QUANTILES])
        raw = np.sort(raw, axis=0) + EFFECT_SHARE * net[f"net_{h}"].to_numpy()
        for q, values in zip(QUANTILES, raw):
            out[f"q{int(q * 100)}_{h}"] = values
    zs, zl = probability_features(x.current_bg.to_numpy(), out["q10_60"], out["q50_60"], out["q90_60"])
    out["spike"], out["low"] = models["spike"].predict_proba(zs)[:, 1], models["low"].predict_proba(zl)[:, 1]
    return out


def reach_factors(data, preds) -> dict:
    """[up, down] share of the textbook effect the range must allow for, so 9
    in 10 meals without insulin stay under the top edge and 9 in 10 hours
    with strong active insulin stay above the bottom edge."""
    up = (data.logged & data.uncovered).to_numpy(bool)
    out = {}
    for h in HORIZONS:
        y, net = data[f"y_{h}"].to_numpy(), data[f"net_{h}"].to_numpy()
        mid, hi, lo = (preds[f"q{q}_{h}"] for q in (50, 90, 10))
        down = data.logged.to_numpy(bool) & (net < -20)
        grid = np.arange(0, 1.01, 0.02)
        u = next((k for k in grid if (y[up] <= np.maximum(hi, mid + k * net)[up]).mean() >= 0.9), 1.0)
        d = next((k for k in grid if (y[down] >= np.minimum(lo, mid + k * net)[down]).mean() >= 0.9), 1.0)
        out[str(h)] = [round(float(u), 2), round(float(d), 2)]
    return out


def main(folder: str):
    data = pd.concat([build_patient(p) for p in sorted(Path(folder).glob("HUPA*.csv"))], ignore_index=True)
    print(len(data), "samples,", data.patient.nunique(), "patients", flush=True)
    targets = [f"y_{h}" for h in HORIZONS] + ["y_spike", "y_low"] + [f"net_{h}" for h in HORIZONS]
    rng = np.random.default_rng(SEED)

    preds = {s: {} for s in SITUATIONS}
    for s in SITUATIONS:
        for key in [f"q{int(q * 100)}_{h}" for h in HORIZONS for q in QUANTILES] + ["spike", "low"]:
            preds[s][key] = np.full(len(data), np.nan)

    for k, (tr, te) in enumerate(GroupKFold(5).split(data, groups=data.patient), 1):
        train = data.iloc[tr]
        x, y, w = masked_training_set(train[FEATURES], train[targets], patient_weights(train.patient), rng)
        models = fit_all(x, y, w)
        for s, mask in SITUATIONS.items():
            xt = mask(data.iloc[te][FEATURES])
            for key, values in predict_all(models, xt, data.iloc[te]).items():
                preds[s][key][te] = values
        print("fold", k, "done", flush=True)

    report, margins = {}, {}
    for s in SITUATIONS:
        report[s], margins[s] = {"horizons": {}}, {}
        for h in HORIZONS:
            y = data[f"y_{h}"].to_numpy()
            lo, mid, hi = (np.sort(np.stack([preds[s][f"q{q}_{h}"] for q in (10, 50, 90)]), axis=0))
            d = pd.DataFrame({"p": data.patient, "ae": abs(y - mid), "se": (y - mid) ** 2, "base": abs(y),
                              "cov": (y >= lo) & (y <= hi)})
            # Conformal margin: widen the band so 80 % of held-out values fall
            # inside it for the average patient.
            score = np.maximum(lo - y, y - hi)
            margin = float(np.mean([np.quantile(score[data.patient == p], 0.8) for p in data.patient.unique()]))
            margins[s][str(h)] = round(max(0.0, margin), 2)
            in_band = (y >= lo - margins[s][str(h)]) & (y <= hi + margins[s][str(h)])
            per = d.groupby("p").mean()
            per_cov = pd.Series(in_band).groupby(data.patient.values).mean()
            row = {
                "mae": per.ae.mean(), "rmse": np.sqrt(per.se).mean(), "mae_no_change": per.base.mean(),
                "coverage_raw": per["cov"].mean(), "coverage": per_cov.mean(), "coverage_worst_patient": per_cov.min(),
                "band_width": float(np.mean(hi - lo) + 2 * margins[s][str(h)]),
            }
            if h == 60:
                cls = lambda v: np.where(v >= 20, 1, np.where(v <= -20, -1, 0))
                hit = pd.Series(cls(y) == cls(mid)).groupby(data.patient.values).mean()
                row["direction_accuracy"] = hit.mean()
                row["direction_accuracy_always_steady"] = pd.Series(cls(y) == 0).groupby(data.patient.values).mean().mean()
                called = abs(mid) >= 20
                row["direction_right_when_called"] = float((np.sign(y[called]) == np.sign(mid[called])).mean())
                row["called_share"] = float(called.mean())
                um = (data.logged & data.uncovered).to_numpy(bool)
                row["uncovered_meals"] = int(um.sum())
                row["uncovered_mae"] = float(abs(y - mid)[um].mean())
                row["uncovered_bias"] = float((y - mid)[um].mean())
                row["uncovered_spike_said"] = float(preds[s]["spike"][um].mean())
                row["uncovered_spike_seen"] = float(data.y_spike[um].mean())
            report[s]["horizons"][str(h)] = {a: round(float(b), 3) for a, b in row.items()}
        for t in ("spike", "low"):
            y = data[f"y_{t}"].to_numpy()
            aucs = [roc_auc_score(y[data.patient == p], preds[s][t][data.patient == p])
                    for p in data.patient.unique() if 0 < y[data.patient == p].sum() < (data.patient == p).sum()]
            report[s][f"{t}_auc"] = round(float(np.mean(aucs)), 3)
            bins = pd.cut(preds[s][t], [0, .1, .2, .3, .4, .5, .7, 1])
            report[s][f"{t}_calibration"] = {
                str(b): [round(float(a), 3), round(float(o), 3), int(c)] for b, a, o, c in
                pd.DataFrame({"b": bins, "p": preds[s][t], "y": y}).groupby("b", observed=True)
                .agg(a=("p", "mean"), o=("y", "mean"), c=("y", "size")).reset_index().itertuples(index=False)}
        r60 = report[s]["horizons"]["60"]
        print(s, {h: (v["mae"], v["mae_no_change"]) for h, v in report[s]["horizons"].items()},
              "dir", r60["direction_accuracy"], "vs", r60["direction_accuracy_always_steady"],
              "called right", r60["direction_right_when_called"], "spike", report[s]["spike_auc"],
              "low", report[s]["low_auc"], "cov", r60["coverage"], r60["coverage_worst_patient"], flush=True)

    x, y, w = masked_training_set(data[FEATURES], data[targets], patient_weights(data.patient), rng)
    final = fit_all(x, y, w)
    OUT.mkdir(parents=True, exist_ok=True)
    joblib.dump(final, OUT / "forecast.joblib", compress=3)
    (OUT / "forecast_metadata.json").write_text(json.dumps({
        "model_version": "glycovision-forecast-v2",
        "effect_share": EFFECT_SHARE, "reach": reach_factors(data, preds["fingerstick_3"]),
        "features": FEATURES, "horizons": HORIZONS,
        "dataset": "HUPA-UCM Diabetes Dataset (carbs converted to grams)",
        "samples": len(data), "patients": int(data.patient.nunique()),
        "spike_rate": round(float(data.y_spike.mean()), 4), "low_rate": round(float(data.y_low.mean()), 4),
        "band_margins": margins, "evaluation": report,
        "evaluation_method": "5-fold, grouped by patient, averaged per patient",
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "limitations": ["25 adults with type 1 diabetes in Spain.", "Not clinically validated.",
                        "Must not be used to choose an insulin dose."],
    }, indent=1))
    print("saved", (OUT / "forecast.joblib").stat().st_size // 1024, "KB", flush=True)


if __name__ == "__main__":
    main(sys.argv[1])
