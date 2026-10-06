"""ACWI 종목 분석기 데이터 빌드 — 팩터 + 기술적 + 펀더멘털 시계열 + MSCI 편출입 연동.

    python -m Claude_DB.factor.analyzer --xlsx Claude_DB/data/ACWI_new.xlsx --as-of 2026-10-01
      [--skip-pit]        # 편출입 재구성(약 3분)을 건너뛰고 기존 index_monitor 산출물 사용
      [--skip-scoreboard] # 팩터 스코어보드(web/data.js, out/stocks.csv 등) 재생성 생략

출력
  web/analyzer_data.js            대시보드 데이터 (web/analyzer.html 이 읽음, 공개 저장소 금지)
  out/analyzer_standalone.html    데이터 인라인 단일 파일 (서버 없이 열기)
  out/analyzer/*.csv              종목 전체 지표·브레드스·이벤트·편출입 대기·관찰 리스트
  out/analyzer/quality.json       데이터 점검 결과
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import re
from pathlib import Path

import numpy as np
import pandas as pd

from . import config as C
from . import engine as E
from . import fundamentals_ts as FT
from . import index_link as L

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "out" / "analyzer"
WEB = ROOT / "web"

# 종목 레코드 짧은 키 ← 원본 열
KEYS = {
    "c": "code", "n": "name", "ct": "country", "rg": "region", "s": "sector_ko", "ind": "industry", "isin": "isin",
    "w": "wgt", "cap": "mcap_usd_mn", "pxu": "px_usd",
    "pe": "pe", "pb": "pb", "dy": "dy", "roe": "roe", "fcf": "fcfy", "de": "de",
    "eg": "eps_g", "eg26": "eps_g26", "sg": "sales_g", "dg": "dps_g", "ef": "eps_flag",
    "eps": "eps_ntm", "bps": "bps_ntm", "dps": "dps_ntm",
    "fv": "f_value", "fs": "f_size", "fd": "f_dividend", "fg": "f_growth", "fm": "f_momentum", "fq": "f_quality",
    "z": "composite", "rk": "rank", "srk": "sector_rank", "pc": "pctile",
    # 기술적
    "r1w": "r_1w", "r1m": "r_1m", "r3m": "r_3m", "r6m": "r_6m", "r12m": "r_12m", "ytd": "r_ytd", "mom": "mom_12_1_abs",
    "vol": "vol_1y", "vol3": "vol_3m", "mdd": "mdd_1y", "dd52": "dd_52w", "up52": "up_52w_low",
    "ma20": "px_ma20", "ma50": "px_ma50", "ma200": "px_ma200", "gold": "golden", "xd": "cross_dir", "xa": "cross_ago",
    "rsi": "rsi14", "mh": "macd_hist", "mxd": "macd_cross_dir", "bb": "bb_pctb", "beta": "beta_1y", "corr": "corr_1y",
    "rel3": "rel_3m", "rel12": "rel_12m", "ts": "tech_score", "tr": "trend", "susp": "suspended",
    # 펀더멘털 시계열
    "er1": "eps_rev_1m", "er3": "eps_rev_3m", "er6": "eps_rev_6m", "er12": "eps_rev_12m", "erd": "eps_rev_dir_3m",
    "e24": "eps_chg_24m", "bg": "bps_g_12m", "dg12": "dps_g_12m", "cuts": "dps_cuts_36m",
    "pep": "pe_pct_3y", "pbp": "pb_pct_3y", "dyp": "dy_pct_3y", "pez": "pe_z_3y", "pem": "pe_med_3y",
    # MSCI
    "ms": "msci_status", "since": "msci_since", "sr": "msci_since_review", "er": "msci_end_review",
    "ee": "msci_end_effective", "tail": "country_tail", "wr": "watch_rank", "flag": "data_flag",
    # 2026-10-06 추가: 거래량·매출 추정치·10년 밸류 위치·본사 국가
    "liq": "adv20_usd_mn", "vr": "vol_ratio", "vz": "vol_z_5d", "obv": "obv_slope_20",
    "sv1": "sal_rev_1m", "sv3": "sal_rev_3m", "sv12": "sal_rev_12m", "svd": "sal_rev_dir_3m",
    "pep10": "pe_pct_10y", "pbp10": "pb_pct_10y", "dyp10": "dy_pct_10y", "pem10": "pe_med_10y", "ec5": "eps_cagr_5y",
    "hq": "hq_country",
}


def _c(v, sig=5):
    if v is None:
        return None
    if isinstance(v, (bool, np.bool_)):
        return bool(v)
    if isinstance(v, (int, np.integer)):
        return int(v)
    if isinstance(v, (float, np.floating)):
        if math.isnan(v) or math.isinf(v):
            return None
        return float(f"{float(v):.{sig}g}")
    if isinstance(v, (pd.Timestamp, dt.date)):
        return str(v)[:10]
    return v


def _series_dict(df: pd.DataFrame, codes: list, sig=4, norm_last=False) -> dict:
    out = {}
    for c in codes:
        if c not in df:
            continue
        s = df[c]
        if s.notna().sum() == 0:
            continue
        if norm_last:                          # 마지막 양수 값 = 1,000 (지수화 차트 전용 시리즈: 자릿수 절약)
            pos = s[s > 0].dropna()
            if len(pos):
                s = s / pos.iloc[-1] * 1000
        out[c] = [_c(x, sig) for x in s.to_numpy()]
    return out


def _bench_monthly(ri_m: pd.DataFrame, stocks: pd.DataFrame) -> list:
    """월간 벤치마크(현재 ACWI 비중 × 현지통화 월간수익률, 마지막=1,000). 10년 차트의 '벤치 대비' 용."""
    w = stocks.drop_duplicates("code").set_index("code")["wgt"].reindex(ri_m.columns).fillna(0)
    r = ri_m.pct_change(fill_method=None).clip(-0.8, 2.0)
    m = r.notna().astype(float) * w
    br = (r.fillna(0) * w).sum(axis=1) / m.sum(axis=1).replace(0, np.nan)
    lvl = (1 + br.fillna(0)).cumprod()
    return [_c(x, 5) for x in (lvl / lvl.iloc[-1] * 1000).to_numpy()]


def next_reviews() -> list[dict]:
    """index_monitor/data/raw/msci/ir_dates.csv (MSCI 공지) → 향후 리뷰 일정."""
    p = L.IM / "data/raw/msci/ir_dates.csv"
    if not p.exists():
        return []
    out = []
    for m in re.finditer(r"([A-Z][a-z]{2}), (\d{4})\|\"*Index Review\"*\|(\d\d)-(\d\d)-(\d{4})\|(\d\d)-(\d\d)-(\d{4})",
                         p.read_text(encoding="utf-8", errors="ignore").replace('""', '"')):
        mon, yr, am, ad, ay, em, ed, ey = m.groups()
        out.append({"review": f"{mon}{yr[2:]}", "announce": f"{ay}-{am}-{ad}", "effective": f"{ey}-{em}-{ed}"})
    return out


def build(xlsx: Path, as_of: str, skip_pit: bool = False, skip_scoreboard: bool = False) -> dict:
    OUT.mkdir(parents=True, exist_ok=True)
    if not skip_scoreboard:
        from . import build as B
        B.build(xlsx, as_of)                                   # 스코어보드도 같은 모델로 갱신
    d, stats, excluded, raw = E.run(str(xlsx))
    ex = dict(E.TS_EXTRAS)
    if not ex:
        raise SystemExit("시계열 시트(Price·EPS·BPS·DPS)가 없는 파일입니다. 분석기는 시계열이 필요합니다.")
    ts, tech, fund, bench, charts = ex["ts"], ex["tech"], ex["fund"], ex["bench"], ex["charts"]

    # ── 전체 종목 (팩터 제외 종목도 기술적·MSCI 정보는 보여준다) ──
    base = raw[raw["code"].notna()].drop_duplicates("code").copy()
    stocks = base[["code", "isin", "name", "wgt", "sector", "industry"]].merge(
        d.drop(columns=["isin", "name", "wgt", "sector", "industry"], errors="ignore"), on="code", how="left")
    for col, src in (("country", "_country"),):
        miss = stocks[col].isna()
        stocks.loc[miss, col] = [E._country(str(c), i if isinstance(i, str) else "", n if isinstance(n, str) else "") for c, i, n in
                                 zip(stocks.loc[miss, "code"], stocks.loc[miss, "isin"], stocks.loc[miss, "name"])]
    stocks["sector_ko"] = stocks["sector_ko"].fillna(stocks["sector"].map(C.SECTOR_KO) if hasattr(C, "SECTOR_KO") else None)
    stocks["region"] = stocks["region"].fillna("")
    stocks = stocks.join(tech.rename(columns={"mom_12_1": "mom_12_1_ri"}), on="code").join(
        fund.drop(columns=[c for c in fund if c in stocks]), on="code")
    if "mom_12_1_abs" not in stocks:
        stocks["mom_12_1_abs"] = np.nan
    stocks["mom_12_1_abs"] = stocks["mom_12_1_abs"].fillna(stocks["mom_12_1_ri"])
    stocks["excluded_reason"] = stocks["code"].map(excluded.set_index("code")["reason"]) if len(excluded) else ""

    # ── MSCI 연동 ──
    from .intake import anchor_frame
    anchor = anchor_frame(raw)[["name", "ric", "isin"]]
    pit = L.rebuild(None if skip_pit else anchor)
    anchor_tag = pit["anchor_tag"] or L._pit().detect_anchor_review(L._pit().load_reviews(), anchor)[0]
    st_ids = stocks[["code", "isin", "name", "wgt", "country"]].copy()
    st_ids["country"] = st_ids["country"].fillna("?")
    mem = L.membership(st_ids, pit)
    stocks = stocks.join(mem, on="code")
    pend = L.pending(pit, anchor_tag)
    code_by_isin = dict(zip(stocks["isin"], stocks["code"]))
    if len(pend):
        pend["code"] = pend["isin"].map(code_by_isin).fillna("")
    deleted = set(stocks.loc[stocks["msci_status"].fillna("").str.startswith("편출"), "code"])
    watch, val = L.deletion_watch(st_ids, tech, deleted)
    stocks = stocks.join(watch[["country_tail", "watch_score", "watch_rank"]], on="code")
    evs = L.events_from_pit(pit, st_ids, ts.ri.index[0], ts.ri.index[-1])
    es = L.event_study(ts.ri, bench, evs)
    per = es["per_event"].merge(stocks[["code", "name", "country", "region", "sector_ko"]], on="code", how="left")
    ev_sum = (per.groupby(["action", "review"])[["car_pre", "car_ann", "car_run", "car_close", "car_post"]]
              .agg(["mean", "count"]).round(2))
    order = {r: i for i, r in enumerate(pit["reviews"]["review"])}
    ev_sum = ev_sum.iloc[sorted(range(len(ev_sum)), key=lambda i: (ev_sum.index[i][0], order.get(ev_sum.index[i][1], 0)))]
    ev_all = per.groupby("action")[["car_pre", "car_ann", "car_run", "car_close", "car_post"]].agg(["mean", "median"]).round(2)
    ev_reg = per.groupby(["action", "region"])[["car_pre", "car_ann", "car_run", "car_close", "car_post"]].mean().round(2)

    # ── 브레드스 ──
    bd = stocks[stocks["excluded_reason"].fillna("") == ""]
    breadth = {k: FT.breadth(bd, col).round(2) for k, col in
               (("sector", "sector_ko"), ("region", "region"), ("country", "country"))}

    # ── CSV ──
    cols = [v for v in KEYS.values() if v in stocks] + ["watch_score", "excluded_reason", "vol_proxy", "mom_12_1",
                                                       "jump_10d", "stale_days", "n_obs"]
    stocks[[c for c in dict.fromkeys(cols) if c in stocks]].sort_values("rank").to_csv(
        OUT / "stocks_full.csv", index=False, encoding="utf-8-sig")
    for k, b in breadth.items():
        b.to_csv(OUT / f"breadth_{k}.csv", encoding="utf-8-sig")
    per.to_csv(OUT / "msci_event_study.csv", index=False, encoding="utf-8-sig")
    pend.to_csv(OUT / "msci_pending.csv", index=False, encoding="utf-8-sig")
    watch.join(stocks.set_index("code")[["name", "country", "wgt"]]).sort_values("watch_rank").to_csv(
        OUT / "msci_deletion_watch.csv", encoding="utf-8-sig")
    ts.anomalies.to_csv(OUT / "ri_anomalies.csv", index=False, encoding="utf-8-sig")

    # ── 웹 데이터 ──
    codes = stocks["code"].tolist()
    wk = ts.ri.ffill(limit=5).resample("W-FRI").last()
    bwk = bench.resample("W-FRI").last()
    recs = []
    for r in stocks.to_dict("records"):
        rec = {k: _c(r.get(v)) for k, v in KEYS.items() if v in r}
        rec = {k: v for k, v in rec.items() if v not in (None, "", "nan", "NULL")}
        if r.get("excluded_reason"):
            rec["xr"] = r["excluded_reason"]
        recs.append(rec)
    quality = {**ts.quality, "n_stocks": len(stocks), "n_scored": int(d["rank"].notna().sum()),
               "n_excluded": int(len(excluded)), "jump_stocks": ts.anomalies.groupby("code")["ret"].apply(
                   lambda s: [round(float(x) * 100, 1) for x in s]).to_dict(),
               "last_day_jumps": ts.anomalies[ts.anomalies["last_day"]]["code"].tolist(),
               "suspended": stocks.loc[stocks["suspended"].fillna(False).astype(bool), "code"].tolist(),
               "vol_proxy_vs_ri_spearman": round(float(d["vol_proxy"].rank().corr(d["vol"].rank())), 3)
               if "vol_proxy" in d else None,
               "intake": "out/intake/intake_report.md"}
    (OUT / "quality.json").write_text(json.dumps(quality, ensure_ascii=False, indent=1, default=_c), encoding="utf-8")
    meta = {
        "as_of": as_of, "built_at": dt.datetime.now().isoformat(timespec="seconds"), "source": xlsx.name,
        "ri_last": str(ts.ri.index[-1].date()), "est_last": charts["months"][-1],
        "anchor_review": anchor_tag, "latest_review": pit["reviews"]["review"].iloc[-1],
        "next_reviews": next_reviews(), "weights": C.DEFAULT_WEIGHTS,
        "factors": {k: {"label": v["label"], "descriptors": [x[2] for x in v["descriptors"]]} for k, v in C.FACTORS.items()},
        "watch_validation": {k: _c(v, 4) for k, v in val.items()},
        "bench_r12m": _c((bench.iloc[-1] / bench.iloc[-253] - 1) * 100),
        "bench_r3m": _c((bench.iloc[-1] / bench.iloc[-64] - 1) * 100),
    }
    web = {
        "meta": meta, "quality": quality, "stocks": recs,
        "series": {"weeks": [x.strftime("%Y-%m-%d") for x in wk.index], "ri": _series_dict(wk, codes, 4, norm_last=True),
                   "bench": [_c(x, 5) for x in (bwk / bwk.iloc[-1] * 1000).to_numpy()],
                   "months": charts["months"], "eps": _series_dict(charts["eps"], codes, 4),
                   "bps": _series_dict(charts["bps"], codes, 3, norm_last=True),
                   "dps": _series_dict(charts["dps"], codes, 3, norm_last=True),
                   "pe": _series_dict(charts["pe"], codes, 3),
                   **({"sal": _series_dict(charts["sal"], codes, 3, norm_last=True)} if "sal" in charts else {}),
                   **({"rim": _series_dict(charts["ri_m"], codes, 4, norm_last=True),
                       "bench_m": _bench_monthly(charts["ri_m"], stocks)} if "ri_m" in charts else {})},
        "breadth": {k: [{"g": i, **{c: _c(x) for c, x in row.items()}} for i, row in b.iterrows()]
                    for k, b in breadth.items()},
        "events": {"per": [{k: _c(v) for k, v in r.items()} for r in per.to_dict("records")],
                   "path_ann": es["path_ann"], "path_eff": es["path_eff"], "pre": es["pre"], "post": es["post"],
                   "by_review": [{"action": a, "review": rv, **{f"{c}_{s}": _c(x) for (c, s), x in row.items()}}
                                 for (a, rv), row in ev_sum.iterrows()],
                   "all": {a: {f"{c}_{s}": _c(x) for (c, s), x in row.items()} for a, row in ev_all.iterrows()},
                   "by_region": [{"action": a, "region": rg, **{c: _c(x) for c, x in row.items()}}
                                 for (a, rg), row in ev_reg.iterrows()]},
        "pending": [{k: _c(v) for k, v in r.items()} for r in pend.to_dict("records")],
        "reviews": [{k: _c(v) for k, v in r.items()} for r in pit["counts"].to_dict("records")],
    }
    js = "window.ANALYZER = " + json.dumps(web, ensure_ascii=False, separators=(",", ":"), default=_c) + ";\n"
    (WEB / "analyzer_data.js").write_text(js, encoding="utf-8")
    write_standalone()
    meta["size_js_mb"] = round(len(js.encode()) / 1e6, 2)
    return meta


def write_standalone() -> Path | None:
    """web/analyzer.html + analyzer_data.js (+ backtest_data.js 있으면) → out/analyzer_standalone.html (서버 없이 열기)."""
    html_p = WEB / "analyzer.html"
    if not html_p.exists() or not (WEB / "analyzer_data.js").exists():
        return None
    html = html_p.read_text(encoding="utf-8")
    for name in ("analyzer_data.js", "backtest_data.js"):
        tag = f'<script src="{name}"></script>'
        src = WEB / name
        if tag in html and src.exists():
            html = html.replace(tag, "<script>" + src.read_text(encoding="utf-8") + "</script>")
    out = ROOT / "out" / "analyzer_standalone.html"
    out.write_text(html, encoding="utf-8")
    return out


def main():
    ap = argparse.ArgumentParser(description="ACWI 종목 분석기 데이터 빌드")
    ap.add_argument("--xlsx", default=str(ROOT / "data" / "ACWI_raw.xlsx"))
    ap.add_argument("--as-of", default=dt.date.today().isoformat())
    ap.add_argument("--skip-pit", action="store_true")
    ap.add_argument("--skip-scoreboard", action="store_true")
    a = ap.parse_args()
    meta = build(Path(a.xlsx).expanduser(), a.as_of, a.skip_pit, a.skip_scoreboard)
    print(json.dumps({k: meta[k] for k in ("as_of", "source", "ri_last", "anchor_review", "watch_validation",
                                          "size_js_mb")}, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
