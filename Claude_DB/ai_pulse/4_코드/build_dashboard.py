"""AI Pulse — 2_결과물/data/ 의 정리본으로 한 페이지 HTML을 만듭니다.

    python3 4_코드/build_dashboard.py

결과: 2_결과물/ai_pulse.html (외부 라이브러리 없이 오프라인에서 열림)
"""
from __future__ import annotations

import datetime as dt
import json
import re
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "2_결과물" / "data"
OUT = ROOT / "2_결과물" / "ai_pulse.html"
TOPICS = ["AGI·초지능", "안전·위험", "스케일링·연구", "버블·투자", "일자리", "칩·인프라", "중국·지정학", "규제·정책"]
ROLES = ["연구", "엔지니어링", "하드웨어·인프라", "영업·고객", "정책·안전·운영", "기타"]


# Tone of a statement: +1 acceleration/optimism, −1 caution/worry, 0 neutral or mixed (word lists + weighted phrases)
OPT = re.compile(r"\b(transform\w*|breakthrough\w*|abundan\w*|optimis\w*|excit\w*|amazing|awesome|incredible|benefit\w*|opportunit\w*|"
                 r"boom\w*|revolution\w*|accelerat\w*|cure\w*|prosper\w*|bright|thriv\w*|unlock\w*|empower\w*|golden|renaissance|"
                 r"better|confident|bullish|game[- ]chang\w*|productiv\w*|growth|grow\w*|potential|progress|advanc\w*|innovat\w*|"
                 r"solv\w*|twice|doubl\w*|record|surg\w*|soar\w*|superpower|singularity|let's get to work)\b|"
                 r"기회|혁명|혁신|성장|낙관|돌파|기대|풍요|가능성|도약|번영|희망|확대|두 배|사상 최대|가속", re.I)
CAU = re.compile(r"\b(warn\w*|risk\w*|danger\w*|threat\w*|fear\w*|extinct\w*|catastroph\w*|doom\w*|bubble|overhyp\w*|crash\w*|"
                 r"concern\w*|worr\w*|harm\w*|unemploy\w*|job loss\w*|shut\w*|pause|scar\w*|existential|misuse|decept\w*|"
                 r"apocalyp\w*|dire|bad things|regret\w*|lose control|uncontroll\w*|wipe out|kill\w*|slow ?down|slow\w*|brake\w*|"
                 r"emergency|hobbled|limit\w*|myth|suffer\w*|safeguard\w*|guardrail\w*)\b|"
                 r"경고|위험|우려|위협|멸종|거품|버블|불안|공포|실업|통제|재앙|후회|종말|파국|한계|속도 ?조절|제동|규제 ?필요", re.I)
# Phrases that flip the plain word count (weight 2): rejecting caution = acceleration, and vice versa
OPT2 = re.compile(r"reject\w* calls? to slow|not going to let|(?:don't|do not|no) need (?:any )?new laws|"
                  r"(?:not|n't|never) (?:believe|think)\w*[^,.;]{0,40}(?:kill|destroy|wipe|doom)|fears? (?:are|is) overhyped|"
                  r"science fiction than science|규제(?:는|가)? 필요 ?없|자율에 맡", re.I)
CAU2 = re.compile(r"calls? for (?:an? )?(?:ai )?slowdown|emergency brake|should be (?:banned|stopped)|shut (?:the labs|it) down|"
                  r"통제력(?:을)? 잃", re.I)


def tone(text: str) -> int:
    o = len(OPT.findall(text)) + 2 * len(OPT2.findall(text))
    c = len(CAU.findall(text)) + 2 * len(CAU2.findall(text))
    if OPT2.search(text):  # "doesn't believe AI will kill" — the cautious word inside is negated
        c = max(0, c - 2)
    return (o > c) - (c > o)


def _tokens(s: str) -> set[str]:
    s = re.sub(r"[^\w가-힣 ]", " ", s.lower())
    words = [w for w in s.split() if len(w) >= 3 or re.search(r"[가-힣]", w)]
    ko = "".join(re.findall(r"[가-힣]", s))
    return set(words) | {ko[i:i + 2] for i in range(len(ko) - 1)}  # Korean: character bigrams


def cluster(df: pd.DataFrame, names: dict[str, set[str]], thresh: float = 0.35) -> pd.DataFrame:
    """Collapse the same statement reported by many outlets into one row (+ outlet count and sources).
    Same guru and (same quote, or headline token overlap ≥ thresh)."""
    out = []
    for g, d in df.sort_values("date").groupby("guru"):
        groups: list[dict] = []
        for row in d.itertuples():
            tk = _tokens(row.title + " " + row.quote) - names.get(g, set())  # the person's name is in every headline
            qn = re.sub(r"\W", "", row.quote.lower())
            hit = None
            for grp in groups:
                if (qn and len(qn) > 12 and qn == grp["qn"]) or len(tk & grp["tk"]) / max(1, len(tk | grp["tk"])) >= thresh:
                    hit = grp
                    break
            if hit is None:
                groups.append({"qn": qn, "tk": tk, "rows": [row]})
            else:
                hit["rows"].append(row)
                hit["tk"] |= tk
        for grp in groups:
            rows = grp["rows"]
            best = max(rows, key=lambda x: (bool(x.quote), x.lang == "en", x.date))  # prefer a quoted, then latest headline
            srcs = sorted({x.source for x in rows if isinstance(x.source, str) and x.source})
            out.append({"guru": g, "lang": best.lang, "date": max(x.date for x in rows), "first": min(x.date for x in rows),
                        "title": best.title, "quote": best.quote, "source": best.source, "link": best.link, "topics": best.topics,
                        "tone": int(np.sign(sum(x.tone for x in rows))), "outlets": len(rows), "sources": ", ".join(srcs[:12])})
    return pd.DataFrame(out)


def changes() -> dict:
    """What moved between the last two snapshots of each history file."""
    out = {"items": [], "snapshots": []}

    def two(name, key):
        h = load(name, dtype=str)
        if h is None or h[key].nunique() < 2:
            return None, None, (sorted(h[key].unique()) if h is not None else [])
        s = sorted(h[key].unique())
        return h[h[key] == s[-2]], h[h[key] == s[-1]], s
    a0, a1, snaps = two("apps_ai_history.csv", "snapshot")
    out["snapshots"] = snaps
    if a1 is not None:
        for (cc, app), g in a1.groupby(["country", "ai_app"]):
            now = int(g["rank"].astype(int).min())
            prev = a0[(a0.country == cc) & (a0.ai_app == app)]
            was = int(prev["rank"].astype(int).min()) if len(prev) else None
            if was is None:
                out["items"].append({"kind": "앱 순위", "text": f"{app} {cc} 무료 100위 안 진입 ({now}위)", "score": 100})
            elif was != now:
                out["items"].append({"kind": "앱 순위", "text": f"{app} {cc} {was}위 → {now}위", "score": abs(was - now) * 3, "up": now < was})
        for (cc, app), g in a0.groupby(["country", "ai_app"]):
            if not ((a1.country == cc) & (a1.ai_app == app)).any():
                out["items"].append({"kind": "앱 순위", "text": f"{app} {cc} 100위 밖으로 ({int(g['rank'].astype(int).min())}위였음)", "score": 60, "up": False})
    j0, j1, _ = two("jobs_history.csv", "snapshot")
    if j1 is not None:
        m = j1.merge(j0, on="company", suffixes=("", "_0"))
        for x in m.itertuples():
            d = int(x.open) - int(x.open_0)
            if abs(d) >= max(5, int(x.open_0) * 0.05):
                out["items"].append({"kind": "채용", "text": f"{x.company} 공고 {int(x.open_0):,} → {int(x.open):,} ({d:+,})", "score": abs(d) / max(1, int(x.open_0)) * 300, "up": d > 0})
    g0, g1, _ = two("github_history.csv", "snapshot")
    if g1 is not None:
        m = g1.merge(g0, on="repo", suffixes=("", "_0"))
        m["d"] = m.stars.astype(int) - m.stars_0.astype(int)
        m["pct"] = m.d / m.stars_0.astype(int) * 100
        for x in m.nlargest(3, "pct").itertuples():
            if x.d > 0:
                out["items"].append({"kind": "GitHub", "text": f"{x.repo} 스타 +{x.d:,} ({x.pct:+.2f}%)", "score": x.pct * 40, "up": True})
    h0, h1, _ = two("hf_org_history.csv", "snapshot")
    if h1 is not None:
        for d_ in (h0, h1):
            d_["share"] = d_.downloads_30d.astype(float) / d_.downloads_30d.astype(float).sum() * 100
        m = h1.merge(h0, on="org", suffixes=("", "_0"))
        m["d"] = m.share - m.share_0
        for x in m.reindex(m.d.abs().sort_values(ascending=False).index).head(2).itertuples():
            if abs(x.d) >= 0.5:
                out["items"].append({"kind": "Hugging Face", "text": f"{x.org} 다운로드 점유 {x.share_0:.1f}% → {x.share:.1f}%", "score": abs(x.d) * 20, "up": x.d > 0})
    n = load("guru_news_history.csv", dtype=str)
    if n is not None and n.seen.nunique() >= 2:
        last = n.seen.max()
        new = n[(n.seen == last) & (n.statement == "True")]
        base = n[(n.seen < last) & (n.statement == "True")].groupby("guru").size() / max(1, n[n.seen < last].seen.nunique())
        g = load("gurus.csv")
        ko = dict(zip(g.guru, g.ko)) if g is not None else {}
        for gname, k in new.groupby("guru").size().items():
            avg = base.get(gname, 0)
            if k >= 3 and k >= 2 * max(avg, 1):
                out["items"].append({"kind": "구루", "text": f"{ko.get(gname, gname)} 새 발언 헤드라인 {k}건 (평소 {avg:.0f}건)", "score": k * 5, "up": True})
    out["items"] = sorted(out["items"], key=lambda x: -x["score"])[:12]
    return out


def load(name: str, **kw) -> pd.DataFrame | None:
    p = DATA / name
    return pd.read_csv(p, **kw) if p.exists() else None


def rec(df: pd.DataFrame) -> list[dict]:
    return json.loads(df.replace({np.nan: None}).to_json(orient="records", force_ascii=False))


def r(v, d=1):
    return None if v is None or pd.isna(v) else round(float(v), d)


def build() -> dict:
    P: dict = {"generated": dt.datetime.now().strftime("%Y-%m-%d %H:%M"), "topics": TOPICS, "roles": ROLES}
    sfile = DATA / "status.json"
    P["status"] = json.loads(sfile.read_text(encoding="utf-8")) if sfile.exists() else {}

    # 1. 구루 ------------------------------------------------------------------
    G, N = load("gurus.csv"), load("guru_news.csv")
    if G is not None and N is not None:
        N = N[N.about].copy()
        N["topics"] = N.topics.fillna("")
        N = N.sort_values("date", ascending=False)
        N["quote"] = N.quote.fillna("")
        N["tone"] = [tone(t + " " + q) for t, q in zip(N.title, N.quote)]
        S = cluster(N[N.statement], {x.guru: _tokens(f"{x.guru} {x.ko} {x.surname}") for x in G.itertuples()})  # one row per distinct statement, with outlet count
        cards = []
        for g in G.itertuples():
            n = N[N.guru == g.guru]
            s = S[S.guru == g.guru]
            q = s[s.quote != ""].sort_values(["outlets", "date"], ascending=False)  # most widely reported quote
            tc = pd.Series([t for ts in n.topics for t in ts.split(",") if t]).value_counts()
            cards.append({"guru": g.guru, "ko": g.ko, "role": g.role, "articles": int(len(n)), "en": int((n.lang == "en").sum()),
                          "ko_n": int((n.lang == "ko").sum()), "statements": int(len(s)),
                          "mood": r(s.tone.mean() * 100, 0) if len(s) >= 3 else None,
                          "opt": int((s.tone > 0).sum()), "cau": int((s.tone < 0).sum()),
                          "top_quote": rec(q.head(1)[["date", "quote", "title", "link", "source", "lang", "outlets"]])[0] if len(q) else None,
                          "topics": {t: int(tc.get(t, 0)) for t in TOPICS}})
        P["gurus"] = sorted(cards, key=lambda c: -c["articles"])
        P["feed"] = rec(S.sort_values("date", ascending=False).head(600)[
            ["guru", "lang", "date", "title", "quote", "source", "link", "topics", "tone", "outlets", "sources"]])
        P["news_window"] = [N.date.min(), N.date.max()]
        # Mood index: weekly mean tone of distinct statements (+100 all optimistic, −100 all cautious)
        S["week"] = pd.to_datetime(S.date).dt.to_period("W-SUN").dt.start_time
        wk = S.groupby("week").agg(mood=("tone", "mean"), n=("tone", "size")).reset_index()
        wk = wk[wk.n >= 5]
        P["mood"] = {"now": r(S.tone.mean() * 100, 0), "opt": int((S.tone > 0).sum()), "cau": int((S.tone < 0).sum()),
                     "neu": int((S.tone == 0).sum()),
                     "weekly": [[w.strftime("%Y-%m-%d"), r(m * 100, 0), int(k)] for w, m, k in zip(wk.week, wk.mood, wk.n)]}
        P["dedup"] = {"raw": int(N.statement.sum()), "distinct": int(len(S))}
    own = load("guru_own_posts.csv")
    if own is not None and len(own):
        own["date"] = own.date.fillna("")
        latest = own.sort_values("date", ascending=False).groupby(["guru", "kind"]).head(4)
        P["own"] = rec(latest[["guru", "kind", "date", "title", "link"]])
    ven = load("guru_venues.csv")
    if ven is not None and len(ven):
        ven["gurus"] = ven.gurus.fillna("")
        P["venues"] = rec(ven.sort_values("date", ascending=False).groupby("venue").head(5)[["venue", "kind", "date", "title", "link", "gurus"]])

    P["changes"] = changes()

    # 2. SDK ------------------------------------------------------------------
    S = load("sdk_downloads.csv")
    if S is not None and len(S):
        S["date"] = pd.to_datetime(S.date)
        out = {}
        for reg, g in S.groupby("registry"):
            end = g.date.max()
            last = g[g.date > end - pd.Timedelta(days=30)].groupby("label").downloads.sum()
            prev = g[(g.date <= end - pd.Timedelta(days=30)) & (g.date > end - pd.Timedelta(days=60))].groupby("label").downloads.sum()
            tab = pd.DataFrame({"last30": last, "prev30": prev}).reset_index()
            tab["chg"] = (tab.last30 / tab.prev30 - 1) * 100
            wk = (g.assign(week=g.date.dt.to_period("W-SUN").dt.start_time).groupby(["label", "week"]).downloads.sum().reset_index())
            wk = wk[(wk.week > wk.week.min()) & (wk.week < wk.week.max())]
            vendors = ["OpenAI", "Anthropic", "Google Gen AI"]
            v = last.reindex(vendors).fillna(0)
            out[reg] = {"asof": end.strftime("%Y-%m-%d"), "table": rec(tab.sort_values("last30", ascending=False).round(1)),
                        "share": {k: r(v[k] / v.sum() * 100, 1) for k in vendors},
                        "weekly": {lab: [[d.strftime("%Y-%m-%d"), int(x)] for d, x in zip(w.week, w.downloads)] for lab, w in wk.groupby("label")}}
        P["sdk"] = out

    # 3. 채용 ------------------------------------------------------------------
    J = load("jobs_snapshot.csv")
    if J is not None and len(J):
        J["p"] = pd.to_datetime(J.published, errors="coerce")
        snap = J.snapshot.iloc[0]
        ref = pd.Timestamp(snap)
        rows = []
        for c, g in J.groupby("company"):
            mix = g.role.value_counts()
            rows.append({"company": c, "open": int(len(g)), "new30": int((g.p > ref - pd.Timedelta(days=30)).sum()),
                         "mix": {k: int(mix.get(k, 0)) for k in ROLES},
                         "top_dept": g.department.value_counts().head(3).index.tolist()})
        hist = load("jobs_history.csv")
        P["jobs"] = {"snapshot": snap, "rows": sorted(rows, key=lambda x: -x["open"]),
                     "total": int(len(J)), "new30": int((J.p > ref - pd.Timedelta(days=30)).sum()),
                     "snapshots": int(hist.snapshot.nunique()) if hist is not None else 1,
                     "hw_titles": rec(J[J.role == "하드웨어·인프라"].sort_values("p", ascending=False).head(12)[["company", "title", "published"]])}

    # 4. Hugging Face ---------------------------------------------------------
    H, T = load("hf_top_models.csv"), load("hf_trending.csv")
    if H is not None and len(H):
        org = H.groupby("org").agg(dl=("downloads_30d", "sum"), n=("model", "count")).sort_values("dl", ascending=False)
        org["share"] = org.dl / org.dl.sum() * 100
        llm = H[H.pipeline.isin(["text-generation", "image-text-to-text"])]
        lorg = llm.groupby("org").downloads_30d.sum().sort_values(ascending=False)
        P["hf"] = {"snapshot": H.snapshot.iloc[0], "orgs": rec(org.head(12).reset_index().round(1)),
                   "llm_orgs": [{"org": k, "dl": int(v), "share": r(v / lorg.sum() * 100, 1)} for k, v in lorg.head(10).items()],
                   "trending": rec(T.head(15)) if T is not None else []}

    # 5. 앱 ---------------------------------------------------------------------
    A = load("apps_top100.csv")
    if A is not None and len(A):
        a = A[A.ai_app.notna() & (A.ai_app != "")]
        piv = a.groupby(["ai_app", "country"])["rank"].min().unstack()
        P["apps"] = {"snapshot": A.snapshot.iloc[0], "rows": [{"app": k, "KR": r(v.get("KR"), 0), "US": r(v.get("US"), 0)} for k, v in piv.iterrows()],
                     "top5": {cc: A[A.country == cc].nsmallest(5, "rank")[["rank", "name"]].values.tolist() for cc in ["KR", "US"]}}

    # 6. GitHub ---------------------------------------------------------------
    R = load("github_repos.csv")
    if R is not None and len(R):
        hist = load("github_history.csv")
        R = R.sort_values("stars", ascending=False)
        if hist is not None and hist.snapshot.nunique() > 1:
            first = hist.sort_values("snapshot").groupby("repo").first().stars
            R["gain"] = R.repo.map(first).pipe(lambda s: R.stars - s)
        P["github"] = {"snapshot": R.snapshot.iloc[0], "rows": rec(R)}

    # 7. arXiv ----------------------------------------------------------------
    X = load("arxiv_monthly.csv")
    if X is not None and len(X):
        X = X.dropna(subset=["papers"]).sort_values("month")
        this_month = dt.date.today().strftime("%Y-%m")
        full = X[X.month < this_month]
        P["arxiv"] = {"series": {c: [[m + "-01", int(p)] for m, p in zip(g.month, g.papers)] for c, g in full.groupby("cat")},
                      "last": {c: {"month": g.month.iloc[-1], "v": int(g.papers.iloc[-1]),
                                   "yoy": r((g.papers.iloc[-1] / g.papers.iloc[-13] - 1) * 100, 0) if len(g) > 12 else None}
                               for c, g in full.groupby("cat")}}
    return P


def main() -> None:
    payload = build()
    tpl = Path(__file__).with_name("template.html").read_text(encoding="utf-8")
    html = tpl.replace("__PAYLOAD__", json.dumps(payload, ensure_ascii=False).replace("</", "<\\/"))
    OUT.write_text(html, encoding="utf-8")
    print(f"저장: {OUT.relative_to(ROOT)} ({OUT.stat().st_size/1e3:.0f} KB)")


if __name__ == "__main__":
    main()
