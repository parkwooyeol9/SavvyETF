"""MSCI ACWI 시점별 구성종목(Point-in-Time membership) 재구성.

목적: 팩터 분석·백테스트에서 '그 시점의 ACWI 구성종목'만 쓰도록(생존편향·look-ahead 제거)
      편입/편출 구간(interval) 테이블을 만든다.

입력
  1) 리뷰별 편출입 PSV   data/raw/msci/web_psv/*.psv  (T/S/A/D 라인, src/validate_msci_psv.py 참고)
                          data/raw/msci/pdf_psv/*.psv  (로컬 PDF 파싱본, 있으면 웹본보다 우선)
  2) 앵커(현재 구성종목)  Claude_DB/data/ACWI_raw.xlsx → UNIVERSE 시트 (RIC·ISIN·종목명·Wgt)
     앵커 시점 = 가장 최근 리뷰 반영 이후. Wgt > 0 인 종목만.

방법 (뒤로 걷기)
  S(앵커) 에서 시작해 최신 리뷰부터 과거로:
    - 리뷰 r 의 편입 종목 a : 현재 집합에서 같은 종목을 찾아 start = effective(r) 로 닫고 집합에서 뺀다
    - 리뷰 r 의 편출 종목 d : 이름만 있는 노드를 만들어 end = effective(r) 로 집합에 넣는다
  끝까지 남은 노드는 start = '커버리지 시작 이전(≤ 첫 리뷰)'.

한계 (출력 플래그로 표시)
  - 리뷰 사이의 기업 이벤트(IPO 조기편입, 인수합병 편출, 분할)는 공개 리스트에 없다.
      · 앵커에 있는데 편입 기록이 없는 IPO 종목 → 과거로 잘못 늘어남  → listing_date 로 자르기 권장
      · 편입 후 인수돼 사라진 종목 → 편입 노드가 앵커에서 안 찾아짐 → end 미상(end_reason=corporate_event?)
  - MSCI 리스트는 이름만 제공 → 이름 매칭(국가 풀 + 퍼지). 점수 낮은 매칭은 match_flag 로 표시.
  - 2013-05 이전은 MSCI가 종목 리스트를 공개하지 않음.

출력 (data/out/)
  acwi_membership_intervals.csv  노드별 [start, end) 구간
  acwi_review_events.csv         리뷰 × 종목 이벤트 (발표일·반영일 포함)
  acwi_pit_counts.csv            리뷰 시점별 재구성 구성종목 수
  acwi_unmatched.csv             매칭 실패·의심 목록 (수기/Datastream 보정 대상)

사용
  python src/msci_pit.py
  from msci_pit import members_asof;  members_asof("2019-06-28")
"""
from __future__ import annotations

import calendar
import datetime as dt
import re
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data/raw/msci"
OUT = ROOT / "data/out"
ANCHOR_XLSX = ROOT.parent / "data/ACWI_raw.xlsx"  # Claude_DB/data/ACWI_raw.xlsx

MONTHS = {m: i for i, m in enumerate(calendar.month_abbr) if m}
MATCH_OK, MATCH_WEAK = 0.88, 0.80

# ── 국가 매핑 ────────────────────────────────────────────────────────────────
RIC_COUNTRY = {
    "T": "JAPAN", "NS": "INDIA", "BO": "INDIA", "SS": "CHINA", "SZ": "CHINA", "TO": "CANADA", "KS": "KOREA",
    "KQ": "KOREA", "TW": "TAIWAN", "TWO": "TAIWAN", "L": "UNITED KINGDOM", "DE": "GERMANY", "PA": "FRANCE",
    "AX": "AUSTRALIA", "S": "SWITZERLAND", "ST": "SWEDEN", "SA": "BRAZIL", "SE": "SAUDI ARABIA",
    "J": "SOUTH AFRICA", "KL": "MALAYSIA", "AS": "NETHERLANDS", "MI": "ITALY", "MX": "MEXICO", "MC": "SPAIN",
    "JK": "INDONESIA", "CO": "DENMARK", "SI": "SINGAPORE", "HE": "FINLAND", "WA": "POLAND", "BK": "THAILAND",
    "BR": "BELGIUM", "OL": "NORWAY", "IS": "TURKEY", "PS": "PHILIPPINES", "TA": "ISRAEL", "QA": "QATAR",
    "AD": "UNITED ARAB EMIRATES", "DU": "UNITED ARAB EMIRATES", "SN": "CHILE", "AT": "GREECE", "MM": "RUSSIA",
    "KW": "KUWAIT", "VI": "AUSTRIA", "NZ": "NEW ZEALAND", "I": "IRELAND", "LS": "PORTUGAL", "BU": "HUNGARY",
    "PR": "CZECH REPUBLIC", "CA": "EGYPT", "CN": "COLOMBIA", "LU": "SOUTH AFRICA",
}
ISIN_COUNTRY = {"US": "USA", "IL": "ISRAEL", "CN": "CHINA", "HK": "HONG KONG", "IE": "IRELAND", "NL": "NETHERLANDS"}


def anchor_country_pool(ric: str, isin: str) -> set[str]:
    suf = ric.split(".")[-1] if "." in ric else ""
    suf = suf.split("^")[0]
    if suf == "HK":
        return {"CHINA", "HONG KONG"}
    if suf in ("", "O", "K", "N", "A"):  # 미국 상장: 외국 발행사는 MSCI가 본국에 분류할 수 있음 → 전 국가 허용
        return {"USA"} if isin[:2] == "US" else {"*"}
    pool = {RIC_COUNTRY.get(suf, "*")}
    if isin[:2] in ISIN_COUNTRY:
        pool.add(ISIN_COUNTRY[isin[:2]])
    return pool


# ── 이름 정규화 ──────────────────────────────────────────────────────────────
ABBR = [
    (r"\bINTERNATIONAL\b", "INTL"), (r"\bHOLDINGS?\b", "HLDGS"), (r"\bHLDG\b", "HLDGS"), (r"\bGROUP\b", "GRP"),
    (r"\bTECHNOLOGY\b|\bTECHNOLOGIES\b", "TECH"), (r"\bCORPORATION\b", "CORP"), (r"\bCOMPANY\b", "CO"),
    (r"\bMANUFACTURING\b", "MFG"), (r"\bINDUSTRIES\b|\bINDUSTRIAL\b|\bINDUSTRY\b", "IND"),
    (r"\bFINANCIAL\b", "FINL"), (r"\bPROPERTIES\b", "PPTYS"), (r"\bSERVICES\b", "SVCS"),
    (r"\bPHARMACEUTICALS?\b", "PHARMA"), (r"\bELECTRONICS?\b", "ELEC"), (r"\bCOMMUNICATIONS?\b", "COMM"),
    (r"\bDEVELOPMENT\b", "DEV"), (r"\bLABORATORIES\b", "LABS"), (r"\bMANAGEMENT\b", "MGMT"),
    (r"\bENGINEERING\b|\bENGR\b", "ENG"), (r"\bCONSTRUCTION\b|\bCONSTR\b|\bCONS\b", "CONST"),
    (r"\bCAPITAL\b", "CAP"), (r"\bFINANCE\b", "FIN"), (r"\bMINERALS?\b", "MIN"), (r"\bINTERNASIONAL\b", "INTL"),
    (r"\bAND\b", " "), (r"&", " "),
]
STOP = {"CORP", "CO", "INC", "LTD", "LIMITED", "PLC", "SA", "AG", "NV", "SE", "AB", "ASA", "OYJ", "SPA", "BHD",
        "BERHAD", "TBK", "PT", "PCL", "PJSC", "PSC", "QPSC", "SJSC", "SAOG", "KSCP", "KGAA", "SAB", "DE", "CV", "THE",
        "LLC", "LP", "KK", "ON", "PN", "ADR", "NEW", "HK", "CN", "US", "GB", "BR", "NAM", "VV", "SV", "RNC", "SDR",
        "UNITS", "UNIT", "REIT", "HOLDING", "HLDGS", "GRP", "NYRT", "AS", "SPA", "SCA", "PUBLIC", "COMPANY"}


def norm_name(s) -> str:
    s = str(s or "").upper()
    s = re.sub(r"\(HK-C\)|HK-C|\(HK\)|\(CN\)|\(NEW\)|\(US\)|\(GB\)|\(BR\)", " ", s)
    s = re.sub(r"(?<=[A-Z])&(?=[A-Z])", "", s)          # H&H → HH, AT&T → ATT
    # 하이픈 뒤/앞이 2글자 이하면 붙인다: SNAP-ON → SNAPON (ON 이 브라질 주식 표기로 지워져 SNAP 과 같아지던 문제).
    # KELUN-BIOTECH 처럼 양쪽이 긴 단어면 띄어쓰기로 둔다 (MSCI 표기 'KELUN BIOTECH' 과 맞추기 위해)
    s = re.sub(r"\b([A-Z]{1,2})-(?=[A-Z])|(?<=[A-Z])-([A-Z]{1,2})\b", lambda m: (m.group(1) or "") + (m.group(2) or ""), s)
    s = re.sub(r"\b([A-Z])\.(?=[A-Z]\.)", r"\1", s)     # P.J.S.C. → PJSC., K.K → KK
    s = re.sub(r"[^A-Z0-9& ]", " ", s)
    for pat, rep in ABBR:
        s = re.sub(pat, rep, s)
    toks = [t for t in s.split() if t not in STOP and len(t) > 1]
    return " ".join(toks)


def _tok_match(x: str, y: str) -> bool:
    return x == y or (min(len(x), len(y)) >= 3 and (x.startswith(y) or y.startswith(x)))


def score(a: str, b: str) -> float:
    """a=MSCI 표기(정규화), b=후보(정규화). 0~1."""
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    ta, tb = a.split(), b.split()
    seq = SequenceMatcher(None, a, b).ratio()
    seq_sorted = SequenceMatcher(None, " ".join(sorted(ta)), " ".join(sorted(tb))).ratio()
    inter = sum(any(_tok_match(x, y) for y in tb) for x in ta)
    tok = inter / max(len(ta), len(tb))
    first = 1.0 if _tok_match(ta[0], tb[0]) else 0.0
    s = max(seq, seq_sorted, 0.5 * tok + 0.2 * first + 0.3 * seq)
    if not first and seq_sorted < 0.9:   # 첫 단어가 다르면(TOYOTA↔TORAY) 상한
        s = min(s, 0.75)
    # MSCI 이름(a)의 모든 토큰이 후보 앞쪽에 접두 일치 → 잘린 이름 (예: MAKKAH CONS ↔ MAKKAH CONSTRUCTION DEV)
    if len(ta) >= 2 and inter == len(ta) and first:
        s = max(s, 0.9)
    if len(a) >= 16 and (b.startswith(a) or a.startswith(b)):
        s = max(s, 0.95)
    # 짧은 쪽 이름의 토큰 전부가 긴 쪽 앞부분과 정확히 일치 (FERGUSON ↔ FERGUSON ENTERPRISES,
    # PARKLAND FUEL ↔ PARKLAND). 짧은 쪽이 6자 미만이면 너무 일반적이라 제외.
    short, long_ = (ta, tb) if len(ta) <= len(tb) else (tb, ta)
    if len(" ".join(short)) >= 6 and long_[: len(short)] == short and len(long_) - len(short) <= 2:
        s = max(s, 0.88)
    return s


def share_class_ok(country: str, msci_name: str, ric: str) -> bool:
    """중국: A주(HK-C 표기) ↔ .SS/.SZ, 그 외(H·레드칩·ADR) ↔ 비 A주. 앵커 없는 이름 노드는 통과."""
    if not ric or country != "CHINA":
        return True
    is_a_msci = "HK-C" in msci_name.upper()
    is_a_ric = ric.endswith(".SS") or ric.endswith(".SZ")
    return is_a_msci == is_a_ric


# ── 리뷰 메타 ────────────────────────────────────────────────────────────────
def last_business_day(y: int, m: int) -> dt.date:
    d = dt.date(y, m, calendar.monthrange(y, m)[1])
    while d.weekday() >= 5:
        d -= dt.timedelta(days=1)
    return d


def next_business_day(d: dt.date) -> dt.date:
    d += dt.timedelta(days=1)
    while d.weekday() >= 5:
        d += dt.timedelta(days=1)
    return d


@dataclass
class Review:
    tag: str            # 'Aug26'
    announce: dt.date
    close: dt.date      # 반영 기준 종가일(리뷰 월 말 영업일, 근사)
    effective: dt.date  # 다음 영업일
    rows: list = field(default_factory=list)  # (action, country, name_raw)


def parse_title_date(t: str) -> dt.date | None:
    m = re.search(r"([A-Z][a-z]+)\s+(\d{1,2}),\s*(\d{4})", t or "")
    if not m:
        return None
    return dt.datetime.strptime(f"{m.group(1)} {m.group(2)} {m.group(3)}", "%B %d %Y").date()


def load_reviews() -> list[Review]:
    files = {}
    for sub in ("web_psv", "pdf_psv"):  # pdf_psv 가 나중에 덮어써 우선
        for f in sorted((RAW / sub).glob("MSCI_*_ST.psv")):
            files[f.name.split("_")[1]] = f
    overrides = {}
    dates_csv = RAW / "review_dates.csv"  # 선택: tag,announce,close,effective (ir_dates 로 정확히 맞출 때)
    if dates_csv.exists():
        for r in pd.read_csv(dates_csv, dtype=str).itertuples():
            overrides[r.tag] = r
    out = []
    for tag, f in files.items():
        mon, yy = tag[:3], 2000 + int(tag[3:])
        title, rows = None, []
        for line in f.read_text(encoding="utf-8").splitlines():
            p = [x.strip() for x in line.split("|")]
            if p[0] == "T":
                title = p[1]
            elif p[0] in ("A", "D") and len(p) >= 3 and p[2] and p[2].upper() != "NONE":
                rows.append((p[0], " ".join(p[1].upper().split()), p[2]))
        close = last_business_day(yy, MONTHS[mon])
        rv = Review(tag, parse_title_date(title) or close, close, next_business_day(close), rows)
        if tag in overrides:
            o = overrides[tag]
            rv.announce, rv.close, rv.effective = (dt.date.fromisoformat(o.announce), dt.date.fromisoformat(o.close),
                                                   dt.date.fromisoformat(o.effective))
        out.append(rv)
    return sorted(out, key=lambda r: r.effective)


# ── 앵커 ─────────────────────────────────────────────────────────────────────
def load_anchor(path: Path = ANCHOR_XLSX) -> pd.DataFrame:
    raw = pd.read_excel(path, sheet_name="UNIVERSE", header=None, skiprows=3)
    df = pd.DataFrame({"wgt": pd.to_numeric(raw[0], errors="coerce"), "ric": raw[17], "isin": raw[18],
                       "name": raw[36], "sector": raw[38]})
    df = df[df["ric"].notna() & (df["wgt"].fillna(0) > 0)].copy()
    for c in ("ric", "isin", "name"):
        df[c] = df[c].fillna("").astype(str)
    return df.drop_duplicates("isin").reset_index(drop=True)


# ── 재구성 ───────────────────────────────────────────────────────────────────
@dataclass
class Node:
    nid: int
    pool: set
    names: list           # 정규화 이름 후보들(앵커명 + MSCI 표기)
    isin: str = ""
    ric: str = ""
    anchor_name: str = ""
    msci_names: list = field(default_factory=list)
    start: dt.date | None = None
    start_review: str = ""
    end: dt.date | None = None   # exclusive (이 날부터 비구성)
    end_review: str = ""
    end_reason: str = ""
    start_score: float | None = None
    end_score: float | None = None
    flags: list = field(default_factory=list)


def best_match(active: list, country: str, name_raw: str):
    q = norm_name(name_raw)
    best, bs = None, 0.0
    for n in active:
        if (country not in n.pool and "*" not in n.pool) or not share_class_ok(country, name_raw, n.ric):
            continue
        sc = max(score(q, x) for x in n.names)
        if sc > bs:
            best, bs = n, sc
    return best, bs


def detect_anchor_review(reviews: list, anchor) -> tuple[str | None, pd.DataFrame]:
    """앵커가 어느 리뷰까지 반영된 구성인지 추정: 편입 종목 포함률↑, 편출 종목 포함률↓ 인 마지막 리뷰."""
    probe = [Node(i, anchor_country_pool(r["ric"], r["isin"]), [norm_name(r["name"])], r["isin"], r["ric"], r["name"])
             for i, r in enumerate(anchor.to_dict("records"))]
    rows = []
    for rv in reviews:
        hit = {"A": [0, 0], "D": [0, 0]}
        for act, ctry, name in rv.rows:
            n, sc = best_match(probe, ctry, name)
            hit[act][1] += 1
            hit[act][0] += int(sc >= 0.95)
        a = hit["A"][0] / max(1, hit["A"][1])
        d = hit["D"][0] / max(1, hit["D"][1])
        rows.append({"review": rv.tag, "effective": rv.effective, "adds_in_anchor": round(a, 2),
                     "dels_in_anchor": round(d, 2), "reflected": a - d > 0.3})
    df = pd.DataFrame(rows)
    refl = df[df.reflected]
    return (refl.iloc[-1]["review"] if len(refl) else None), df


def reconstruct(reviews: list, anchor: pd.DataFrame, anchor_tag: str):
    """anchor_tag 리뷰 반영 직후 구성 = 앵커. 그 이전 리뷰는 뒤로, 이후 리뷰는 앞으로 적용."""
    nodes, active, nid, issues = [], [], 0, []
    for r in anchor.to_dict("records"):
        n = Node(nid, anchor_country_pool(r["ric"], r["isin"]), [norm_name(r["name"])], r["isin"], r["ric"], r["name"],
                 end_reason="active@anchor")
        nodes.append(n)
        active.append(n)
        nid += 1
    order = [rv.tag for rv in reviews]
    k = order.index(anchor_tag)
    before, after = reviews[: k + 1], reviews[k + 1:]

    # ── 앞으로: 앵커 이후 리뷰 ───────────────────────────────────────────────
    for rv in after:
        for act, ctry, name in [x for x in rv.rows if x[0] == "D"]:
            cand = [a for a in active if a.end is None]
            n, sc = best_match(cand, ctry, name)
            if n is not None and sc >= MATCH_WEAK:
                n.end, n.end_review, n.end_reason = rv.effective, rv.tag, "review_deletion"
                n.end_score = round(sc, 3)
                n.msci_names.append(name)
                if sc < MATCH_OK:
                    n.flags.append(f"weak_end_match:{rv.tag}")
            else:  # 지수에는 있었지만 앵커(ETF 기반 유니버스)에는 없던 종목
                m = Node(nid, {ctry}, [norm_name(name)], msci_names=[name], end=rv.effective, end_review=rv.tag,
                         end_reason="review_deletion", flags=["not_in_anchor"])
                nid += 1
                nodes.append(m)
                active.append(m)
                issues.append({"review": rv.tag, "action": "DEL_NOT_IN_ANCHOR", "country": ctry, "name": name,
                               "best_candidate": n.anchor_name if n else "", "score": round(sc, 3)})
        for act, ctry, name in [x for x in rv.rows if x[0] == "A"]:
            m = Node(nid, {ctry}, [norm_name(name)], msci_names=[name], start=rv.effective, start_review=rv.tag,
                     end_reason="active@latest_review", flags=["added_after_anchor"])
            nid += 1
            nodes.append(m)
            active.append(m)

    # ── 뒤로: 앵커 이전 리뷰 ─────────────────────────────────────────────────
    pool = [a for a in active if a.start is None]  # 앵커 시점(=anchor_tag 직후)에 구성이던 노드
    for rv in sorted(before, key=lambda x: x.effective, reverse=True):
        for act, ctry, name in [x for x in rv.rows if x[0] == "A"]:
            n, sc = best_match(pool, ctry, name)
            if n is not None and sc >= MATCH_WEAK:
                n.start, n.start_review, n.start_score = rv.effective, rv.tag, round(sc, 3)
                n.msci_names.append(name)
                if sc < MATCH_OK:
                    n.flags.append(f"weak_start_match:{rv.tag}")
                pool.remove(n)
            else:
                # 앵커에 없음: (a) 지수엔 있으나 ETF 기반 앵커에서 빠진 종목(중국 A주 다수) 또는
                #             (b) 리뷰 사이 기업 이벤트(인수·상폐)로 편출 → 종료일 미상
                m = Node(nid, {ctry}, [norm_name(name)], msci_names=[name], start=rv.effective, start_review=rv.tag,
                         end_reason="unknown", flags=["added_not_in_anchor"])
                nid += 1
                nodes.append(m)
                issues.append({"review": rv.tag, "action": "ADD_NOT_IN_ANCHOR", "country": ctry, "name": name,
                               "best_candidate": (n.anchor_name or (n.msci_names[:1] or [""])[0]) if n else "",
                               "score": round(sc, 3)})
        for act, ctry, name in [x for x in rv.rows if x[0] == "D"]:
            dup, ds = best_match([a for a in pool if a.isin], ctry, name)
            if dup is not None and ds >= 0.97:
                dup.flags.append(f"anchor_member_deleted_in:{rv.tag}")
                issues.append({"review": rv.tag, "action": "DEL_BUT_IN_ANCHOR", "country": ctry, "name": name,
                               "best_candidate": dup.anchor_name, "score": round(ds, 3)})
            m = Node(nid, {ctry}, [norm_name(name)], msci_names=[name], end=rv.effective, end_review=rv.tag,
                     end_reason="review_deletion")
            nid += 1
            nodes.append(m)
            pool.append(m)
    for n in pool:
        n.start_review = "<coverage"
        n.flags.append("start_before_coverage")
    return nodes, issues


def to_frames(nodes: list[Node], reviews: list[Review], first: dt.date | None):
    iv = pd.DataFrame([{
        "node_id": n.nid, "isin": n.isin, "ric": n.ric, "anchor_name": n.anchor_name,
        "msci_name": (n.msci_names[0] if n.msci_names else ""), "msci_name_variants": ";".join(dict.fromkeys(n.msci_names)),
        "country_pool": ",".join(sorted(n.pool)), "start": n.start, "start_review": n.start_review,
        "start_match_score": n.start_score, "end": n.end, "end_review": n.end_review, "end_reason": n.end_reason, "end_match_score": n.end_score,
        "flags": ";".join(n.flags),
    } for n in nodes])
    ev = pd.DataFrame([{"review": r.tag, "announce_date": r.announce, "close_date": r.close,
                        "effective_date": r.effective, "action": a, "country": c, "name": nm}
                       for r in reviews for a, c, nm in r.rows])
    return iv, ev


def members_asof(date, intervals: pd.DataFrame | None = None, coverage_start=None,
                 include_unknown_end: bool = True) -> pd.DataFrame:
    """date 시점(장 시작 기준)의 ACWI 구성종목. start 결측 = 커버리지 이전부터 구성.
    include_unknown_end=False 면 '편입 후 정기리뷰 편출 기록도 없고 앵커에도 없는' 노드(end_reason=unknown:
    리뷰 사이 인수·상폐, 또는 ETF 기반 앵커에서 빠진 중국 A주 등)를 뺀다."""
    if intervals is None:
        intervals = pd.read_csv(OUT / "acwi_membership_intervals.csv", parse_dates=["start", "end"])
    if not include_unknown_end:
        intervals = intervals[intervals["end_reason"] != "unknown"]
    d = pd.Timestamp(date)
    s, e = pd.to_datetime(intervals["start"]), pd.to_datetime(intervals["end"])
    m = (s.isna() | (s <= d)) & (e.isna() | (e > d))
    return intervals[m]


def membership_matrix(dates, intervals: pd.DataFrame | None = None, id_col: str = "isin") -> pd.DataFrame:
    """백테스트용 0/1 마스크 (index=날짜, columns=id). id 가 비어 있는 노드는 제외되므로
    data/out/acwi_name_map_todo.csv 를 채워 isin 을 붙이면 커버리지가 늘어난다."""
    if intervals is None:
        intervals = pd.read_csv(OUT / "acwi_membership_intervals.csv", parse_dates=["start", "end"])
    iv = intervals[intervals[id_col].fillna("").astype(str) != ""].copy()
    s, e = pd.to_datetime(iv["start"]), pd.to_datetime(iv["end"])
    idx = pd.DatetimeIndex(pd.to_datetime(list(dates)))
    cols = {}
    for key, ss, ee in zip(iv[id_col], s, e):
        m = ((ss is pd.NaT) | pd.isna(ss) | (idx >= ss)) & (pd.isna(ee) | (idx < ee))
        cols[key] = cols.get(key, 0) | m.astype(int)  # 같은 id 의 여러 구간(재편입) 합치기
    return pd.DataFrame(cols, index=idx)


def export_name_map_todo(iv: pd.DataFrame) -> pd.DataFrame:
    """ISIN 이 없는 노드(앵커 이전 편출, 앵커 밖 편입) → 식별자 매핑 작업 목록."""
    todo = iv[iv["isin"].fillna("") == ""].copy()
    todo["country"] = todo["country_pool"]
    todo["start"], todo["end"] = pd.to_datetime(todo["start"]), pd.to_datetime(todo["end"])
    todo["end_review"] = todo["end_review"].fillna("").astype(str)
    out = (todo.groupby(["msci_name", "country"], dropna=False)
           .agg(first_seen=("start", "min"), last_end=("end", "max"), reviews=("end_review", lambda x: ";".join(sorted(set(map(str, x)) - {"", "nan"}))),
                n_intervals=("node_id", "count"))
           .reset_index())
    out["isin"] = ""
    out["ric"] = ""
    out["note"] = ""
    return out.sort_values(["country", "msci_name"])


def main(anchor_tag: str | None = None, anchor: pd.DataFrame | None = None):
    """anchor: 컬럼 name·ric·isin 을 가진 DataFrame (없으면 ACWI_raw.xlsx). intake.py --pit 가 새 파일로 호출."""
    OUT.mkdir(parents=True, exist_ok=True)
    reviews = load_reviews()
    anchor = load_anchor() if anchor is None else anchor
    detected, det = detect_anchor_review(reviews, anchor)
    anchor_tag = anchor_tag or detected
    det.to_csv(OUT / "acwi_anchor_detection.csv", index=False)
    nodes, issues = reconstruct(reviews, anchor, anchor_tag)
    iv, ev = to_frames(nodes, reviews, None)
    iv.to_csv(OUT / "acwi_membership_intervals.csv", index=False, encoding="utf-8-sig")
    ev.to_csv(OUT / "acwi_review_events.csv", index=False, encoding="utf-8-sig")
    pd.DataFrame(issues).to_csv(OUT / "acwi_unmatched.csv", index=False, encoding="utf-8-sig")
    counts = []
    for r in reviews:
        counts.append({"review": r.tag, "announce": r.announce, "effective": r.effective,
                       "members_before": len(members_asof(r.close, iv)), "members_after": len(members_asof(r.effective, iv)),
                       "confirmed_after": len(members_asof(r.effective, iv, include_unknown_end=False)),
                       "adds": sum(x[0] == "A" for x in r.rows), "dels": sum(x[0] == "D" for x in r.rows)})
    pd.DataFrame(counts).to_csv(OUT / "acwi_pit_counts.csv", index=False, encoding="utf-8-sig")
    todo = export_name_map_todo(iv)
    todo_path = RAW / "name_map.csv"   # 사람이 채우는 매핑(있으면 intervals 에 isin 반영)
    if todo_path.exists():
        nm = pd.read_csv(todo_path, dtype=str).fillna("")
        nm = nm[nm["isin"] != ""]
        key = dict(zip(zip(nm["msci_name"], nm["country"]), zip(nm["isin"], nm["ric"])))
        for i, r in iv[iv["isin"].fillna("") == ""].iterrows():
            hit = key.get((r["msci_name"], r["country_pool"]))
            if hit:
                iv.at[i, "isin"], iv.at[i, "ric"] = hit
        iv.to_csv(OUT / "acwi_membership_intervals.csv", index=False, encoding="utf-8-sig")
        todo = export_name_map_todo(iv)
    todo.to_csv(OUT / "acwi_name_map_todo.csv", index=False, encoding="utf-8-sig")
    # 분기 리뷰 누락 점검: 누락 리뷰 이전 구간은 그 리뷰 변경분만큼 틀릴 수 있다
    have = {r.tag for r in reviews}
    seq, (y, mi) = [], (reviews[0].effective.year, reviews[0].close.month)
    cur = dt.date(reviews[0].close.year, reviews[0].close.month, 1)
    while cur <= reviews[-1].close:
        if cur.month in (2, 5, 8, 11):
            seq.append(f"{calendar.month_abbr[cur.month]}{str(cur.year)[2:]}")
        cur = dt.date(cur.year + (cur.month == 12), cur.month % 12 + 1, 1)
    missing = [t for t in seq if t not in have]
    if missing:
        print(f"⚠ 누락 리뷰 {missing}: 이 리뷰 이전 구간의 구성종목은 해당 변경분만큼 오차가 있음")
    (OUT / "acwi_missing_reviews.txt").write_text(("\n".join(missing) if missing else "none") + "\n", encoding="utf-8")
    iss = pd.DataFrame(issues)
    print(f"reviews={len(reviews)} ({reviews[0].tag}→{reviews[-1].tag})  anchor={len(anchor)} (= {anchor_tag} 반영 직후로 판정)")
    print(f"intervals={len(iv)}  issues: " + (iss.action.value_counts().to_dict().__repr__() if len(iss) else "0"))
    print(pd.DataFrame(counts).to_string(index=False))


if __name__ == "__main__":
    import sys
    main(sys.argv[1] if len(sys.argv) > 1 else None)
