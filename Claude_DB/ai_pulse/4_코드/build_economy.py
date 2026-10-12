"""AI Economy — 2_결과물/data/econ_*.csv 로 'AI 경제 침투' 페이지를 만듭니다.

    python3 4_코드/build_economy.py

결과: 2_결과물/ai_economy.html (오프라인에서 열림)
"""
from __future__ import annotations

import datetime as dt
import json
from pathlib import Path

import numpy as np
import pandas as pd

from fetch_economy import sic_sector

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "2_결과물" / "data"
OUT = ROOT / "2_결과물" / "ai_economy.html"
HYPER = ["Microsoft", "Alphabet", "Amazon", "Meta", "Oracle"]
IND_KO = {"Information": "정보(IT·미디어)", "Finance & Insurance": "금융·보험", "Manufacturing": "제조", "Retail Trade": "소매",
          "Healthcare": "보건", "Construction": "건설", "Accommodation & Food": "숙박·음식",
          "Professional, Scientific, and Technical Services": "전문·과학·기술"}


def load(name: str, **kw) -> pd.DataFrame | None:
    p = DATA / name
    return pd.read_csv(p, **kw) if p.exists() else None


def rec(df: pd.DataFrame) -> list[dict]:
    return json.loads(df.replace({np.nan: None}).to_json(orient="records", force_ascii=False))


def r(v, d=1):
    return None if v is None or pd.isna(v) else round(float(v), d)


def cal_q(end: pd.Series) -> pd.Series:
    """Fiscal quarters that end mid-month (NVIDIA late Jan/Apr/Jul/Oct, Oracle Feb/May/Aug/Nov) → calendar quarter of the midpoint."""
    return (pd.to_datetime(end) - pd.Timedelta(days=45)).dt.to_period("Q").astype(str)


def build() -> dict:
    P: dict = {"generated": dt.datetime.now().strftime("%Y-%m-%d %H:%M")}
    sf = DATA / "econ_status.json"
    P["status"] = json.loads(sf.read_text(encoding="utf-8")) if sf.exists() else {}
    K = {}  # value-chain headline cards

    # 1. 투자 vs 매출 -------------------------------------------------------------
    B = load("econ_bigtech_q.csv")
    if B is not None and len(B):
        B["q"] = cal_q(B.end)
        h = B[B.company.isin(HYPER)].groupby(["q", "company"])[["capex", "revenue"]].sum(min_count=1).reset_index()
        full = h.groupby("q").company.nunique()
        qs = sorted(full[full == len(HYPER)].index)  # quarters where all five have reported
        h = h[h.q.isin(qs)]
        agg = h.groupby("q")[["capex", "revenue"]].sum()
        agg["intensity"] = agg.capex / agg.revenue * 100
        ttm = agg[["capex", "revenue"]].rolling(4).sum().dropna()
        nv = B[B.company == "NVIDIA"].groupby("q").revenue.sum()
        last = agg.index[-1]
        cap_ttm = ttm.capex.iloc[-1]
        cap_yoy = (ttm.capex.iloc[-1] / ttm.capex.iloc[-5] - 1) * 100 if len(ttm) > 4 else None
        rev_yoy = (ttm.revenue.iloc[-1] / ttm.revenue.iloc[-5] - 1) * 100 if len(ttm) > 4 else None
        per = h[h.q == last].set_index("company")
        prev = h[h.q == qs[-5]].set_index("company") if len(qs) > 4 else None
        P["invest"] = {
            "last_q": last, "cap_ttm_b": r(cap_ttm / 1e9, 0), "cap_yoy": r(cap_yoy, 0), "rev_yoy": r(rev_yoy, 0),
            "series": [[q, r(c / 1e9, 1), r(v / 1e9, 1), r(i, 1)] for q, c, v, i in zip(agg.index, agg.capex, agg.revenue, agg.intensity) if q >= "2019Q1"],
            "nvda": [[q, r(v / 1e9, 1)] for q, v in nv.items() if q >= "2019Q1"],
            "nvda_yoy": r((nv.iloc[-4:].sum() / nv.iloc[-8:-4].sum() - 1) * 100, 0) if len(nv) >= 8 else None, "nvda_q": nv.index[-1],
            "table": [{"company": c, "capex": r(per.capex.get(c, np.nan) / 1e9, 1), "revenue": r(per.revenue.get(c, np.nan) / 1e9, 1),
                       "intensity": r(per.capex.get(c, np.nan) / per.revenue.get(c, np.nan) * 100, 0),
                       "capex_yoy": r((per.capex.get(c, np.nan) / prev.capex.get(c, np.nan) - 1) * 100, 0) if prev is not None else None}
                      for c in HYPER]}
        K["invest"] = {"v": f"${r(cap_ttm / 1e9, 0):,.0f}B", "s": f"빅테크 5사 최근 4분기 설비투자 · 전년비 {cap_yoy:+.0f}%", "dir": cap_yoy}

    # 2. 사용량·가격·지출 (Ramp 토큰) ---------------------------------------------
    T = load("econ_ramp_tokens.csv")
    if T is not None and len(T):
        a = T[T.token_type == "all_tokens"].copy()
        a["usage_date"] = pd.to_datetime(a.usage_date)
        wk = a[a.usage_date.dt.dayofweek == a.usage_date.max().dayofweek]  # one point per week (7-day windows)
        series = {}
        for mk, g in wk.groupby("model_maker"):
            series[mk] = [[d.strftime("%Y-%m-%d"), r(c / 1e12, 3), r(p, 3), r(s / 1e6, 2)] for d, c, p, s in
                          zip(g.usage_date, g.token_count_7d, g.usd_per_mtok, g.token_cost_usd_7d)]
        end = wk.usage_date.max()
        now = wk[wk.usage_date == end]
        ago = wk[wk.usage_date == wk.usage_date[wk.usage_date <= end - pd.Timedelta(days=364)].max()]
        tok_x = now.token_count_7d.sum() / ago.token_count_7d.sum() if len(ago) else None
        spend_x = now.token_cost_usd_7d.sum() / ago.token_cost_usd_7d.sum() if len(ago) else None
        price_chg = ((now.token_cost_usd_7d.sum() / now.token_count_7d.sum()) / (ago.token_cost_usd_7d.sum() / ago.token_count_7d.sum()) - 1) * 100 if len(ago) else None
        P["tokens"] = {"asof": end.strftime("%Y-%m-%d"), "series": series, "tok_x": r(tok_x, 1), "spend_x": r(spend_x, 1), "price_chg": r(price_chg, 0)}
        K["usage"] = {"v": f"{tok_x:.0f}배" if tok_x else "—", "s": f"Ramp 고객사 주간 토큰 사용량, 1년 전 대비 · 단가 {price_chg:+.0f}%", "dir": 1}
        K["revenue"] = {"v": f"{spend_x:.1f}배" if spend_x else "—", "s": "기업 API 지출(사용량×단가), 1년 전 대비", "dir": 1}
    O = load("econ_openrouter_rank.csv")
    if O is not None and len(O):
        P["openrouter"] = {"snapshot": O.snapshot.iloc[0], "rows": rec(O[["rank", "model", "author", "tokens", "change", "in_usd_mtok", "out_usd_mtok"]])}
    G = load("econ_grossing.csv")
    if G is not None and len(G):
        g = G[G.ai_app.notna() & (G.ai_app != "")].groupby(["ai_app", "country"])["rank"].min().unstack()
        P["grossing"] = {"snapshot": G.snapshot.iloc[0], "rows": [{"app": k, "KR": r(v.get("KR"), 0), "US": r(v.get("US"), 0)} for k, v in g.iterrows()]}

    # 3. 기업 채택 -----------------------------------------------------------------
    R = load("econ_ramp_overall.csv")
    BT = load("econ_btos.csv")
    if R is not None and len(R):
        lastR = R.iloc[-1]
        P["adopt"] = {"ramp": [[d, v] for d, v in zip(R.date_month, R.adoption_rate_pct)], "ramp_last": r(lastR.adoption_rate_pct),
                      "ramp_yoy": r(lastR.yoy_change_pp), "ramp_month": lastR.date_month[:7]}
        if BT is not None and len(BT):
            for m in ["now", "next6m"]:
                b = BT[BT.measure == m]
                P["adopt"]["btos_" + m] = [[d, v] for d, v in zip(b.date, b.pct)]
            bn = BT[BT.measure == "now"]
            P["adopt"]["btos_last"] = r(bn.pct.iloc[-1])
            P["adopt"]["btos_date"] = bn.date.iloc[-1]
        K["adopt"] = {"v": f"{lastR.adoption_rate_pct:.0f}%", "s": f"AI에 돈을 내는 미국 기업 (Ramp) · 1년 새 {lastR.yoy_change_pp:+.0f}%p"
                      + (f" · 실제 사용 설문 {P['adopt'].get('btos_last')}% (Census)" if BT is not None else ""), "dir": lastR.yoy_change_pp}
    V = load("econ_ramp_vendor.csv")
    if V is not None and len(V):
        top = V[V.date_month == V.date_month.max()].nlargest(3, "adoption_rate_pct").vendor.tolist()
        P["vendor"] = {v: [[d, x] for d, x in zip(g.date_month, g.adoption_rate_pct)] for v, g in V[V.vendor.isin(top)].groupby("vendor")}
        P["vendor_last"] = rec(V[V.date_month == V.date_month.max()].sort_values("adoption_rate_pct", ascending=False)[["vendor", "adoption_rate_pct", "mom_change_pp"]])
    I = load("econ_ramp_industry.csv")
    if I is not None and len(I):
        last = I[I.date_month == I.date_month.max()].copy()
        yago = I[I.date_month == (pd.to_datetime(I.date_month.max()) - pd.DateOffset(years=1)).strftime("%Y-%m-%d")].set_index("naics_sector").adoption_rate_pct
        last["yoy"] = last.naics_sector.map(yago).pipe(lambda s: last.adoption_rate_pct - s)
        last["sector"] = last.naics_sector.map(IND_KO).fillna(last.naics_sector)
        P["ramp_ind"] = rec(last.sort_values("adoption_rate_pct", ascending=False)[["sector", "adoption_rate_pct", "yoy"]].round(1))
    BS = load("econ_btos_sector.csv")
    if BS is not None and len(BS):
        P["btos_sector"] = rec(BS.sort_values("pct", ascending=False))
    SP = load("econ_ramp_spend.csv")
    if SP is not None and len(SP):
        s = SP[(SP.dimension_type == "naics_sector") & (SP.date_month == SP.date_month.max())].copy()
        lab = {**{k.lower(): v for k, v in IND_KO.items()}, "finance and insurance": "금융·보험", "health care": "보건",
               "accommodation and food services": "숙박·음식", "retail trade": "소매",
               "technology and media": "정보(IT·미디어)", "retail": "소매"}
        s["sector"] = s.dimension_label.str.lower().map(lab).fillna(s.dimension_label)
        sz = SP[(SP.dimension_type == "fte_segment") & (SP.date_month == SP.date_month.max())]
        P["spend"] = {"month": SP.date_month.max()[:7], "sector": rec(s.sort_values("median_pepm", ascending=False)[["sector", "median_pepm"]]),
                      "size": rec(sz[["dimension_label", "median_pepm"]])}
    F = load("econ_filings_ai.csv", dtype={"sic": str})
    if F is not None and len(F):
        cur = f"{dt.date.today().year}Q{(dt.date.today().month - 1) // 3 + 1}"
        F = F[F.quarter < cur]  # current quarter is still being filed
        tot = F[F.sic == "TOTAL"].set_index("quarter").filings.sort_index()
        ttm = tot.rolling(4).sum().dropna()
        sec = F[F.sic != "TOTAL"].copy()
        sec["sector"] = sec.sic.map(sic_sector)
        mix = sec.groupby(["quarter", "sector"]).filings.sum().unstack().fillna(0)
        mix4 = mix.rolling(4).sum().dropna()
        share = mix4.div(mix4.sum(axis=1), axis=0) * 100
        P["filings"] = {"ttm": [[q, int(v)] for q, v in ttm.items()], "quarters": tot.index.tolist(),
                        "share_last": rec(share.iloc[-1].rename("share").reset_index().round(1)),
                        "share_prev": rec(share.iloc[-5].rename("share").reset_index().round(1)) if len(share) > 4 else [],
                        "last": share.index[-1], "prev": share.index[-5] if len(share) > 4 else None,
                        "ttm_yoy": r((ttm.iloc[-1] / ttm.iloc[-5] - 1) * 100, 0) if len(ttm) > 4 else None}

    # 4. 생산성·일자리 ----------------------------------------------------------------
    FR = load("econ_fred.csv")
    if FR is not None and len(FR):
        out = {}
        for sid, g in FR.groupby("series"):
            g = g.sort_values("date")
            out[sid] = {"label": g.label.iloc[0], "pts": [[d, r(v, 2)] for d, v in zip(g.date, g.value)]}
        P["fred"] = out
        op = FR[FR.series == "OPHNFB"].sort_values("date")
        yoy = (op.value.iloc[-1] / op.value.iloc[-5] - 1) * 100
        pre = op[(op.date >= "2015-01-01") & (op.date < "2020-01-01")].value
        pre_g = ((pre.iloc[-1] / pre.iloc[0]) ** (4 / (len(pre) - 1)) - 1) * 100 if len(pre) > 4 else None
        P["prod"] = {"yoy": r(yoy, 1), "date": op.date.iloc[-1], "pre_avg": r(pre_g, 1),
                     "yoy_series": [[d, r((v / p - 1) * 100, 2)] for d, v, p in zip(op.date.iloc[4:], op.value.iloc[4:], op.value.iloc[:-4].values)]}
        K["prod"] = {"v": f"{yoy:+.1f}%", "s": f"미국 노동생산성 전년비 ({op.date.iloc[-1][:7]}) · 2015~19 연평균 {pre_g:.1f}%", "dir": yoy - (pre_g or 0)}
    TF = load("econ_tfp.csv")
    if TF is not None and len(TF):
        t = TF.tail(16)
        P["tfp"] = {"rows": [[q, r(a, 2), r(b, 2)] for q, a, b in zip(t.quarter, t.dtfp_util if "dtfp_util" in t else t.dtfp, t.dLP)],
                    "avg4": r(TF.tail(4)[("dtfp_util" if "dtfp_util" in TF else "dtfp")].mean(), 2)}
    AI = load("econ_indeed_ai.csv")
    if AI is not None and len(AI):
        AI = AI[AI.date >= "2022-01-01"]
        P["indeed_ai"] = {c: [[d, r(v, 2)] for d, v in zip(g.date, g.AI_share_postings)] for c, g in AI[AI.jobcountry.isin(["US", "GB", "DE"])].groupby("jobcountry")}
        lastA = AI[AI.date == AI.date.max()]
        P["indeed_last"] = rec(lastA.sort_values("AI_share_postings", ascending=False)[["jobcountry", "AI_share_postings"]].round(2))
        us = AI[AI.jobcountry == "US"].sort_values("date")
        us_yago = us[us.date <= (pd.to_datetime(us.date.iloc[-1]) - pd.DateOffset(years=1)).strftime("%Y-%m-%d")].AI_share_postings.iloc[-1]
        K["jobs"] = {"v": f"{us.AI_share_postings.iloc[-1]:.1f}%", "s": f"미국 채용 공고 중 AI 관련 비중 · 1년 전 {us_yago:.1f}%", "dir": us.AI_share_postings.iloc[-1] - us_yago}

    # 5. 로보틱스 -------------------------------------------------------------------
    RT = load("econ_robot_trade.csv")
    if RT is not None and len(RT):
        y = RT.year.max()
        cur, prev, base = RT[RT.year == y].set_index("country"), RT[RT.year == y - 1].set_index("country"), RT[RT.year == RT.year.min()].set_index("country")
        P["robot_trade"] = {"year": int(y), "first": int(RT.year.min()),
                            "series": {c: [[f"{yy}-07-01", r(v / 1e6, 0)] for yy, v in zip(g.year, g.export_usd)] for c, g in RT.groupby("country")},
                            "table": [{"country": c, "v": r(cur.export_usd[c] / 1e6, 0), "yoy": r((cur.export_usd[c] / prev.export_usd.get(c, np.nan) - 1) * 100, 0),
                                       "x": r(cur.export_usd[c] / base.export_usd.get(c, np.nan), 1)} for c in cur.sort_values("export_usd", ascending=False).index]}
    RJ = load("econ_robot_jobs.csv")
    if RJ is not None and len(RJ):
        RJ["p"] = pd.to_datetime(RJ.published, errors="coerce")
        ref = pd.Timestamp(RJ.snapshot.iloc[0])
        P["robot_jobs"] = {"snapshot": RJ.snapshot.iloc[0], "rows": [{"company": c, "open": int(len(g)), "new30": int((g.p > ref - pd.Timedelta(days=30)).sum()),
                           "mfg": int(g.manufacturing.sum()), "top": g.department.value_counts().head(2).index.tolist()} for c, g in RJ.groupby("company")]}
    HR = load("econ_hf_robotics.csv")
    if HR is not None and len(HR):
        org = HR.groupby("org").downloads_30d.sum().sort_values(ascending=False)
        P["hf_robot"] = {"models": int(len(HR)), "downloads": int(HR.downloads_30d.sum()),
                         "orgs": [{"org": k, "dl": int(v)} for k, v in org.head(8).items()],
                         "new90": int((pd.to_datetime(HR.created, errors="coerce") > pd.Timestamp(HR.snapshot.iloc[0]) - pd.Timedelta(days=90)).sum())}
    EX = load("econ_robot_exposure.csv")
    if EX is not None and len(EX):
        P["exposure"] = rec(EX.drop_duplicates("occupation_title").head(15)[["occupation_title", "robot_exposure_index"]].round(3))
    X = load("arxiv_monthly.csv")
    if X is not None and "cs.RO" in set(X.cat):
        X = X[(X.cat.isin(["cs.RO", "cs.LG"])) & (X.month < dt.date.today().strftime("%Y-%m"))].dropna()
        pv = X.pivot(index="month", columns="cat", values="papers")
        P["arxiv_ro"] = [[m + "-01", int(v), r(v / l * 100, 1)] for m, v, l in zip(pv.index, pv["cs.RO"], pv["cs.LG"]) if pd.notna(v)]
    if "robot_trade" in P:
        cn = next((t for t in P["robot_trade"]["table"] if t["country"] == "중국"), None)
        K["robot"] = {"v": f"${cn['v']:,.0f}M" if cn else "—", "s": f"중국 산업용 로봇 수출 {P['robot_trade']['year']} · {P['robot_trade']['first']}년의 {cn['x']}배" if cn else "", "dir": 1}
    # 6. 모델 경쟁 — 성능 대비 비용 ------------------------------------------------
    AA = load("econ_aa_models.csv")
    if AA is not None and len(AA):
        a = AA[AA.cost_per_task > 0].sort_values("cost_per_task")  # 0 = not measured, not free
        best, front = -1.0, set()
        for row in a.itertuples():  # efficient frontier: nothing cheaper scores higher
            if row.index > best:
                front.add(row.slug)
                best = row.index
        AA["frontier"] = AA.slug.isin(front)
        P["frontier"] = {"snapshot": AA.snapshot.iloc[0], "rows": rec(AA[["slug", "model", "creator", "index", "cost_per_task", "released", "frontier"]])}
    MP = load("econ_model_prices.csv")
    if MP is not None and len(MP):
        P["prices"] = {"snapshot": MP.snapshot.iloc[0], "rows": rec(MP[["lab", "model", "created", "in_usd_mtok", "out_usd_mtok"]])}

    # 7. 인프라 병목 · 기업 · ETF ----------------------------------------------------
    IQ = load("econ_infra_q.csv")
    EH = load("econ_etf_holdings.csv")
    if IQ is not None and len(IQ):
        IQ["q"] = cal_q(IQ.end)
        layers = {}
        for (layer, comp, tic), g in IQ.groupby(["layer", "company", "ticker"]):
            s = g.groupby("q").revenue.sum().sort_index()
            yoy = (s.iloc[-1] / s.iloc[-5] - 1) * 100 if len(s) > 4 else None
            ttm = (s.iloc[-4:].sum() / s.iloc[-8:-4].sum() - 1) * 100 if len(s) >= 8 else None
            held = {}
            if EH is not None:
                h = EH[EH.ticker == tic]
                held = {e: r(w, 2) for e, w in zip(h.etf, h.weight)}
            layers.setdefault(layer, []).append({"company": comp, "ticker": tic, "last_q": s.index[-1], "rev_b": r(s.iloc[-1] / 1e9, 2),
                                                 "yoy": r(yoy, 0), "ttm_yoy": r(ttm, 0), "etf": held,
                                                 "series": [[q, r(v / 1e9, 2)] for q, v in s.iloc[-12:].items()]})
        P["infra"] = {"layers": layers, "order": ["반도체", "메모리", "네트워크", "광통신", "전력·냉각"]}
    MS = load("econ_memory_spot.csv")
    if MS is not None and len(MS):
        P["memory"] = {"snapshot": MS.snapshot.iloc[0], "rows": rec(MS[["kind", "item", "avg", "chg_pct"]])}
    if EH is not None and len(EH):
        tick_layer = {t: l for l, rows in (P.get("infra") or {}).get("layers", {}).items() for t in [x["ticker"] for x in rows]}
        etf = {}
        for e, g in EH.groupby("etf"):
            top = g.nlargest(10, "weight")
            etf[e] = {"label": g.etf_label.iloc[0], "as_of": g.as_of.max(), "n": int(len(g)),
                      "top": [{"ticker": t, "name": n, "w": r(w, 2), "layer": tick_layer.get(t)} for t, n, w in zip(top.ticker, top.name, top.weight)],
                      "layer_w": {l: r(g[g.ticker.isin([x["ticker"] for x in rows])].weight.sum(), 1)
                                  for l, rows in (P.get("infra") or {}).get("layers", {}).items()}}
        P["etf"] = etf

    P["kpi"] = K
    P["notes"] = notes(P)
    return P


def notes(P: dict) -> list[dict]:
    """'이번 관측의 핵심' — short, data-backed observations. Each carries an evidence tag:
    사실(reported/measured value) · 추정(our calculation on top of data) · 전망(forecast) · 해석(our reading)."""
    out = []
    T, I = P.get("tokens"), P.get("invest")
    if T and T.get("spend_x"):
        out.append({"title": "단가가 내려도 기업 AI 지출은 늘었다", "tag": "추정",
                    "body": f"1년 새 토큰 단가 {T['price_chg']:+.0f}%, 사용량 {T['tok_x']:.1f}배 → 지출 {T['spend_x']:.1f}배 (Ramp 고객사 기준, 우리 계산)."})
    if I:
        out.append({"title": "투자가 매출보다 훨씬 빨리 는다", "tag": "사실",
                    "body": f"빅테크 5사 최근 4분기 설비투자 ${I['cap_ttm_b']:,.0f}B(전년비 {I['cap_yoy']:+.0f}%), 같은 기간 매출 {I['rev_yoy']:+.0f}%. "
                            f"매출 대비 설비투자 비율 {I['series'][-1][3]:.0f}% (공시 기준)."})
    E, INF = P.get("etf"), P.get("infra")
    if E and INF:
        miss = [x["company"] for l in ["광통신", "전력·냉각", "네트워크"] for x in INF["layers"].get(l, []) if not x["etf"]]
        if miss:
            out.append({"title": "AI ETF는 병목 부품주를 거의 담지 않는다", "tag": "사실",
                        "body": f"{', '.join(miss)}는 AIQ·BOTZ·DTCR 어디에도 없습니다 (Global X 공개 보유종목, {next(iter(E.values()))['as_of']}). "
                                "광통신·전력 노출은 개별 종목이나 다른 ETF로 확인해야 합니다."})
    F = P.get("frontier")
    if F:
        fr = sorted([x for x in F["rows"] if x["frontier"]], key=lambda x: -x["index"])
        if len(fr) >= 2:
            top, cheap = fr[0], next((x for x in fr if x["index"] >= fr[0]["index"] - 6 and x["cost_per_task"] < fr[0]["cost_per_task"] / 4), None)
            if cheap:
                out.append({"title": "최고 성능의 90%를 1/4 이하 비용으로", "tag": "사실",
                            "body": f"{cheap['model']}는 지수 {cheap['index']:.0f}(1위 {top['model']} {top['index']:.0f})에 과제당 ${cheap['cost_per_task']:.2f}"
                                    f"(1위 ${top['cost_per_task']:.2f}). Artificial Analysis 기본 설정 기준."})
    PR, TF = P.get("prod"), P.get("tfp")
    if PR and TF:
        out.append({"title": "생산성은 아직 'AI 가속'이 뚜렷하지 않다", "tag": "해석",
                    "body": f"노동생산성 전년비 {PR['yoy']:+.1f}%로 2015~19 평균({PR['pre_avg']:.1f}%)보다 높지만, 가동률 조정 총요소생산성 최근 4분기 평균은 {TF['avg4']:+.2f}%."})
    return out[:5]


def main() -> None:
    payload = build()
    here = Path(__file__).parent
    base = (here / "template.html").read_text(encoding="utf-8")
    # Share the AI Pulse page's styles and chart helpers so both pages look and behave the same
    style = base[base.index("<style>"):base.index("</style>") + len("</style>")]
    helpers = base[base.index("const NS="):base.index("// ---------- 한눈에")]
    tpl = (here / "template_economy.html").read_text(encoding="utf-8").replace("__STYLE__", style).replace("__HELPERS__", helpers)
    OUT.write_text(tpl.replace("__PAYLOAD__", json.dumps(payload, ensure_ascii=False).replace("</", "<\\/")), encoding="utf-8")
    print(f"저장: {OUT.relative_to(ROOT)} ({OUT.stat().st_size/1e3:.0f} KB)")


if __name__ == "__main__":
    main()
