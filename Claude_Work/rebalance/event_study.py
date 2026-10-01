"""리밸런싱 이벤트 스터디 — 기계적 매매 전후 비정상수익률과 전략 수익.

docs/05_차익거래_방안.md 의 가설을 검증한다.

정의
----
- 이벤트: ETF(또는 지수) 정기변경에서 종목 하나가 매매되는 날 (``trade_date`` = T, 종가 집행).
- 방향 d: ETF 매수 +1, 매도 −1.
- AR_t = 종목 수익률 − 시장 수익률 (시장조정 모형, 시장 = KOSPI ``^KS11`` / KOSDAQ ``^KQ11``).
- CAR[a,b] = AR_a + … + AR_b (상대 거래일 기준, T = 0).
- 전략 ① 사전 포지셔닝 = d × CAR[pre,0]       (매도 이벤트면 T+pre 숏 → T 종가 청산)
- 전략 ② 되돌림       = −d × CAR[1,hold]     (매도 이벤트면 T 종가 매수 → T+hold 청산)

실행 (저장소 루트, .venv)
-----------------------
    python -m Claude_Work.rebalance.event_study                 # data/events.json 전체
    python -m Claude_Work.rebalance.event_study --pre -5 --hold 5

결과: ``out/event_study.json`` (이벤트별 AR 경로 + 요약). 가격은 네이버 일봉 종가
(``--source yf`` 로 yfinance 수정주가). 이벤트에 ``adv_eok`` 가 없으면 T 직전 20거래일
평균 거래대금을 네이버 일봉으로 계산해 넣는다.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Callable

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
EVENTS_PATH = ROOT / "data" / "events.json"
OUT_PATH = ROOT / "out" / "event_study.json"

MARKET_INDEX = {"KS": "^KS11", "KQ": "^KQ11"}

# 종가 DataFrame, 또는 (종가, 거래대금) 튜플을 돌려준다. 컬럼 = 티커.
PriceLoader = Callable[[list[str], str, str], "pd.DataFrame | tuple[pd.DataFrame, pd.DataFrame]"]


# --------------------------------------------------------------------------- 데이터
def load_events(path: Path = EVENTS_PATH, include_unconfirmed: bool = False) -> list[dict[str, Any]]:
    """trade_date 가 없는 이벤트는 건너뛴다. confidence == "low" 는 옵션으로만 포함."""
    raw = json.loads(path.read_text(encoding="utf-8"))
    out = []
    for ev in raw["events"]:
        for leg in ev["legs"]:
            if not ev.get("trade_date"):
                continue
            if ev.get("confidence") == "low" and not include_unconfirmed:
                continue
            if ev.get("kind") == "forecast":
                continue
            out.append({
                "event_id": ev["id"], "label": ev["label"], "trade_date": ev["trade_date"],
                "confidence": ev.get("confidence", "mid"), "kind": ev.get("kind", "rebalance"),
                "code": leg["code"], "name": leg["name"], "market": leg.get("market", "KS"),
                "side": leg["side"], "flow_eok": leg.get("flow_eok"),
                "adv_eok": leg.get("adv_eok"), "note": leg.get("note", ""),
            })
    return out


def yf_loader(tickers: list[str], start: str, end: str) -> pd.DataFrame:
    """yfinance 일봉 종가. 컬럼 = 티커."""
    import yfinance as yf

    df = yf.download(tickers, start=start, end=end, auto_adjust=True, progress=False)["Close"]
    if isinstance(df, pd.Series):
        df = df.to_frame(tickers[0])
    return df


NAVER_INDEX = {"^KS11": "KOSPI", "^KQ11": "KOSDAQ"}


def naver_loader(tickers: list[str], start: str, end: str) -> tuple[pd.DataFrame, pd.DataFrame]:
    """네이버 일봉 (종가, 거래대금=종가×거래량). 컬럼 = 티커."""
    from . import naver

    sym = {tk: NAVER_INDEX.get(tk, tk.split(".")[0]) for tk in tickers}
    bars = naver.many(list(sym.values()), start, end)
    close = pd.DataFrame({tk: bars[s]["close"] for tk, s in sym.items() if s in bars})
    value = pd.DataFrame({tk: bars[s]["close"] * bars[s]["volume"] for tk, s in sym.items()
                          if s in bars and tk not in NAVER_INDEX})
    return close, value


def ticker(code: str, market: str) -> str:
    return f"{code}.{market}"


def adv_before(value: pd.Series, trade_date: str, days: int = 20) -> float | None:
    """T 직전 ``days`` 거래일 평균 거래대금(억원)."""
    s = value.dropna()
    s = s[s.index < pd.Timestamp(trade_date)].tail(days)
    if len(s) < days // 2:
        return None
    return round(float(s.mean()) / 1e8, 1)


# --------------------------------------------------------------------------- 계산
def abnormal_returns(stock: pd.Series, market: pd.Series, trade_date: str,
                     pre: int = -10, post: int = 10) -> pd.Series:
    """상대 거래일 pre..post 의 시장조정 AR (index = 상대일)."""
    px = pd.concat([stock.rename("s"), market.rename("m")], axis=1).dropna()
    ret = px.pct_change().dropna()
    ar = ret["s"] - ret["m"]
    t0 = pd.Timestamp(trade_date)
    if t0 not in ar.index:
        # 매매일이 휴장·결측이면 그 다음 거래일을 T 로 본다
        later = ar.index[ar.index >= t0]
        if len(later) == 0:
            return pd.Series(dtype=float)
        t0 = later[0]
    i0 = ar.index.get_loc(t0)
    lo, hi = max(0, i0 + pre), min(len(ar) - 1, i0 + post)
    window = ar.iloc[lo:hi + 1]
    window.index = range(lo - i0, hi - i0 + 1)
    return window


def car(ar: pd.Series, a: int, b: int) -> float | None:
    seg = ar.loc[(ar.index >= a) & (ar.index <= b)]
    if len(seg) != b - a + 1:
        return None
    return float(seg.sum())


def direction(side: str) -> int:
    return 1 if side == "buy" else -1


def study(events: list[dict[str, Any]], loader: PriceLoader = naver_loader,
          pre: int = -5, hold: int = 5, pad_days: int = 40) -> dict[str, Any]:
    if not events:
        return {"events": [], "summary": {}}
    dates = pd.to_datetime([e["trade_date"] for e in events])
    start = (dates.min() - pd.Timedelta(days=pad_days)).strftime("%Y-%m-%d")
    end = (dates.max() + pd.Timedelta(days=pad_days)).strftime("%Y-%m-%d")
    tickers = sorted({ticker(e["code"], e["market"]) for e in events} | set(MARKET_INDEX.values()))
    px = loader(tickers, start, end)
    value = None
    if isinstance(px, tuple):
        px, value = px

    rows = []
    for e in events:
        tk = ticker(e["code"], e["market"])
        if tk not in px or px[tk].dropna().empty or MARKET_INDEX[e["market"]] not in px:
            rows.append({**e, "status": "no_price"})
            continue
        if not e.get("adv_eok") and value is not None and tk in value:
            e = {**e, "adv_eok": adv_before(value[tk], e["trade_date"]), "adv_source": "computed"}
        ar = abnormal_returns(px[tk], px[MARKET_INDEX[e["market"]]], e["trade_date"], pre=min(pre, -10), post=max(hold, 10))
        d = direction(e["side"])
        pre_car, day0 = car(ar, pre, -1), car(ar, 0, 0)
        post_car = car(ar, 1, hold)
        front = car(ar, pre, 0)
        rows.append({
            **e, "status": "ok",
            "car_pre": pre_car, "ar_0": day0, "car_post": post_car,
            "strat_front": None if front is None else d * front,
            "strat_reversal": None if post_car is None else -d * post_car,
            "ar_path": {int(k): round(float(v), 6) for k, v in ar.items()},
        })
    return {"params": {"pre": pre, "hold": hold, "model": "market_adjusted"},
            "events": rows, "summary": summarize(rows)}


def summarize(rows: list[dict[str, Any]]) -> dict[str, Any]:
    ok = [r for r in rows if r.get("status") == "ok"]
    out: dict[str, Any] = {"n": len(ok)}
    for key in ("strat_front", "strat_reversal", "ar_0"):
        vals = [r[key] for r in ok if r.get(key) is not None]
        if vals:
            s = pd.Series(vals)
            out[key] = {"mean": round(float(s.mean()), 6), "median": round(float(s.median()), 6),
                        "hit": round(float((s > 0).mean()), 3), "n": len(vals)}
    # 충격도(순매매/ADV) 구간별 되돌림
    buckets: dict[str, list[float]] = {}
    for r in ok:
        if r.get("strat_reversal") is None or not r.get("flow_eok") or not r.get("adv_eok"):
            continue
        ratio = abs(r["flow_eok"]) / r["adv_eok"]
        b = "high(>=10%)" if ratio >= 0.10 else "mid(3-10%)" if ratio >= 0.03 else "low(<3%)"
        buckets.setdefault(b, []).append(r["strat_reversal"])
    out["reversal_by_impact"] = {k: {"mean": round(sum(v) / len(v), 6), "n": len(v)} for k, v in buckets.items()}
    return out


ROW_KEYS = ("event_id", "label", "trade_date", "confidence", "code", "name", "market", "side",
            "flow_eok", "adv_eok", "car_pre", "ar_0", "car_post")


def _mean(vals: list[float]) -> float | None:
    return round(sum(vals) / len(vals), 4) if vals else None


def publishable(res: dict[str, Any], lo: int = -5, hi: int = 10) -> dict[str, Any]:
    """웹 화면용 요약: 이벤트별 누적 AR 경로(T+lo 부터) + 매수·매도 평균 경로."""
    pre, hold = res.get("params", {}).get("pre", -5), res.get("params", {}).get("hold", 5)
    rows = []
    for r in res.get("events", []):
        if r.get("status") != "ok":
            continue
        path = {int(k): v for k, v in r["ar_path"].items()}
        cum, acc = [], 0.0
        for t in range(lo, hi + 1):
            if t not in path:
                break
            acc += path[t]
            cum.append(round(acc, 4))
        row = {k: r.get(k) for k in ROW_KEYS}
        for k in ("car_pre", "ar_0", "car_post"):
            row[k] = None if row[k] is None else round(row[k], 4)
        if row["flow_eok"] and row["adv_eok"]:
            row["impact_ratio"] = round(abs(row["flow_eok"]) / row["adv_eok"], 4)
        row["car_path"] = cum
        rows.append(row)

    paths = []
    for i, t in enumerate(range(lo, hi + 1)):
        point: dict[str, Any] = {"t": t}
        for side in ("buy", "sell"):
            vals = [r["car_path"][i] for r in rows if r["side"] == side and len(r["car_path"]) > i]
            point[side] = _mean(vals)
        paths.append(point)

    by_side = {}
    for side in ("buy", "sell"):
        sub = [r for r in rows if r["side"] == side]
        by_side[side] = {"n": len(sub), **{k: _mean([r[k] for r in sub if r[k] is not None])
                                          for k in ("car_pre", "ar_0", "car_post")}}
    return {
        "generated_at": pd.Timestamp.now(tz="Asia/Seoul").isoformat(timespec="seconds"),
        "params": {"pre": pre, "hold": hold, "path_from": lo, "path_to": hi,
                   "model": "market_adjusted", "price_source": "naver_daily_close"},
        "summary": {"n": len(rows), "n_events": len({r["event_id"] for r in rows}), "by_side": by_side},
        "paths": paths,
        "rows": sorted(rows, key=lambda r: (r["trade_date"], r["side"], r["name"])),
    }


# --------------------------------------------------------------------------- CLI
def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description="리밸런싱 이벤트 스터디")
    ap.add_argument("--events", default=str(EVENTS_PATH))
    ap.add_argument("--pre", type=int, default=-5)
    ap.add_argument("--hold", type=int, default=5)
    ap.add_argument("--include-low", action="store_true", help="confidence=low 이벤트도 포함")
    ap.add_argument("--source", choices=("naver", "yf"), default="naver", help="가격 소스")
    args = ap.parse_args(argv)

    events = load_events(Path(args.events), include_unconfirmed=args.include_low)
    loader = naver_loader if args.source == "naver" else yf_loader
    res = study(events, loader=loader, pre=args.pre, hold=args.hold)
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(res, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    s = res["summary"]
    print(f"이벤트 {s.get('n', 0)}건 → {OUT_PATH}")
    for k in ("strat_front", "strat_reversal", "ar_0"):
        if k in s:
            print(f"  {k}: 평균 {s[k]['mean']:+.2%} · 중앙값 {s[k]['median']:+.2%} · 적중 {s[k]['hit']:.0%} (n={s[k]['n']})")


if __name__ == "__main__":
    main()
