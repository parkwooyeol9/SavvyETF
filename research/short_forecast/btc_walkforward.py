#!/usr/bin/env python3
"""
BTC-only short-horizon forecast audit / walk-forward harness.

Instrument: OKX BTC-USDT-SWAP (USDT-M perpetual), NOT spot.
Horizons: 1h / 4h on 5m bars (wall-clock via timestamp, not just bar count).
Split: expanding walk-forward + purge + embargo + locked holdout.
Models: zero / historical / EWMA / GARCH(1,1) / linear quantile / LightGBM quantile.
Costs: fee + spread + funding (approx) + 1-bar delay.
Outputs JSON under research/short_forecast/out/.
"""

from __future__ import annotations

import json
import math
import time
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import requests

OUT_DIR = Path(__file__).resolve().parent / "out"
UA = "Mozilla/5.0 (compatible; SavvyETF-short-forecast/1.0)"
BAR_MS = 5 * 60_000
H1_MS = 60 * 60_000
H4_MS = 4 * 60 * 60_000
QUANTILES = [0.05, 0.25, 0.5, 0.75, 0.95]
COMPARISON_COUNT = 0  # incremented each model×fold evaluation


def _http_json(url: str) -> Any:
    r = requests.get(url, headers={"User-Agent": UA}, timeout=45)
    r.raise_for_status()
    return r.json()


def fetch_okx_candles(inst_id: str = "BTC-USDT-SWAP", target: int = 5000) -> pd.DataFrame:
    rows: list[list[str]] = []
    after: str | None = None
    for page in range(25):
        qs = {"instId": inst_id, "bar": "5m", "limit": "300"}
        if after:
            qs["after"] = after
        path = "candles" if page == 0 and not after else "history-candles"
        url = f"https://www.okx.com/api/v5/market/{path}?{urllib.parse.urlencode(qs)}"
        try:
            payload = _http_json(url)
        except Exception as exc:
            print("candle fetch err", path, exc)
            if path == "history-candles":
                break
            continue
        data = payload.get("data") or []
        if not data:
            break
        rows.extend(data)
        after = str(data[-1][0])
        if len(data) < 50:
            break
        time.sleep(0.05)
        if len(rows) >= target:
            break
    if not rows:
        return pd.DataFrame()
    # OKX candle: ts,o,h,l,c,vol,volCcy,volCcyQuote,confirm
    parsed = []
    for row in rows:
        if len(row) < 9:
            continue
        parsed.append(
            {
                "ts": float(row[0]),
                "o": float(row[1]),
                "h": float(row[2]),
                "l": float(row[3]),
                "c": float(row[4]),
                "vol": float(row[5]),
                "vol_ccy": float(row[6]),
                "vol_quote": float(row[7]),
                "confirm": int(float(row[8])),
            }
        )
    df = pd.DataFrame(parsed)
    df = df.dropna(subset=["ts", "c"])
    df = df.sort_values("ts").drop_duplicates("ts", keep="last")
    df = df[df["confirm"] == 1]
    now_ms = int(time.time() * 1000)
    df = df[df["ts"] + BAR_MS <= now_ms]
    df["dt"] = pd.to_datetime(df["ts"], unit="ms", utc=True)
    return df.reset_index(drop=True)


def fetch_okx_funding(inst_id: str = "BTC-USDT-SWAP", limit: int = 100) -> pd.DataFrame:
    url = (
        "https://www.okx.com/api/v5/public/funding-rate-history?"
        + urllib.parse.urlencode({"instId": inst_id, "limit": str(limit)})
    )
    try:
        data = (_http_json(url).get("data") or [])
    except Exception as exc:
        print("funding fetch err", exc)
        return pd.DataFrame(columns=["ts", "funding"])
    rows = []
    for r in data:
        ts = float(r.get("fundingTime") or 0)
        fr = float(r.get("fundingRate") or r.get("realizedRate") or 0)
        if ts > 0:
            rows.append({"ts": ts, "funding": fr})
    return pd.DataFrame(rows).sort_values("ts").drop_duplicates("ts")


def qc_report(df: pd.DataFrame) -> dict[str, Any]:
    if df.empty:
        return {"n": 0, "gaps": 0, "dupes": 0, "span_days": 0}
    dts = df["ts"].to_numpy()
    gaps = int(np.sum(np.diff(dts) > BAR_MS * 1.5))
    span = (dts[-1] - dts[0]) / 86_400_000
    return {
        "n": int(len(df)),
        "gaps_gt_7_5m": gaps,
        "dupes": 0,
        "span_days": round(float(span), 2),
        "start": df["dt"].iloc[0].isoformat(),
        "end": df["dt"].iloc[-1].isoformat(),
        "instrument": "OKX BTC-USDT-SWAP (USDT perpetual)",
        "not_spot": True,
    }


def build_frame(df: pd.DataFrame, funding: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    out["ret_1"] = np.log(out["c"]).diff()
    out["ret_3"] = np.log(out["c"]).diff(3)
    out["ret_12"] = np.log(out["c"]).diff(12)
    out["ret_48"] = np.log(out["c"]).diff(48)
    r = out["ret_1"]
    out["rv_12"] = r.rolling(12).apply(lambda x: float(np.sqrt(np.nansum(x**2) / max(len(x), 1))), raw=False)
    out["rv_48"] = r.rolling(48).apply(lambda x: float(np.sqrt(np.nansum(x**2) / max(len(x), 1))), raw=False)
    out["range_pct"] = (out["h"] - out["l"]) / out["c"]
    out["vol_z"] = (out["vol"] - out["vol"].rolling(48).mean()) / out["vol"].rolling(48).std().replace(0, np.nan)
    out["mom_12"] = out["c"] / out["c"].shift(12) - 1
    hour = out["dt"].dt.hour + out["dt"].dt.minute / 60.0
    out["hour_sin"] = np.sin(2 * np.pi * hour / 24)
    out["hour_cos"] = np.cos(2 * np.pi * hour / 24)
    if funding is not None and not funding.empty:
        f = funding.rename(columns={"ts": "fts"})
        out = pd.merge_asof(
            out.sort_values("ts"),
            f.sort_values("fts"),
            left_on="ts",
            right_on="fts",
            direction="backward",
        )
        out["funding"] = out["funding"].fillna(0.0)
    else:
        out["funding"] = 0.0
    # Wall-clock forward labels (timestamp-based), not bar-index only
    ts = out["ts"].to_numpy()
    c = out["c"].to_numpy()
    y1 = np.full(len(out), np.nan)
    y4 = np.full(len(out), np.nan)
    j = 0
    for i in range(len(out)):
        t1 = ts[i] + H1_MS
        t4 = ts[i] + H4_MS
        while j < len(out) and ts[j] < t1:
            j += 1
        k = j
        while k < len(out) and ts[k] < t4:
            k += 1
        # exact or next completed bar at/after horizon
        if j < len(out) and abs(ts[j] - t1) <= BAR_MS:
            y1[i] = math.log(c[j] / c[i])
        elif j < len(out) and ts[j] >= t1:
            y1[i] = math.log(c[j] / c[i])
        if k < len(out) and ts[k] >= t4:
            y4[i] = math.log(c[k] / c[i])
    out["y_1h"] = y1
    out["y_4h"] = y4
    return out


FEATS = [
    "ret_1",
    "ret_3",
    "ret_12",
    "ret_48",
    "rv_12",
    "rv_48",
    "range_pct",
    "vol_z",
    "mom_12",
    "hour_sin",
    "hour_cos",
    "funding",
]


def pinball(y: np.ndarray, q: np.ndarray, tau: float) -> float:
    e = y - q
    return float(np.mean(np.where(e >= 0, tau * e, (tau - 1) * e)))


def crps_from_quantiles(y: np.ndarray, qs: np.ndarray, taus: list[float]) -> float:
    s = 0.0
    for i, tau in enumerate(taus):
        s += 2 * pinball(y, qs[:, i], tau)
    return s / len(taus)


def ewma_sigma(rets: np.ndarray, lam: float = 0.94) -> float:
    v = float(rets[0] ** 2) if len(rets) else 1e-6
    for r in rets[1:]:
        v = lam * v + (1 - lam) * float(r) ** 2
    return math.sqrt(max(v, 1e-12))


def garch_sigma(rets: np.ndarray, omega=1e-6, a=0.05, b=0.90) -> float:
    """One-step GARCH(1,1) last conditional sigma (fit by moment-ish defaults + last path)."""
    v = float(np.nanvar(rets)) if len(rets) > 2 else 1e-6
    for r in rets:
        v = omega + a * float(r) ** 2 + b * v
    return math.sqrt(max(v, 1e-12))


def normal_quantiles(sig: float, horizon_bars: float, drift: float = 0.0) -> np.ndarray:
    z = np.array([-1.64485, -0.67449, 0.0, 0.67449, 1.64485])
    return drift * horizon_bars + z * sig * math.sqrt(horizon_bars)


def historical_quantiles(y_train: np.ndarray) -> np.ndarray:
    return np.quantile(y_train, QUANTILES)


def fit_linear_quantile(X: np.ndarray, y: np.ndarray, tau: float, epochs=25, lr=0.01, l2=0.02):
    n, d = X.shape
    mu = X.mean(axis=0)
    sd = X.std(axis=0)
    sd[sd < 1e-9] = 1.0
    Xs = np.clip((X - mu) / sd, -4, 4)
    w = np.zeros(d)
    b = float(np.quantile(y, tau))
    batch = min(n, 800)
    rng = np.random.default_rng(42)
    for ep in range(epochs):
        idx = rng.permutation(n)[:batch]
        lr_t = lr / math.sqrt(1 + ep * 0.25)
        for i in idx:
            pred = b + float(w @ Xs[i])
            err = y[i] - pred
            g = -tau if err >= 0 else (1 - tau)
            b -= lr_t * g
            w = np.clip(w - lr_t * (g * Xs[i] + l2 * w), -2, 2)
    return {"mu": mu, "sd": sd, "w": w, "b": b, "tau": tau}


def predict_linear_quantile(model, x: np.ndarray) -> float:
    xs = np.clip((x - model["mu"]) / model["sd"], -4, 4)
    return float(model["b"] + model["w"] @ xs)


def fit_lgb_quantiles(X: np.ndarray, y: np.ndarray):
    global COMPARISON_COUNT
    try:
        import lightgbm as lgb
    except Exception:
        return None
    models = []
    for tau in QUANTILES:
        COMPARISON_COUNT += 1
        dtrain = lgb.Dataset(X, label=y, free_raw_data=False)
        params = {
            "objective": "quantile",
            "alpha": tau,
            "learning_rate": 0.05,
            "num_leaves": 15,
            "min_data_in_leaf": 40,
            "feature_fraction": 0.8,
            "bagging_fraction": 0.8,
            "bagging_freq": 1,
            "verbosity": -1,
        }
        booster = lgb.train(params, dtrain, num_boost_round=80)
        models.append(booster)
    return models


def predict_lgb(models, X: np.ndarray) -> np.ndarray:
    cols = [m.predict(X) for m in models]
    q = np.column_stack(cols)
    for i in range(1, q.shape[1]):
        q[:, i] = np.maximum(q[:, i], q[:, i - 1])
    return q


@dataclass
class EvalRow:
    model: str
    horizon: str
    fold: str
    n: int
    pinball: float
    crps: float
    coverage_90: float
    brier: float
    direction_hit: float
    sharpe_net: float
    max_dd: float
    turnover: float
    avg_trade_net: float
    hit_ratio: float


def cost_backtest(
    y: np.ndarray,
    p_up: np.ndarray,
    funding: np.ndarray,
    fee_bps: float = 2.0,
    spread_bps: float = 1.0,
    delay_bars: int = 1,
) -> dict[str, float]:
    """Long if p_up>0.55, short if p_up<0.45, else flat. Apply costs + funding."""
    pos = np.where(p_up > 0.55, 1.0, np.where(p_up < 0.45, -1.0, 0.0))
    if delay_bars:
        pos = np.roll(pos, delay_bars)
        pos[:delay_bars] = 0
    turn = np.abs(np.diff(pos, prepend=0))
    cost = turn * (fee_bps + spread_bps) / 10000.0
    # funding ~ position * funding_rate (8h); approx scale to horizon later outside
    fund = pos * funding * 0.25  # rough fraction of 8h funding in a few hours
    pnl = pos * y - cost - np.abs(fund)
    if np.std(pnl) < 1e-12:
        sharpe = 0.0
    else:
        sharpe = float(np.mean(pnl) / np.std(pnl) * math.sqrt(252 * 24 * 12))  # 5m → ann rough
    eq = np.cumsum(pnl)
    peak = np.maximum.accumulate(eq)
    dd = float(np.min(eq - peak)) if len(eq) else 0.0
    trades = turn > 0
    avg_tr = float(np.mean(pnl[trades])) if trades.any() else 0.0
    hits = float(np.mean((pos != 0) & (np.sign(pos) == np.sign(y)))) if (pos != 0).any() else 0.0
    return {
        "sharpe_net": sharpe,
        "max_dd": dd,
        "turnover": float(np.mean(turn)),
        "avg_trade_net": avg_tr,
        "hit_ratio": hits,
    }


def p_up_from_q(qrow: np.ndarray) -> float:
    levels = np.array(QUANTILES)
    vals = qrow
    if vals[0] >= 0:
        return 0.99
    if vals[-1] <= 0:
        return 0.01
    for i in range(len(vals) - 1):
        if vals[i] <= 0 <= vals[i + 1]:
            w = (0 - vals[i]) / max(vals[i + 1] - vals[i], 1e-12)
            f0 = levels[i] + w * (levels[i + 1] - levels[i])
            return float(np.clip(1 - f0, 0.01, 0.99))
    return 0.5


def make_splits(n: int, purge: int, embargo: int, holdout_frac=0.15, n_folds=3):
    """Return list of (train_idx, val_idx) and locked holdout_idx. Time-ordered."""
    holdout_start = int(n * (1 - holdout_frac))
    usable = holdout_start
    folds = []
    # last 55% of usable for rolling val blocks
    block = max(80, (usable - int(usable * 0.5)) // n_folds)
    for f in range(n_folds):
        val_end = usable - (n_folds - f - 1) * block
        val_start = val_end - block
        if val_start < int(usable * 0.4):
            continue
        train_end = val_start - embargo
        train_idx = np.arange(0, max(train_end, 0))
        # purge: remove train samples whose index+purge overlaps val
        if len(train_idx):
            train_idx = train_idx[train_idx + purge < val_start]
        val_idx = np.arange(val_start, val_end)
        if len(train_idx) < 200 or len(val_idx) < 40:
            continue
        folds.append((f + 1, train_idx, val_idx))
    holdout_idx = np.arange(holdout_start, n)
    return folds, holdout_idx


def evaluate_models(frame: pd.DataFrame, y_col: str, horizon: str, horizon_bars: float) -> tuple[list[EvalRow], dict]:
    global COMPARISON_COUNT
    data = frame.dropna(subset=FEATS + [y_col]).reset_index(drop=True)
    X_all = data[FEATS].to_numpy(dtype=float)
    y_all = data[y_col].to_numpy(dtype=float)
    fund_all = data["funding"].to_numpy(dtype=float)
    ret1 = data["ret_1"].to_numpy(dtype=float)
    purge = int(math.ceil(horizon_bars)) + 2
    folds, holdout_idx = make_splits(len(data), purge=purge, embargo=12)

    rows: list[EvalRow] = []
    ablations: dict[str, Any] = {"folds": len(folds), "holdout_n": int(len(holdout_idx))}

    model_names_order = [
        "zero_flat",
        "historical",
        "ewma_normal",
        "garch_normal",
        "linear_quantile",
        "lgbm_quantile",
    ]

    def run_on(idx_train, idx_test, fold_name: str):
        global COMPARISON_COUNT
        Xtr, ytr = X_all[idx_train], y_all[idx_train]
        Xte, yte = X_all[idx_test], y_all[idx_test]
        fte = fund_all[idx_test]
        rtr = ret1[idx_train]
        rtr = rtr[np.isfinite(rtr)]

        preds: dict[str, np.ndarray] = {}

        # zero mean tiny vol
        COMPARISON_COUNT += 1
        preds["zero_flat"] = np.tile(normal_quantiles(1e-4, horizon_bars), (len(yte), 1))

        COMPARISON_COUNT += 1
        hq = historical_quantiles(ytr)
        preds["historical"] = np.tile(hq, (len(yte), 1))

        COMPARISON_COUNT += 1
        sig_e = ewma_sigma(rtr)
        preds["ewma_normal"] = np.tile(normal_quantiles(sig_e, horizon_bars), (len(yte), 1))

        COMPARISON_COUNT += 1
        sig_g = garch_sigma(rtr)
        preds["garch_normal"] = np.tile(normal_quantiles(sig_g, horizon_bars), (len(yte), 1))

        COMPARISON_COUNT += 1
        lin_models = [fit_linear_quantile(Xtr, ytr, tau) for tau in QUANTILES]
        qlin = np.column_stack([np.array([predict_linear_quantile(m, x) for x in Xte]) for m in lin_models])
        for i in range(1, qlin.shape[1]):
            qlin[:, i] = np.maximum(qlin[:, i], qlin[:, i - 1])
        preds["linear_quantile"] = qlin

        lgbm = fit_lgb_quantiles(Xtr, ytr)
        if lgbm is not None:
            preds["lgbm_quantile"] = predict_lgb(lgbm, Xte)

        for name, qmat in preds.items():
            pb = float(np.mean([pinball(yte, qmat[:, i], QUANTILES[i]) for i in range(5)]))
            cr = crps_from_quantiles(yte, qmat, QUANTILES)
            cover = float(np.mean((yte >= qmat[:, 0]) & (yte <= qmat[:, -1])))
            pup = np.array([p_up_from_q(qmat[i]) for i in range(len(yte))])
            brier = float(np.mean((pup - (yte > 0).astype(float)) ** 2))
            dhit = float(np.mean(((pup >= 0.5) & (yte > 0)) | ((pup < 0.5) & (yte <= 0))))
            bt = cost_backtest(yte, pup, fte)
            rows.append(
                EvalRow(
                    model=name,
                    horizon=horizon,
                    fold=fold_name,
                    n=int(len(yte)),
                    pinball=pb,
                    crps=cr,
                    coverage_90=cover,
                    brier=brier,
                    direction_hit=dhit,
                    **bt,
                )
            )

    for f, tr, va in folds:
        run_on(tr, va, f"fold{f}")

    # Locked holdout: fit on all pre-holdout (with purge), evaluate once — no model selection here
    if len(holdout_idx) >= 40:
        train_end = holdout_idx[0] - 12
        tr = np.arange(0, max(train_end, 0))
        tr = tr[tr + purge < holdout_idx[0]]
        if len(tr) >= 200:
            run_on(tr, holdout_idx, "holdout")

    # Aggregate mean CRPS by model on folds only (not holdout) for ranking
    fold_rows = [r for r in rows if r.fold.startswith("fold")]
    ranking = {}
    for name in model_names_order:
        subset = [r for r in fold_rows if r.model == name and r.horizon == horizon]
        if subset:
            ranking[name] = float(np.mean([r.crps for r in subset]))
    ablations["crps_rank_folds"] = ranking
    return rows, ablations


def feature_ablation(frame: pd.DataFrame, y_col: str, horizon: str, horizon_bars: float) -> dict[str, float]:
    """Drop feature groups; report fold-mean CRPS for linear quantile only."""
    global COMPARISON_COUNT
    groups = {
        "all": FEATS,
        "no_funding": [f for f in FEATS if f != "funding"],
        "no_vol": [f for f in FEATS if f not in ("rv_12", "rv_48", "range_pct", "vol_z")],
        "no_mom": [f for f in FEATS if f not in ("ret_1", "ret_3", "ret_12", "ret_48", "mom_12")],
        "no_tod": [f for f in FEATS if f not in ("hour_sin", "hour_cos")],
    }
    data = frame.dropna(subset=FEATS + [y_col]).reset_index(drop=True)
    y_all = data[y_col].to_numpy(dtype=float)
    purge = int(math.ceil(horizon_bars)) + 2
    folds, _ = make_splits(len(data), purge=purge, embargo=12)
    out: dict[str, float] = {}
    for gname, feats in groups.items():
        scores = []
        X_all = data[feats].to_numpy(dtype=float)
        for _, tr, va in folds:
            COMPARISON_COUNT += 1
            models = [fit_linear_quantile(X_all[tr], y_all[tr], tau) for tau in QUANTILES]
            q = np.column_stack(
                [[predict_linear_quantile(m, x) for x in X_all[va]] for m in models]
            )
            for i in range(1, q.shape[1]):
                q[:, i] = np.maximum(q[:, i], q[:, i - 1])
            scores.append(crps_from_quantiles(y_all[va], q, QUANTILES))
        out[gname] = float(np.mean(scores)) if scores else float("nan")
    return out


def regime_slice(frame: pd.DataFrame, y_col: str, model_q_fn, horizon_bars: float) -> dict[str, Any]:
    data = frame.dropna(subset=FEATS + [y_col, "rv_48"]).reset_index(drop=True)
    if len(data) < 400:
        return {}
    n = len(data)
    split = int(n * 0.7)
    train, test = data.iloc[:split], data.iloc[split:]
    Xtr = train[FEATS].to_numpy()
    ytr = train[y_col].to_numpy()
    models = [fit_linear_quantile(Xtr, ytr, tau) for tau in QUANTILES]
    Xte = test[FEATS].to_numpy()
    yte = test[y_col].to_numpy()
    q = np.column_stack([[predict_linear_quantile(m, x) for x in Xte] for m in models])
    rv = test["rv_48"].to_numpy()
    med = np.nanmedian(rv)
    hour = test["dt"].dt.hour.to_numpy()
    masks = {
        "high_vol": rv >= med,
        "low_vol": rv < med,
        "up_label": yte > 0,
        "down_label": yte <= 0,
        "asia_utc": (hour >= 0) & (hour < 8),
        "us_utc": (hour >= 13) & (hour < 21),
    }
    out = {}
    for name, m in masks.items():
        if m.sum() < 30:
            continue
        out[name] = {
            "n": int(m.sum()),
            "crps": crps_from_quantiles(yte[m], q[m], QUANTILES),
            "dir_hit": float(
                np.mean(
                    [
                        (p_up_from_q(q[m][i]) >= 0.5) == (yte[m][i] > 0)
                        for i in range(int(m.sum()))
                    ]
                )
            ),
        }
    return out


def main() -> None:
    global COMPARISON_COUNT
    COMPARISON_COUNT = 0
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    candles = fetch_okx_candles()
    funding = fetch_okx_funding()
    qc = qc_report(candles)
    frame = build_frame(candles, funding)

    results: dict[str, Any] = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "instrument": {
            "id": "BTC-USDT-SWAP",
            "venue": "OKX",
            "type": "USDT-M perpetual futures",
            "vs_spot": "Not BTC-USD spot; funding & basis differ from spot.",
        },
        "qc": qc,
        "features": FEATS,
        "methodology": {
            "bar": "5m",
            "label": "wall-clock +1h/+4h log return via timestamp match",
            "split": "expanding walk-forward + purge + embargo + locked 15% holdout",
            "costs": "fee 2bps + spread 1bps + funding approx + 1-bar delay",
        },
        "eval_rows": [],
        "ablation_1h": {},
        "regime_1h": {},
        "verdict": {},
    }

    all_rows: list[EvalRow] = []
    for y_col, horizon, hb in [("y_1h", "1h", 12.0), ("y_4h", "4h", 48.0)]:
        rows, meta = evaluate_models(frame, y_col, horizon, hb)
        all_rows.extend(rows)
        results[f"meta_{horizon}"] = meta

    results["eval_rows"] = [asdict(r) for r in all_rows]
    results["ablation_1h"] = feature_ablation(frame, "y_1h", "1h", 12.0)
    results["regime_1h"] = regime_slice(frame, "y_1h", None, 12.0)
    results["comparison_count"] = COMPARISON_COUNT

    # Verdict: does best complex model beat EWMA on holdout CRPS?
    holdout = [r for r in all_rows if r.fold == "holdout" and r.horizon == "1h"]
    by_model = {r.model: r for r in holdout}
    ewma = by_model.get("ewma_normal")
    lgbm = by_model.get("lgbm_quantile")
    linear = by_model.get("linear_quantile")
    best_complex = None
    for cand in (lgbm, linear):
        if cand is None:
            continue
        if best_complex is None or cand.crps < best_complex.crps:
            best_complex = cand
    beat = False
    reason = "insufficient holdout"
    if ewma and best_complex:
        beat = best_complex.crps < ewma.crps * 0.98  # need ≥2% CRPS improvement
        reason = (
            f"holdout 1h CRPS: {best_complex.model}={best_complex.crps:.6g} vs ewma={ewma.crps:.6g}; "
            f"net Sharpe {best_complex.model}={best_complex.sharpe_net:.3f} vs ewma={ewma.sharpe_net:.3f}"
        )
        if not beat:
            reason += (
                " — complex model does NOT stably beat EWMA on locked holdout; "
                "do not add TCN/LSTM/Kronos until this bar is cleared."
            )
    results["verdict"] = {
        "complex_beats_ewma_holdout_1h": beat,
        "detail": reason,
        "recommend_next": (
            "Ship EWMA/historical baseline + funding feature QC"
            if not beat
            else "Promote LightGBM/linear with cost-aware sizing"
        ),
    }

    out_path = OUT_DIR / "btc_walkforward_results.json"
    out_path.write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(json.dumps({"wrote": str(out_path), "qc": qc, "verdict": results["verdict"], "comparisons": COMPARISON_COUNT}, indent=2))


if __name__ == "__main__":
    main()
