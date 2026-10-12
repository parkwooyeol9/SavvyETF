"""AI Economy — AI가 매출·생산성·산업·로봇으로 번지는지 재는 수집 스크립트.

  bigtech  : 빅테크 5사 설비투자·매출, 엔비디아 매출 (SEC XBRL, 분기)
  ramp     : 미국 기업 AI 유료 도입률(전체·회사별·업종별·규모별), 직원당 AI 지출, 회사별 토큰 단가 (Ramp AI Index)
  openrouter: 모델별 토큰 처리량 순위, 모델 가격 — 스냅샷 누적
  grossing : 앱스토어 매출 순위 (한국·미국) — 스냅샷 누적
  btos     : 미국 기업 AI 사용률 (인구조사국 BTOS, 2주 단위, 업종별)
  labor    : 노동생산성·단위노동비용·개발자 채용 공고·IT서비스 고용 (FRED), 총요소생산성 (SF 연준), AI 채용 공고 비중 (Indeed)
  filings  : 공시에 AI를 언급한 회사 수와 업종 (SEC 전문검색, 분기)
  robots   : 산업용 로봇 수출 (UN Comtrade), 로봇 기업 채용, Hugging Face 로봇 모델, 로봇 노출 직업 (Anthropic)
  frontier : 모델별 지능 지수와 과제당 비용 (Artificial Analysis) — 스냅샷 누적
  infra    : 반도체·메모리·네트워크·광통신·전력 기업 분기 매출 (SEC XBRL), DRAM·NAND 현물가 (TrendForce)
  etf      : AI 관련 ETF(AIQ·BOTZ·DTCR) 실제 보유종목과 비중 (Global X)
  prices   : 주요 연구소 최신 모델 API 단가 (OpenRouter) — 비용 계산기용

사용법 (ai_pulse 폴더에서):
    python3 4_코드/fetch_economy.py
    python3 4_코드/fetch_economy.py --only ramp btos
"""
from __future__ import annotations

import argparse
import datetime as dt
import io
import json
import re
import time
import urllib.parse

import pandas as pd

from fetch_all import (BROWSER_UA, OUT, STAMP, UA, append_history, fetch, get_json, log, save)

ECON_STATUS = OUT / "econ_status.json"
STATUS: dict[str, dict] = {}


def status(key: str, **kw) -> None:
    STATUS[key] = {**kw, "updated": dt.datetime.now().isoformat(timespec="seconds")}


# ---------------------------------------------------------------------------
# 1. 빅테크 설비투자·매출 (SEC XBRL)
# ---------------------------------------------------------------------------
COMPANIES = {"Microsoft": 789019, "Alphabet": 1652044, "Amazon": 1018724, "Meta": 1326801, "Oracle": 1341439, "NVIDIA": 1045810}
CAPEX = ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"]
REVENUE = ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "RevenueFromContractWithCustomerIncludingAssessedTax"]


def _quarterly(facts: list[dict]) -> pd.Series:
    """XBRL duration facts → calendar quarters. Cash-flow items are often year-to-date only,
    so a quarter = YTD(end) − YTD(previous end) for facts sharing the same start date."""
    d = pd.DataFrame([f for f in facts if f.get("form") in ("10-Q", "10-K", "10-Q/A", "10-K/A") and "start" in f])
    if d.empty:
        return pd.Series(dtype=float)
    d["start"], d["end"] = pd.to_datetime(d.start), pd.to_datetime(d.end)
    d = d.sort_values("filed").drop_duplicates(["start", "end"], keep="last")
    d["days"] = (d.end - d.start).dt.days
    q = {e: v for e, v, n in zip(d.end, d.val, d.days) if 80 <= n <= 100}
    for _, g in d.groupby("start"):
        g = g.sort_values("end")
        prev = None
        for row in g.itertuples():
            if prev is not None and 80 <= (row.end - prev.end).days <= 100 and row.end not in q:
                q[row.end] = row.val - prev.val
            prev = row
    return pd.Series(q).sort_index()


def _concept(cik: int, tags: list[str]) -> pd.Series:
    """Companies switch revenue tags over time (e.g. Lumentum): merge them, earlier tags in the list win where both exist."""
    merged = pd.Series(dtype=float)
    for t in tags:
        try:
            j = get_json(f"https://data.sec.gov/api/xbrl/companyconcept/CIK{cik:010d}/us-gaap/{t}.json")
        except Exception:  # noqa: BLE001  tag not used by this company
            continue
        s = _quarterly(j["units"].get("USD", []))
        merged = s if merged.empty else merged.combine_first(s)
        time.sleep(0.3)
    return merged.sort_index()


def run_bigtech() -> None:
    log("1) 빅테크 설비투자·매출 (SEC XBRL)")
    rows = []
    for comp, cik in COMPANIES.items():
        cap, rev = _concept(cik, CAPEX), _concept(cik, REVENUE)
        for e in sorted(set(cap.index) | set(rev.index)):
            rows.append({"company": comp, "end": e.date().isoformat(), "capex": cap.get(e), "revenue": rev.get(e)})
    d = pd.DataFrame(rows)
    d = d[d.end >= "2019-01-01"]
    save(d, "econ_bigtech_q.csv")
    status("bigtech", ok=True, rows=len(d), first=d.end.min(), last=d.end.max(), license="SEC EDGAR XBRL (공개)")


# ---------------------------------------------------------------------------
# 2. Ramp AI Index (페이지에 들어 있는 데이터)
# ---------------------------------------------------------------------------

def _ramp_arrays(html: str) -> dict[str, list]:
    s = html.replace('\\"', '"')
    dec = json.JSONDecoder()
    out = {}
    for name in ["adoptionOverall", "adoptionVendor", "adoptionIndustry", "adoptionSize", "adoptionUsEstimate",
                 "tokenPrices", "spendPerEmployeeCurated"]:
        i = s.find(f'"{name}":[')
        if i >= 0:
            out[name] = dec.raw_decode(s, i + len(name) + 3)[0]
    return out


def run_ramp() -> None:
    log("2) Ramp AI Index — 미국 기업 AI 유료 도입")
    a = _ramp_arrays(fetch("https://ramp.com/data/ai-index", ua=BROWSER_UA).decode("utf-8", "ignore"))
    if "adoptionOverall" not in a:
        raise RuntimeError("페이지 구조가 바뀌어 데이터를 찾지 못함")
    save(pd.DataFrame(a["adoptionOverall"]), "econ_ramp_overall.csv")
    save(pd.DataFrame(a.get("adoptionVendor", [])), "econ_ramp_vendor.csv")
    save(pd.DataFrame(a.get("adoptionIndustry", [])), "econ_ramp_industry.csv")
    save(pd.DataFrame(a.get("adoptionSize", [])), "econ_ramp_size.csv")
    sp = pd.DataFrame(a.get("spendPerEmployeeCurated", []))
    save(sp, "econ_ramp_spend.csv")
    tp = pd.DataFrame(a.get("tokenPrices", []))
    if len(tp):
        tp["usd_per_mtok"] = tp.token_cost_usd_7d / tp.token_count_7d * 1e6
        save(tp, "econ_ramp_tokens.csv")
    o = a["adoptionOverall"]
    status("ramp", ok=True, rows=sum(len(v) for v in a.values()), first=o[0]["date_month"], last=o[-1]["date_month"],
           license="Ramp AI Index 공개 페이지 (출처 표기)")


# ---------------------------------------------------------------------------
# 3. OpenRouter 토큰 순위·가격
# ---------------------------------------------------------------------------

def _tok(s: str) -> float:
    m = re.match(r"([\d.]+)\s*([KMBT]?)", s)
    return float(m.group(1)) * {"": 1, "K": 1e3, "M": 1e6, "B": 1e9, "T": 1e12}[m.group(2)] if m else None


def run_openrouter() -> None:
    log("3) OpenRouter 모델별 토큰 처리량·가격")
    page = fetch("https://openrouter.ai/rankings", ua=BROWSER_UA).decode("utf-8", "ignore")
    cells = [c.strip() for c in re.split(r"<[^>]+>", page) if c.strip()]
    rows = []
    for i, c in enumerate(cells):
        m = re.fullmatch(r"([\d.]+[KMBT]?) tokens", c)
        if m and i >= 3 and re.fullmatch(r"\d{1,3}", cells[i - 3]):
            chg = cells[i + 1] if i + 1 < len(cells) and re.fullmatch(r"[+−-]?\d+%|new", cells[i + 1], re.I) else ""
            rows.append({"snapshot": STAMP, "rank": int(cells[i - 3]), "model": cells[i - 2], "author": cells[i - 1],
                         "tokens": _tok(m.group(1)), "change": chg.replace("−", "-")})
    r = pd.DataFrame(rows).drop_duplicates("rank").sort_values("rank").head(25)
    if r.empty:
        raise RuntimeError("순위 표를 찾지 못함 (페이지 구조 변경)")
    models = get_json("https://openrouter.ai/api/v1/models")["data"]
    price = {}
    for m in models:
        nm = m.get("name", "").split(": ", 1)[-1].lower()
        p = m.get("pricing") or {}
        try:
            price[nm] = (float(p.get("prompt", 0)) * 1e6, float(p.get("completion", 0)) * 1e6)
        except ValueError:
            pass
    r["in_usd_mtok"] = [price.get(x.lower(), (None, None))[0] for x in r.model]
    r["out_usd_mtok"] = [price.get(x.lower(), (None, None))[1] for x in r.model]
    save(r, "econ_openrouter_rank.csv")
    append_history(r, "econ_openrouter_history.csv", ["snapshot", "rank"])
    status("openrouter", ok=True, rows=len(r), first=STAMP, last=STAMP, models_priced=int(r.in_usd_mtok.notna().sum()),
           license="OpenRouter 공개 순위·API")


# ---------------------------------------------------------------------------
# 4. 앱스토어 매출 순위
# ---------------------------------------------------------------------------
from fetch_all import AI_APPS  # noqa: E402


def run_grossing() -> None:
    log("4) 앱스토어 매출 순위 (한국·미국)")
    rows = []
    for cc in ["kr", "us"]:
        e = get_json(f"https://itunes.apple.com/{cc}/rss/topgrossingapplications/limit=200/json")["feed"]["entry"]
        for rank, x in enumerate(e, 1):
            name = x["im:name"]["label"]
            dev = x.get("im:artist", {}).get("label", "")
            lab = next((k for k, pat in AI_APPS.items() if re.search(pat, f"{name} {dev}", re.I)), "")
            rows.append({"snapshot": STAMP, "country": cc.upper(), "rank": rank, "name": name, "ai_app": lab,
                         "category": x.get("category", {}).get("attributes", {}).get("label", "")})
    d = pd.DataFrame(rows)
    save(d, "econ_grossing.csv")
    append_history(d[d.ai_app != ""], "econ_grossing_history.csv", ["snapshot", "country", "ai_app", "name"])
    status("grossing", ok=True, rows=len(d), first=STAMP, last=STAMP, license="Apple iTunes RSS")


# ---------------------------------------------------------------------------
# 5. 인구조사국 BTOS
# ---------------------------------------------------------------------------
NAICS = {"11": "농림어업", "21": "광업", "22": "유틸리티", "23": "건설", "31": "제조", "32": "제조", "33": "제조", "42": "도매",
         "44": "소매", "45": "소매", "48": "운수·창고", "49": "운수·창고", "51": "정보(IT·미디어)", "52": "금융·보험", "53": "부동산",
         "54": "전문·과학·기술", "55": "지주회사", "56": "사업지원", "61": "교육", "62": "보건·복지", "71": "예술·여가",
         "72": "숙박·음식", "81": "기타 서비스"}


def _pct(v):
    try:
        return float(str(v).strip("%"))
    except ValueError:
        return None


def run_btos() -> None:
    log("5) 미국 기업 AI 사용률 (인구조사국 BTOS)")
    base = "https://www.census.gov/hfp/btos/downloads/"
    nat = pd.ExcelFile(io.BytesIO(fetch(base + "National.xlsx", ua=BROWSER_UA)))
    dates = pd.read_excel(nat, "Collection and Reference Dates").dropna(subset=["Smpdt"])
    ref = {str(int(s)): e for s, e in zip(dates.Smpdt, pd.to_datetime(dates["Ref End"]))}
    r = pd.read_excel(nat, "Response Estimates")
    rows = []
    for qid, lab in [(7, "now"), (24, "next6m")]:
        yes = r[(r["Question ID"] == qid) & (r["Answer"].astype(str).str.strip() == "Yes")]
        if yes.empty:
            continue
        for c in [c for c in r.columns if re.fullmatch(r"\d{6}", str(c))]:
            v = _pct(yes.iloc[0][c])
            if v is not None and str(c) in ref:
                rows.append({"period": str(c), "date": ref[str(c)].date().isoformat(), "measure": lab, "pct": v})
    d = pd.DataFrame(rows).sort_values(["measure", "date"])
    save(d, "econ_btos.csv")
    sec = pd.read_excel(io.BytesIO(fetch(base + "Sector.xlsx", ua=BROWSER_UA)), "Response Estimates")
    y = sec[(sec["Question ID"] == 7) & (sec["Answer"].astype(str).str.strip() == "Yes")]
    pc = sorted([c for c in sec.columns if re.fullmatch(r"\d{6}", str(c))], reverse=True)
    srows = []
    for row in y.itertuples(index=False):
        rr = dict(zip(sec.columns, row))
        code = str(rr["Sector"]).split(".")[0]
        vals = [(c, _pct(rr[c])) for c in pc[:6]]  # latest periods; some cells are suppressed ("S")
        vals = [x for x in vals if x[1] is not None]
        if vals and code in NAICS:
            srows.append({"naics": code, "sector": NAICS[code], "pct": round(sum(v for _, v in vals[:3]) / len(vals[:3]), 1),
                          "periods": ",".join(c for c, _ in vals[:3])})
    s = pd.DataFrame(srows).groupby("sector", as_index=False).pct.mean().round(1)  # 31-33 etc. → one sector
    save(s, "econ_btos_sector.csv")
    status("btos", ok=True, rows=len(d) + len(s), first=d.date.min(), last=d.date.max(), license="미국 정부 공개자료 (Census)")


# ---------------------------------------------------------------------------
# 6. 생산성·노동
# ---------------------------------------------------------------------------
FRED = {"OPHNFB": "노동생산성 (비농업, 시간당 산출)", "ULCNFB": "단위노동비용 (비농업)",
        "IHLIDXUSTPSOFTDEVE": "소프트웨어 개발자 채용 공고 (Indeed, 2020-02=100)", "CES6054150001": "컴퓨터 시스템 설계업 고용 (천 명)"}


def run_labor() -> None:
    log("6) 생산성·노동 (FRED, SF 연준 TFP, Indeed AI 공고)")
    frames = []
    for sid, lab in FRED.items():
        d = pd.read_csv(io.BytesIO(fetch(f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={sid}")))
        d.columns = ["date", "value"]
        d["value"] = pd.to_numeric(d.value, errors="coerce")
        frames.append(d.dropna().assign(series=sid, label=lab))
    f = pd.concat(frames)
    f = f[f.date >= "2015-01-01"]
    save(f, "econ_fred.csv")
    x = pd.read_excel(io.BytesIO(fetch("https://www.frbsf.org/wp-content/uploads/quarterly_tfp.xlsx", ua=BROWSER_UA)), "quarterly", header=1)
    x = x[x.date.astype(str).str.match(r"^\d{4}:Q\d$")]
    keep = ["date"] + [c for c in ["dLP", "dtfp", "dtfp_util", "dY"] if c in x.columns]
    x = x[keep].copy()
    x["quarter"] = x.date.str.replace(":", "-")
    save(x.drop(columns="date").dropna(subset=["dtfp"]), "econ_tfp.csv")
    ai = pd.read_csv(io.BytesIO(fetch("https://raw.githubusercontent.com/hiring-lab/ai-tracker/main/AI_posting.csv")))
    save(ai, "econ_indeed_ai.csv")
    status("labor", ok=True, rows=len(f) + len(x) + len(ai), first=f.date.min(), last=max(f.date.max(), ai.date.max()),
           license="BLS·Indeed(FRED), SF 연준, Indeed Hiring Lab (CC BY 4.0)")


# ---------------------------------------------------------------------------
# 7. 공시 속 AI (SEC 전문검색)
# ---------------------------------------------------------------------------

def sic_sector(sic: str) -> str:
    s = int(sic) if str(sic).isdigit() else 0
    if 7370 <= s <= 7379 or s in (3570, 3571, 3572, 3576, 3577, 3578, 3579, 3674, 3672):
        return "IT·소프트웨어·반도체"
    if 2830 <= s <= 2836 or 8000 <= s <= 8099 or s in (3841, 3842, 3845, 8731):
        return "제약·바이오·헬스"
    if 6000 <= s <= 6799:
        return "금융·보험·부동산"
    if 2000 <= s <= 3999:
        return "제조(비IT)"
    if 5000 <= s <= 5999:
        return "도소매"
    if 4000 <= s <= 4999:
        return "운송·통신·유틸리티"
    if 7000 <= s <= 8999:
        return "서비스(비IT)"
    return "기타"


def run_filings(quarters: int) -> None:
    log(f"7) 공시 속 AI 언급 — 최근 {quarters}개 분기 (10-Q·10-K)")
    cache = OUT / "econ_filings_ai.csv"
    have = pd.read_csv(cache, dtype={"sic": str}) if cache.exists() else pd.DataFrame()
    today = dt.date.today()
    cq = (today.month - 1) // 3
    rows = [] if have.empty else have.to_dict("records")
    for i in range(quarters, -1, -1):
        y, q = divmod(today.year * 4 + cq - i, 4)
        start = dt.date(y, q * 3 + 1, 1)
        end = (dt.date(y + (q == 3), (q * 3 + 3) % 12 + 1, 1) - dt.timedelta(days=1))
        label = f"{y}Q{q + 1}"
        if not have.empty and label in set(have.quarter) and i > 0:
            continue
        rows = [r for r in rows if r["quarter"] != label]
        url = ("https://efts.sec.gov/LATEST/search-index?q=" + urllib.parse.quote('"artificial intelligence"') +
               f"&forms=10-Q,10-K&dateRange=custom&startdt={start}&enddt={end}")
        j = get_json(url)
        rows.append({"quarter": label, "sic": "TOTAL", "sector": "합계", "filings": j["hits"]["total"]["value"]})
        for b in j["aggregations"]["sic_filter"]["buckets"]:
            rows.append({"quarter": label, "sic": b["key"], "sector": sic_sector(b["key"]), "filings": b["doc_count"]})
        time.sleep(1)
    d = pd.DataFrame(rows).sort_values(["quarter", "sic"])
    save(d, "econ_filings_ai.csv")
    status("filings", ok=True, rows=len(d), first=d.quarter.min(), last=d.quarter.max(), license="SEC EDGAR 전문검색")


# ---------------------------------------------------------------------------
# 8. 로보틱스
# ---------------------------------------------------------------------------
REPORTERS = {156: "중국", 392: "일본", 276: "독일", 410: "한국", 842: "미국", 380: "이탈리아"}
ROBOT_BOARDS = [("Figure AI", "greenhouse", "figureai"), ("Agility Robotics", "greenhouse", "agilityrobotics"),
                ("Physical Intelligence", "ashby", "physicalintelligence"), ("Waymo", "greenhouse", "waymo")]


def run_robots(years: int) -> None:
    log("8) 로보틱스 — 로봇 수출·로봇 기업 채용·로봇 AI 모델")
    cache = OUT / "econ_robot_trade.csv"
    have = pd.read_csv(cache) if cache.exists() else pd.DataFrame(columns=["reporter", "country", "year", "export_usd"])
    rows = have.to_dict("records")
    done = set(zip(have.reporter, have.year))
    for y in range(dt.date.today().year - years, dt.date.today().year):
        for code, name in REPORTERS.items():
            if (code, y) in done and y < dt.date.today().year - 1:
                continue  # past years don't change; re-check last year until it appears
            try:
                j = get_json("https://comtradeapi.un.org/public/v1/preview/C/A/HS?"
                             f"reporterCode={code}&period={y}&cmdCode=847950&flowCode=X&partnerCode=0")
                d = [x for x in j.get("data") or [] if x.get("partner2Code") in (0, None) and x.get("motCode") in (0, None)]
                if d:
                    rows = [r for r in rows if not (r["reporter"] == code and r["year"] == y)]
                    rows.append({"reporter": code, "country": name, "year": y, "export_usd": d[0]["primaryValue"]})
            except Exception as e:  # noqa: BLE001
                log(f"  Comtrade {name} {y} 실패: {e}")
            time.sleep(1.5)
    t = pd.DataFrame(rows).sort_values(["country", "year"])
    save(t, "econ_robot_trade.csv")
    jrows = []
    for comp, plat, token in ROBOT_BOARDS:
        try:
            if plat == "ashby":
                js = get_json(f"https://api.ashbyhq.com/posting-api/job-board/{token}")["jobs"]
                jrows += [{"company": comp, "title": j.get("title", ""), "department": j.get("department") or "",
                           "published": (j.get("publishedAt") or "")[:10]} for j in js]
            else:
                for dep in get_json(f"https://boards-api.greenhouse.io/v1/boards/{token}/departments")["departments"]:
                    jrows += [{"company": comp, "title": j.get("title", ""), "department": dep["name"],
                               "published": (j.get("first_published") or j.get("updated_at") or "")[:10]} for j in dep["jobs"]]
        except Exception as e:  # noqa: BLE001
            log(f"  {comp} 실패: {e}")
    jb = pd.DataFrame(jrows)
    jb["manufacturing"] = jb.title.str.contains(r"manufactur|production|assembly|supply chain|quality|technician|factory|test engineer",
                                                case=False, regex=True)
    jb["snapshot"] = STAMP
    save(jb, "econ_robot_jobs.csv")
    append_history(jb.groupby(["snapshot", "company"]).agg(open=("title", "size"), manufacturing=("manufacturing", "sum")).reset_index(),
                   "econ_robot_jobs_history.csv", ["snapshot", "company"])
    hf = get_json("https://huggingface.co/api/models?pipeline_tag=robotics&sort=downloads&direction=-1&limit=1000")
    hm = pd.DataFrame([{"model": m["id"], "org": m["id"].split("/")[0], "downloads_30d": m.get("downloads", 0), "likes": m.get("likes", 0),
                        "created": (m.get("createdAt") or "")[:10]} for m in hf])
    hm["snapshot"] = STAMP
    save(hm, "econ_hf_robotics.csv")
    append_history(pd.DataFrame([{"snapshot": STAMP, "models": len(hm), "downloads_30d": int(hm.downloads_30d.sum())}]),
                   "econ_hf_robotics_history.csv", ["snapshot"])
    ex = pd.read_csv(io.BytesIO(fetch("https://huggingface.co/datasets/Anthropic/EconomicIndex/resolve/main/robot_exposure/robot_exposure_occupations.csv")))
    save(ex.sort_values("robot_exposure_index", ascending=False), "econ_robot_exposure.csv")
    status("robots", ok=True, rows=len(t) + len(jb) + len(hm) + len(ex), first=str(t.year.min()), last=str(t.year.max()),
           license="UN Comtrade, 각 사 채용 게시판, Hugging Face, Anthropic Economic Index (CC BY)")


# ---------------------------------------------------------------------------
# 9. 모델 경쟁 — 성능 대비 비용 (Artificial Analysis 공개 페이지)
# ---------------------------------------------------------------------------
CREATORS = [(r"^claude", "Anthropic"), (r"^gpt|^o\d", "OpenAI"), (r"^gemini|^gemma", "Google"), (r"^grok", "xAI"),
            (r"^muse|^llama", "Meta"), (r"^deepseek", "DeepSeek"), (r"^qwen", "Alibaba"), (r"^glm", "Zhipu"), (r"^kimi|^k2", "Moonshot"),
            (r"^mistral|^magistral", "Mistral"), (r"^mimo", "Xiaomi"), (r"^minimax", "MiniMax"), (r"^nemotron", "NVIDIA"),
            (r"^step", "StepFun"), (r"^hy|^hunyuan", "Tencent")]


def run_frontier() -> None:
    log("9) 모델 성능 대비 비용 (Artificial Analysis)")
    s = fetch("https://artificialanalysis.ai/models", ua=BROWSER_UA).decode("utf-8", "ignore").replace('\\"', '"')
    rows = []
    for m in re.finditer(r'"intelligenceIndex":([\d.]+)', s):
        pre, post = s[max(0, m.start() - 6000):m.start()], s[m.end():m.end() + 8000]
        slug = re.findall(r'"slug":"([^"]+)"', pre)
        name = re.findall(r'"(?:shortName|name)":"([^"]+)"', pre)
        rel = re.findall(r'"releaseDate":"([^"]+)"', pre)
        cost = re.search(r'"intelligenceIndexCostPerTask":\{"cost":\{"total":([\d.]+)', post)
        if not slug or not name:
            continue
        sl = slug[-1]
        rows.append({"snapshot": STAMP, "slug": sl, "model": name[-1], "creator": next((c for p, c in CREATORS if re.search(p, sl)), "기타"),
                     "index": round(float(m.group(1)), 1), "cost_per_task": round(float(cost.group(1)), 3) if cost else None,
                     "released": rel[-1][:10] if rel else None})
    d = pd.DataFrame(rows).drop_duplicates("slug")
    if d.empty:
        raise RuntimeError("모델 데이터를 찾지 못함 (페이지 구조 변경)")
    save(d.sort_values("index", ascending=False), "econ_aa_models.csv")
    append_history(d, "econ_aa_history.csv", ["snapshot", "slug"])
    status("frontier", ok=True, rows=len(d), first=STAMP, last=STAMP, license="Artificial Analysis 공개 페이지 (출처·링크 표기)")


# ---------------------------------------------------------------------------
# 10. 인프라 병목 — 부품·설비 기업 매출 (SEC XBRL) + 메모리 현물가 (TrendForce)
# ---------------------------------------------------------------------------
INFRA = {  # company: (CIK, ticker, value-chain layer)
    "NVIDIA": (1045810, "NVDA", "반도체"), "Broadcom": (1730168, "AVGO", "반도체"), "AMD": (2488, "AMD", "반도체"),
    "Micron": (723125, "MU", "메모리"), "Arista": (1596532, "ANET", "네트워크"), "Coherent": (820318, "COHR", "광통신"),
    "Lumentum": (1633978, "LITE", "광통신"), "Vertiv": (1674101, "VRT", "전력·냉각"), "Eaton": (1551182, "ETN", "전력·냉각"),
}


def _spot_table(url: str, kind: str) -> list[dict]:
    """TrendForce public spot page: rows of item | daily high | daily low | session high | session low | session average | change."""
    s = fetch(url, ua=BROWSER_UA).decode("utf-8", "ignore")
    rows = []
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", s, re.S):
        cells = [re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", c)).strip() for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", tr, re.S)]
        if len(cells) >= 7 and re.match(r"^(DDR|LPDDR|GDDR|SLC|MLC|TLC|QLC|\d+Gb)", cells[0]):
            try:
                avg = float(cells[5].replace(",", ""))
            except ValueError:
                continue
            chg = re.search(r"(-?[\d.]+)\s*%", cells[6].replace("▼", "-").replace("&#9660;", "-"))
            rows.append({"snapshot": STAMP, "kind": kind, "item": cells[0], "avg": avg,
                         "chg_pct": float(chg.group(1)) * (-1 if ("▼" in tr or "9660" in tr) and not chg.group(1).startswith("-") else 1) if chg else None})
    return rows


def run_infra() -> None:
    log("10) 인프라 병목 — 부품·설비 기업 매출, 메모리 현물가")
    rows = []
    for comp, (cik, tic, layer) in INFRA.items():
        rev = _concept(cik, REVENUE)
        for e, v in rev.items():
            rows.append({"company": comp, "ticker": tic, "layer": layer, "end": e.date().isoformat(), "revenue": v})
    d = pd.DataFrame(rows)
    d = d[d.end >= "2021-01-01"]
    save(d, "econ_infra_q.csv")
    spot = []
    for url, kind in [("https://www.trendforce.com/price/dram/dram_spot", "DRAM"), ("https://www.trendforce.com/price/flash/flash_spot", "NAND")]:
        try:
            spot += _spot_table(url, kind)
        except Exception as e:  # noqa: BLE001
            log(f"  {kind} 현물가 실패: {e}")
    if spot:
        sp = pd.DataFrame(spot)
        save(sp, "econ_memory_spot.csv")
        append_history(sp, "econ_memory_spot_history.csv", ["snapshot", "kind", "item"])
    status("infra", ok=True, rows=len(d) + len(spot), first=d.end.min(), last=d.end.max(), spot_items=len(spot),
           license="SEC EDGAR XBRL (공개) · TrendForce 공개 현물가 (출처 표기, 재배포 전 약관 확인)")


# ---------------------------------------------------------------------------
# 11. AI ETF 실제 보유 (Global X 공개 보유종목)
# ---------------------------------------------------------------------------
ETFS = {"AIQ": "Global X 인공지능·기술", "BOTZ": "Global X 로보틱스·AI", "DTCR": "Global X 데이터센터·디지털 인프라"}


def run_etf() -> None:
    log("11) AI ETF 보유종목 (Global X)")
    rows = []
    for tic, label in ETFS.items():
        try:
            # no trailing slash: urllib on Python 3.8 won't follow the site's 308 redirect
            s = fetch(f"https://www.globalxetfs.com/funds/{tic.lower()}", ua=BROWSER_UA).decode("utf-8", "ignore").replace('\\"', '"')
        except Exception as e:  # noqa: BLE001
            log(f"  {tic} 실패: {e}")
            continue
        for m in re.finditer(r'\{"AS_OF_DATE":"\$D(\d{4}-\d{2}-\d{2})[^{}]*?"ETF_TICKER":"' + tic + r'"[^{}]*\}', s):
            o = m.group(0)
            g = lambda k: (re.search(rf'"{k}":"?([^",}}]*)"?', o) or [None, None])[1]  # noqa: E731
            w = g("PERCENT_OF_NET_ASSETS")
            rows.append({"etf": tic, "etf_label": label, "as_of": m.group(1), "ticker": (g("SECURITY_TICKER") or "").split(" ")[0],
                         "name": g("SECURITY_DESCRIPTION"), "weight": float(w) if w not in (None, "", "null") else None})
        time.sleep(1)
    d = pd.DataFrame(rows).drop_duplicates(["etf", "ticker", "name"])
    if d.empty:
        raise RuntimeError("보유종목을 찾지 못함 (페이지 구조 변경)")
    save(d, "econ_etf_holdings.csv")
    status("etf", ok=True, rows=len(d), first=d.as_of.min(), last=d.as_of.max(), etfs=sorted(d.etf.unique().tolist()),
           license="Global X 공개 보유종목 (출처 표기)")


# ---------------------------------------------------------------------------
# 12. 주요 모델 API 가격 (OpenRouter) — 비용 계산기용
# ---------------------------------------------------------------------------
LABS = {"anthropic": "Anthropic", "openai": "OpenAI", "google": "Google", "x-ai": "xAI", "deepseek": "DeepSeek",
        "meta-llama": "Meta", "mistralai": "Mistral", "qwen": "Alibaba", "moonshotai": "Moonshot", "z-ai": "Zhipu"}


def run_prices() -> None:
    log("12) 주요 모델 API 가격 (OpenRouter)")
    rows = []
    for m in get_json("https://openrouter.ai/api/v1/models")["data"]:
        lab = m["id"].split("/")[0]
        p = m.get("pricing") or {}
        if lab not in LABS or ":free" in m["id"]:
            continue
        try:
            pin, pout = float(p.get("prompt") or 0) * 1e6, float(p.get("completion") or 0) * 1e6
        except ValueError:
            continue
        if pin <= 0:
            continue
        rows.append({"snapshot": STAMP, "id": m["id"], "model": m.get("name", "").split(": ", 1)[-1], "lab": LABS[lab],
                     "created": dt.datetime.utcfromtimestamp(m.get("created", 0)).date().isoformat(), "in_usd_mtok": round(pin, 4),
                     "out_usd_mtok": round(pout, 4), "context": m.get("context_length")})
    d = pd.DataFrame(rows).sort_values("created", ascending=False)
    d = d.groupby("lab").head(4)  # newest 4 per lab
    save(d, "econ_model_prices.csv")
    append_history(d, "econ_model_prices_history.csv", ["snapshot", "id"])
    status("prices", ok=True, rows=len(d), first=STAMP, last=STAMP, license="OpenRouter 공개 API")


# ---------------------------------------------------------------------------

def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    keys = ["bigtech", "ramp", "openrouter", "grossing", "btos", "labor", "filings", "robots", "frontier", "infra", "etf", "prices"]
    ap.add_argument("--only", nargs="*", choices=keys)
    ap.add_argument("--filing-quarters", type=int, default=12)
    ap.add_argument("--trade-years", type=int, default=10)
    a = ap.parse_args()
    if ECON_STATUS.exists():
        STATUS.update(json.loads(ECON_STATUS.read_text(encoding="utf-8")))
    jobs = {"bigtech": run_bigtech, "ramp": run_ramp, "openrouter": run_openrouter, "grossing": run_grossing, "btos": run_btos,
            "labor": run_labor, "filings": lambda: run_filings(a.filing_quarters), "robots": lambda: run_robots(a.trade_years),
            "frontier": run_frontier, "infra": run_infra, "etf": run_etf, "prices": run_prices}
    for k in a.only or keys:
        try:
            jobs[k]()
        except Exception as e:  # noqa: BLE001  keep going with the other sources
            log(f"  !! {k} 실패: {e}")
            status(k, ok=False, note=str(e)[:300])
        ECON_STATUS.write_text(json.dumps(STATUS, ensure_ascii=False, indent=2), encoding="utf-8")
    log("완료. 다음: python3 4_코드/build_economy.py")


if __name__ == "__main__":
    main()
