"""ACWI 종목 데이터 ↔ MSCI 편출입 이력(index_monitor) 연동.

1. membership()   : 종목별 ACWI 편입 시점·직전 이벤트·현재 상태(5·8월 리뷰 편출 반영 여부)
2. pending()      : 이 파일(앵커) 이후 리뷰의 편입(파일에 없음)·편출(파일에 남음) 목록
3. event_study()  : 편입·편출 종목의 발표일·효력일 전후 초과수익 (시장조정, 현지통화)
4. deletion_watch(): 다음 리뷰 편출 관찰 리스트 — 국가 내 누적 비중 꼬리 + 최근 수익률. 과거 리뷰로 검증(AUC)

MSCI 리뷰 일정: 발표는 장 마감 후(미 동부 기준 저녁) → 반응일 t=0 은 발표일 다음 거래일.
지수 반영은 리뷰월 마지막 영업일 종가(close), 효력은 다음 영업일(effective).
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
IM = ROOT / "index_monitor"
PIT_SRC = IM / "src"


def _pit():
    sys.path.insert(0, str(PIT_SRC))
    import msci_pit as P  # noqa: E402
    return P


def rebuild(anchor: pd.DataFrame | None = None) -> dict:
    """anchor(name·ric·isin)로 시점별 구성 재생성 후 결과 로드. anchor=None 이면 기존 산출물만 읽는다."""
    P = _pit()
    if anchor is not None:
        import contextlib
        import io
        with contextlib.redirect_stdout(io.StringIO()):
            P.main(anchor=anchor)
    iv = pd.read_csv(P.OUT / "acwi_membership_intervals.csv", dtype={"isin": str})
    for c in ("start", "end"):
        iv[c] = pd.to_datetime(iv[c])
    det = pd.read_csv(P.OUT / "acwi_anchor_detection.csv")
    reviews = P.load_reviews()
    rv = pd.DataFrame([{"review": r.tag, "announce": pd.Timestamp(r.announce), "close": pd.Timestamp(r.close),
                        "effective": pd.Timestamp(r.effective), "adds": sum(x[0] == "A" for x in r.rows),
                        "dels": sum(x[0] == "D" for x in r.rows)} for r in reviews])
    anchor_tag = P.detect_anchor_review(reviews, anchor)[0] if anchor is not None else None
    return {"iv": iv, "reviews": rv, "anchor_tag": anchor_tag, "detection": det, "counts":
            pd.read_csv(P.OUT / "acwi_pit_counts.csv")}


def membership(stocks: pd.DataFrame, pit: dict) -> pd.DataFrame:
    """stocks: code·isin. 반환 index=code: since, since_review, status, end_review, end_effective, prior_stints."""
    iv, rv = pit["iv"], pit["reviews"].set_index("review")
    by_isin = iv[iv["isin"].fillna("") != ""].sort_values("start", na_position="first").groupby("isin")
    rows = []
    for code, isin in zip(stocks["code"], stocks["isin"]):
        rec = {"code": code, "msci_since": "", "msci_since_review": "", "msci_status": "매칭 없음", "msci_end_review": "",
               "msci_end_effective": "", "msci_names": ""}
        if isinstance(isin, str) and isin in by_isin.groups:
            g = by_isin.get_group(isin)
            last = g.iloc[-1]
            rec["msci_since_review"] = last["start_review"] or ""
            rec["msci_since"] = "2013-08 이전" if pd.isna(last["start"]) else last["start"].strftime("%Y-%m-%d")
            rec["msci_names"] = str(last.get("msci_name_variants") or "")
            if pd.notna(last["end"]):
                rec["msci_status"] = "편출"
                rec["msci_end_review"] = last["end_review"]
                rec["msci_end_effective"] = last["end"].strftime("%Y-%m-%d")
            else:
                rec["msci_status"] = "구성"
            flags = str(last.get("flags") or "")
            if "weak_start_match" in flags or "weak_end_match" in flags:
                rec["msci_status"] += " (이름매칭 약함)"
        rows.append(rec)
    return pd.DataFrame(rows).set_index("code")


def pending(pit: dict, anchor_tag: str | None) -> pd.DataFrame:
    """앵커 이후 리뷰 변경: action=ADD(파일에 없음) / DEL(파일에 남아 있음)."""
    iv, rv = pit["iv"], pit["reviews"]
    if anchor_tag is None:
        return pd.DataFrame()
    eff0 = rv.loc[rv["review"] == anchor_tag, "effective"].iloc[0]
    after = rv[rv["effective"] > eff0]
    out = []
    adds = iv[iv["flags"].fillna("").str.contains("added_after_anchor")]
    for r in adds.itertuples():
        out.append({"review": r.start_review, "action": "편입 (파일에 없음)", "name": r.msci_name, "country": r.country_pool,
                    "isin": "", "code": "", "effective": r.start.strftime("%Y-%m-%d")})
    dels = iv[iv["end_review"].isin(after["review"]) & iv["isin"].fillna("").ne("")]
    for r in dels.itertuples():
        out.append({"review": r.end_review, "action": "편출 (파일에 남음)", "name": r.anchor_name, "country": r.country_pool,
                    "isin": r.isin, "code": "", "effective": r.end.strftime("%Y-%m-%d")})
    return pd.DataFrame(out)


# ───────────────────────── 이벤트 스터디 ─────────────────────────
def _tpos(idx: pd.DatetimeIndex, d: pd.Timestamp, after: bool) -> int:
    """d 다음(after=True) 또는 d 이전·당일(after=False) 첫 거래일 위치."""
    return int(idx.searchsorted(d, side="right" if after else "right") - (0 if after else 1))


def event_study(ri: pd.DataFrame, bench: pd.Series, events: pd.DataFrame, pre: int = 20, post: int = 20) -> dict:
    """events: code, review, action(ADD/DEL), announce, close, effective.
    초과수익 = 종목 일간수익률 - 벤치마크 일간수익률 (시장조정). 누적은 단순합(CAR).
    반환: per_event(요약 구간 CAR), path_ann(발표 기준 -pre..+post 평균 CAR), path_eff(효력 기준)."""
    idx = ri.index
    r = ri.ffill(limit=5).pct_change(fill_method=None).clip(-0.5, 0.5)
    br = bench.reindex(idx).pct_change()
    ar = r.sub(br, axis=0)
    rows, pa, pe = [], {}, {}
    for e in events.itertuples():
        if e.code not in ar:
            continue
        a0 = _tpos(idx, e.announce, after=True)            # 발표 다음 거래일 = t0
        c0 = _tpos(idx, e.close, after=False)              # 리밸런싱 종가일
        f0 = c0 + 1                                        # 효력일
        if a0 - pre < 1 or a0 >= len(idx):
            continue
        s = ar[e.code]
        def car(i, j):
            i, j = max(i, 1), min(j, len(idx) - 1)
            v = s.iloc[i:j + 1]
            return float(v.sum()) if v.notna().sum() >= max(1, (j - i + 1) // 2) else np.nan
        n_post = min(post, len(idx) - 1 - f0)
        rows.append({"code": e.code, "review": e.review, "action": e.action, "announce": e.announce.date(),
                     "effective": e.effective.date(),
                     "car_pre": car(a0 - pre, a0 - 1) * 100,            # 발표 전 20일 (선반영)
                     "car_ann": car(a0, a0 + 1) * 100,                  # 발표 반응 2일
                     "car_run": car(a0 + 2, c0) * 100,                  # 발표 후 ~ 리밸런싱 종가
                     "car_close": car(c0, c0) * 100,                    # 리밸런싱 당일
                     "car_post": car(f0, f0 + n_post - 1) * 100 if n_post >= 5 else np.nan,   # 효력 후 (되돌림)
                     "post_days": n_post})
        key = (e.action, e.review)
        win = s.iloc[a0 - pre:a0 + post + 1]
        if len(win) == pre + post + 1:
            pa.setdefault(key, []).append(win.fillna(0).cumsum().to_numpy() - 0)
        if f0 - pre >= 1 and f0 + post < len(idx):
            pe.setdefault(key, []).append(s.iloc[f0 - pre:f0 + post + 1].fillna(0).cumsum().to_numpy())
    per = pd.DataFrame(rows)

    def avg(paths, by_action=True):
        out = {}
        for (act, rev), arrs in paths.items():
            out.setdefault(act, []).extend(arrs)
        return {k: (np.mean(v, axis=0) * 100).round(3).tolist() for k, v in out.items()} | \
               {f"n_{k}": len(v) for k, v in out.items()}
    return {"per_event": per, "path_ann": avg(pa), "path_eff": avg(pe), "pre": pre, "post": post}


def events_from_pit(pit: dict, stocks: pd.DataFrame, first_date: pd.Timestamp, last_date: pd.Timestamp) -> pd.DataFrame:
    """파일 종목(ISIN)으로 확인되는 편입·편출 이벤트. 편입: 해당 리뷰 편입 후 앵커까지 남은 종목, 편출: 앵커 이후 편출."""
    iv, rv = pit["iv"], pit["reviews"].set_index("review")
    code_by_isin = dict(zip(stocks["isin"], stocks["code"]))
    ev = []
    for r in iv[iv["isin"].fillna("") != ""].itertuples():
        code = code_by_isin.get(r.isin)
        if not code:
            continue
        for act, tag in (("ADD", r.start_review), ("DEL", r.end_review)):
            if isinstance(tag, str) and tag in rv.index:
                x = rv.loc[tag]
                if x["announce"] - pd.Timedelta(days=35) >= first_date and x["announce"] <= last_date:
                    ev.append({"code": code, "review": tag, "action": act, "announce": x["announce"],
                               "close": x["close"], "effective": x["effective"]})
    return pd.DataFrame(ev)


# ───────────────────────── 편출 관찰 리스트 ─────────────────────────
def size_tail(stocks: pd.DataFrame) -> pd.Series:
    """국가 내 누적 비중 위치: 비중 큰 순 누적합 / 국가 합 (100 에 가까울수록 꼬리 = 작은 종목).
    MSCI 는 국가별 유동시총 약 85% 를 Standard 지수로 담고, 하한 버퍼 밖으로 밀린 종목을 편출한다.
    크기는 회사 단위로 본다(같은 회사의 여러 주식 클래스 비중 합산: FOX/FOXA, GOOG/GOOGL 등)."""
    st = stocks.set_index("code")
    w = st["wgt"].where(lambda s: s > 0)
    company = (st["name"].fillna("").str.upper()
               .str.replace(r"\b(CLASS|CL|SER|SERIES)\s+[A-Z]\b|\bPREF\w*|\bADR\b|[^A-Z0-9 ]", " ", regex=True)
               .str.split().str.join(" "))
    company = company.where(company != "", pd.Series(st.index, index=st.index))
    out = pd.Series(np.nan, index=w.index)
    for c, g in w.groupby(st["country"]):
        g = g.dropna()
        if g.empty:
            continue
        cw = g.groupby(company[g.index]).sum()
        # 비중은 반올림돼 동률이 많다(2,266종목에 734개 값). 동률 회사는 묶음의 가운데 위치를 줘서 행 순서와 무관하게 만든다.
        key = cw.round(9)                                # 0.0007729999999999 와 0.000773 을 같은 값으로
        by_w = cw.groupby(key).sum().sort_index(ascending=False)
        above = by_w.cumsum() - by_w
        cum = key.map((above + by_w / 2) / cw.sum() * 100)
        out[g.index] = company[g.index].map(cum).to_numpy()
    return out


def auc(score: pd.Series, label: pd.Series) -> float:
    s = pd.concat([score, label], axis=1).dropna()
    s.columns = ["s", "y"]
    pos, neg = s[s.y == 1]["s"], s[s.y == 0]["s"]
    if len(pos) == 0 or len(neg) == 0:
        return np.nan
    ranks = s["s"].rank()
    return float((ranks[s.y == 1].sum() - len(pos) * (len(pos) + 1) / 2) / (len(pos) * len(neg)))


def deletion_watch(stocks: pd.DataFrame, tech: pd.DataFrame, deleted_codes: set) -> tuple[pd.DataFrame, dict]:
    """점수 = 국가 내 누적비중 꼬리(백분위). 6M 수익률을 섞으면(0.7/0.3) 2026-05·08 검증 AUC 가 0.914 → 0.896 으로
    오히려 낮아져 크기 위치만 쓴다(수익률은 참고 열로 표시).
    검증: 이 파일 비중(5·8월 리뷰 이전 시점)으로 실제 5·8월 편출 종목을 얼마나 골라냈는지 AUC."""
    st = stocks.set_index("code")
    tail = size_tail(stocks)
    r6 = tech["r_6m"].reindex(st.index)
    score = tail.rank(pct=True)
    label = pd.Series(st.index.isin(deleted_codes).astype(int), index=st.index)
    mix = 0.7 * tail.rank(pct=True) + 0.3 * (-r6).rank(pct=True)
    val = {"auc_tail": auc(tail, label), "auc_ret6m": auc(-r6, label), "auc_mix_70_30": auc(mix, label),
           "auc_score": auc(score, label),
           "n_deleted": int(label.sum()), "n": int(len(label))}
    for q in (50, 100, 200):
        top = score.nlargest(q).index
        val[f"hit_top{q}"] = int(label[top].sum())
    df = pd.DataFrame({"country_tail": tail, "r_6m": r6, "watch_score": (score * 100).round(1),
                       "already_deleted": label.astype(bool)})
    df["watch_rank"] = df["watch_score"].where(~df["already_deleted"]).rank(ascending=False, method="min")
    return df, val
