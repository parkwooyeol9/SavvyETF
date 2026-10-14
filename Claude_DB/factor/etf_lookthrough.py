"""ETF 룩스루 밸류에이션 (프로토타입) — ETF 보유종목·비중 × ACWI 종목 시계열.

ACWI 유니버스(약 2,240종목)가 전 세계 대·중형주를 덮으므로, ETF 보유종목을 ACWI 코드에 붙이기만 하면
groups.py 와 같은 방식(유동시총 가중 합산)으로 ETF 의 10년 PER·PBR·성장률을 조립할 수 있다.

    python -m Claude_DB.factor.etf_lookthrough --fetch     # 보유종목 받기 + 매칭 (약 1분, 네트워크)
    python -m Claude_DB.factor.etf_lookthrough             # 받아 둔 파일로 매칭만 다시
    python -m Claude_DB.factor.groups                      # ETF 를 'etf' 분류로 포함해 집계 (매칭 파일이 있으면 자동)

보유종목 출처 (2026-10 확인)
  iShares : https://www.ishares.com/us/products/{id}/x/latest-holdings.csv — 스크립트로 받기 가능.
            {id}(portfolioId)는 iShares 상품 스크리너 JSON 에서 티커로 찾는다. 예전 .ajax?fileType=csv 주소는 봇 차단(HTML).
  SPDR    : https://www.ssga.com/.../holdings-daily-us-en-{ticker}.xlsx — CUSIP 포함 → ISIN 으로 정확 매칭.
  Global X·VanEck·Invesco·Vanguard : 스크립트 다운로드 차단 또는 페이지 JS 생성 → 이 프로토타입에서는 제외.

출력 (Claude_DB/data/etf_holdings/ — 벤더 데이터라 gitignore)
  raw/{TICKER}_{YYYYMMDD}.csv|xlsx   원본
  mapped/{TICKER}.csv                code, weight(%), 매칭 방법 — groups.py 가 읽는다
  mapped/_coverage.csv               ETF 별 주식 비중 중 ACWI 로 덮은 비율
  mapped/_unmatched.csv              못 붙인 보유종목 (비중 큰 순) — 매칭 규칙 보완용
"""
from __future__ import annotations

import argparse
import datetime as dt
import difflib
import io
import json
import re
import time
from pathlib import Path

import numpy as np
import pandas as pd
import requests

from . import config as C

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "etf_holdings"
RAW = DATA / "raw"
MAPPED = DATA / "mapped"
UNIVERSE = ROOT / "out" / "analyzer" / "stocks_full.csv"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/124.0 Safari/537.36")
ISHARES_SCREENER = ("https://www.ishares.com/us/product-screener/product-screener-v3.1.jsn?dcrPath=/templatedata/config/"
                    "product-screener-v3/data/en/us-ishares/ishares-product-screener-backend-config&siteEntryPassthrough=true")
ISHARES_CSV = "https://www.ishares.com/us/products/{pid}/x/latest-holdings.csv"
SPDR_XLSX = ("https://www.ssga.com/us/en/intermediary/library-content/products/fund-data/etfs/us/"
             "holdings-daily-us-en-{t}.xlsx")

# ── ETF 목록: (티커, 운용사, 분류, 한글 이름, 비교할 ACWI 그룹 id) ──
# 분류: 국가 · 지역 · 섹터(미국) · 섹터(글로벌) · 산업·테마.  비교 그룹은 groups.py 의 id (없으면 None).
ETFS: list[tuple[str, str, str, str, str | None]] = [
    # 국가
    ("EWJ", "iShares", "국가", "MSCI 일본", "country:일본"),
    ("EWY", "iShares", "국가", "MSCI 한국", "country:한국"),
    ("EWT", "iShares", "국가", "MSCI 대만", "country:대만"),
    ("MCHI", "iShares", "국가", "MSCI 중국", "country:중국"),
    ("FXI", "iShares", "국가", "중국 대형주 50 (홍콩상장)", "country:중국"),
    ("INDA", "iShares", "국가", "MSCI 인도", "country:인도"),
    ("EWZ", "iShares", "국가", "MSCI 브라질", "country:브라질"),
    ("EWU", "iShares", "국가", "MSCI 영국", "country:영국"),
    ("EWG", "iShares", "국가", "MSCI 독일", "country:독일"),
    ("EWQ", "iShares", "국가", "MSCI 프랑스", "country:프랑스"),
    ("EWL", "iShares", "국가", "MSCI 스위스", "country:스위스"),
    ("EWC", "iShares", "국가", "MSCI 캐나다", "country:캐나다"),
    ("EWA", "iShares", "국가", "MSCI 호주", "country:호주"),
    ("EWW", "iShares", "국가", "MSCI 멕시코", "country:멕시코"),
    ("EWH", "iShares", "국가", "MSCI 홍콩", "country:홍콩"),
    ("EWS", "iShares", "국가", "MSCI 싱가포르", "country:싱가포르"),
    ("KSA", "iShares", "국가", "MSCI 사우디", "country:사우디"),
    ("EZA", "iShares", "국가", "MSCI 남아공", "country:남아공"),
    ("EIDO", "iShares", "국가", "MSCI 인도네시아", "country:인도네시아"),
    ("THD", "iShares", "국가", "MSCI 태국", "country:태국"),
    ("EWM", "iShares", "국가", "MSCI 말레이시아", "country:말레이시아"),
    ("EWI", "iShares", "국가", "MSCI 이탈리아", "country:이탈리아"),
    ("EWP", "iShares", "국가", "MSCI 스페인", "country:스페인"),
    ("EWN", "iShares", "국가", "MSCI 네덜란드", "country:네덜란드"),
    ("EWD", "iShares", "국가", "MSCI 스웨덴", "country:스웨덴"),
    # 지역·광역
    ("SPY", "SPDR", "지역", "S&P 500", "region:미국"),
    ("IVV", "iShares", "지역", "S&P 500 (Core)", "region:미국"),
    ("ACWI", "iShares", "지역", "MSCI ACWI", "region:ACWI"),
    ("EFA", "iShares", "지역", "MSCI EAFE (선진 미국·캐나다 제외)", "region:선진(미국 외)"),
    ("EEM", "iShares", "지역", "MSCI 신흥국", "region:신흥"),
    ("IEMG", "iShares", "지역", "MSCI 신흥국 IMI (Core)", "region:신흥"),
    ("EMXC", "iShares", "지역", "MSCI 신흥국 (중국 제외)", None),
    ("EZU", "iShares", "지역", "MSCI 유로존", None),
    ("IEUR", "iShares", "지역", "MSCI 유럽 IMI (Core)", "region:유럽 선진"),
    ("AAXJ", "iShares", "지역", "MSCI 아시아 (일본 제외)", None),
    # 섹터(미국) — Select Sector SPDR
    ("XLK", "SPDR", "섹터(미국)", "미국 IT", "sector:미국:IT"),
    ("XLF", "SPDR", "섹터(미국)", "미국 금융", "sector:미국:금융"),
    ("XLV", "SPDR", "섹터(미국)", "미국 헬스케어", "sector:미국:헬스케어"),
    ("XLE", "SPDR", "섹터(미국)", "미국 에너지", "sector:미국:에너지"),
    ("XLI", "SPDR", "섹터(미국)", "미국 산업재", "sector:미국:산업재"),
    ("XLY", "SPDR", "섹터(미국)", "미국 경기소비재", "sector:미국:경기소비재"),
    ("XLP", "SPDR", "섹터(미국)", "미국 필수소비재", "sector:미국:필수소비재"),
    ("XLU", "SPDR", "섹터(미국)", "미국 유틸리티", "sector:미국:유틸리티"),
    ("XLB", "SPDR", "섹터(미국)", "미국 소재", "sector:미국:소재"),
    ("XLRE", "SPDR", "섹터(미국)", "미국 부동산", "sector:미국:부동산"),
    ("XLC", "SPDR", "섹터(미국)", "미국 커뮤니케이션", "sector:미국:커뮤니케이션"),
    # 섹터(글로벌) — iShares Global sector
    ("IXN", "iShares", "섹터(글로벌)", "글로벌 IT", "sector:ACWI:IT"),
    ("IXG", "iShares", "섹터(글로벌)", "글로벌 금융", "sector:ACWI:금융"),
    ("IXJ", "iShares", "섹터(글로벌)", "글로벌 헬스케어", "sector:ACWI:헬스케어"),
    ("IXC", "iShares", "섹터(글로벌)", "글로벌 에너지", "sector:ACWI:에너지"),
    ("EXI", "iShares", "섹터(글로벌)", "글로벌 산업재", "sector:ACWI:산업재"),
    ("RXI", "iShares", "섹터(글로벌)", "글로벌 경기소비재", "sector:ACWI:경기소비재"),
    ("KXI", "iShares", "섹터(글로벌)", "글로벌 필수소비재", "sector:ACWI:필수소비재"),
    ("JXI", "iShares", "섹터(글로벌)", "글로벌 유틸리티", "sector:ACWI:유틸리티"),
    ("MXI", "iShares", "섹터(글로벌)", "글로벌 소재", "sector:ACWI:소재"),
    ("IXP", "iShares", "섹터(글로벌)", "글로벌 커뮤니케이션", "sector:ACWI:커뮤니케이션"),
    # 산업·테마
    ("SOXX", "iShares", "산업·테마", "반도체", "theme:semi_all"),
    ("IGV", "iShares", "산업·테마", "소프트웨어", "theme:software"),
    ("ARTY", "iShares", "산업·테마", "AI·테크", "theme:ai_semi"),
    ("IHAK", "iShares", "산업·테마", "사이버보안", "theme:cyber"),
    ("ITA", "iShares", "산업·테마", "미국 항공우주·방산", "theme:defense"),
    ("XAR", "SPDR", "산업·테마", "미국 항공우주·방산 (동일가중)", "theme:defense"),
    ("IDEF", "iShares", "산업·테마", "방산 (액티브)", "theme:defense"),
    ("ICLN", "iShares", "산업·테마", "글로벌 클린에너지", "theme:renewable"),
    ("IDRV", "iShares", "산업·테마", "자율주행·전기차", "theme:ev_battery"),
    ("IBB", "iShares", "산업·테마", "바이오테크", "industry:Biotechnology"),
    ("IHI", "iShares", "산업·테마", "미국 의료기기", "industry:Health Care Equipment & Supplies"),
    ("RING", "iShares", "산업·테마", "글로벌 금광", "theme:gold"),
    ("PICK", "iShares", "산업·테마", "글로벌 금속·광산", "theme:base_metals"),
    ("XME", "SPDR", "산업·테마", "미국 금속·광업 (동일가중)", "theme:steel"),
    ("IGF", "iShares", "산업·테마", "글로벌 인프라", None),
    ("REET", "iShares", "산업·테마", "글로벌 리츠", "theme:reits"),
]
CATEGORIES = list(dict.fromkeys(c for _, _, c, _, _ in ETFS))

# iShares Location → ACWI 유니버스 국가명
LOCATION_KO = {
    "United States": "미국", "Japan": "일본", "Korea (South)": "한국", "Taiwan": "대만", "China": "중국",
    "India": "인도", "Brazil": "브라질", "United Kingdom": "영국", "Germany": "독일", "France": "프랑스",
    "Switzerland": "스위스", "Canada": "캐나다", "Australia": "호주", "Mexico": "멕시코", "Hong Kong": "홍콩",
    "Singapore": "싱가포르", "Saudi Arabia": "사우디", "South Africa": "남아공", "Indonesia": "인도네시아",
    "Thailand": "태국", "Malaysia": "말레이시아", "Italy": "이탈리아", "Spain": "스페인", "Netherlands": "네덜란드",
    "Sweden": "스웨덴", "Denmark": "덴마크", "Finland": "핀란드", "Belgium": "벨기에", "Norway": "노르웨이",
    "Ireland": "아일랜드", "Austria": "오스트리아", "Portugal": "포르투갈", "Israel": "이스라엘", "New Zealand": "뉴질랜드",
    "Poland": "폴란드", "Turkey": "튀르키예", "Chile": "칠레", "Philippines": "필리핀", "Qatar": "카타르",
    "United Arab Emirates": "UAE", "Kuwait": "쿠웨이트", "Greece": "그리스", "Hungary": "헝가리", "Egypt": "이집트",
    "Colombia": "콜롬비아", "Czech Republic": "체코", "Peru": "페루", "Luxembourg": "룩셈부르크",
}
# iShares Exchange(부분 문자열) → RIC 접미사 후보. 앞에서부터 처음 맞는 것을 쓴다.
EXCHANGE_SUFFIX = [
    ("Tokyo", [".T"]), ("Kosdaq", [".KQ", ".KS"]), ("Korea Exchange", [".KS", ".KQ"]),
    ("Gretai", [".TWO", ".TW"]), ("Taipei", [".TWO", ".TW"]), ("Taiwan", [".TW", ".TWO"]),
    ("Hong Kong", [".HK"]), ("Shanghai", [".SS"]), ("Shenzhen", [".SZ"]),
    ("National Stock Exchange Of India", [".NS", ".BO"]), ("Bse", [".BO", ".NS"]), ("Sao Paulo", [".SA"]), ("XBSP", [".SA"]),
    ("London", [".L"]), ("Toronto", [".TO"]), ("Asx", [".AX"]), ("SIX", [".S"]), ("Saudi", [".SE"]),
    ("Mexicana", [".MX"]), ("Singapore", [".SI"]), ("Johannesburg", [".J"]), ("Indonesia", [".JK"]),
    ("Thailand", ["_n.BK", ".BK"]), ("Malaysia", [".KL"]), ("Italiana", [".MI"]), ("Milan", [".MI"]),
    ("Madrid", [".MC"]), ("Mercado Continuo", [".MC"]), ("Amsterdam", [".AS"]), ("Paris", [".PA"]),
    ("Brussels", [".BR"]), ("Lisbon", [".LS"]), ("Dublin", [".I"]), ("Irish", [".I"]), ("Xetra", [".DE"]),
    ("Deutsche Boerse", [".DE"]), ("Wiener", [".VI"]), ("Oslo", [".OL"]), ("Stockholm", [".ST"]),
    ("Copenhagen", [".CO"]), ("Helsinki", [".HE"]), ("Nordic", [".ST", ".CO", ".HE"]), ("Tel Aviv", [".TA"]),
    ("New Zealand", [".NZ"]), ("Warsaw", [".WA"]), ("Istanbul", [".IS"]), ("Santiago", [".SN"]),
    ("Philippine", [".PS"]), ("Qatar", [".QA"]), ("Abu Dhabi", [".AD"]), ("Dubai", [".DU"]), ("Kuwait", [".KW"]),
    ("Athens", [".AT"]), ("Budapest", [".BU"]), ("Prague", [".PR"]), ("Egypt", [".CA"]), ("Colombia", [".CN"]),
]
US_EXCHANGE = ("NYSE", "NASDAQ", "Nasdaq", "Nyse", "New York", "Cboe", "BATS", "US")
# 이름이 너무 달라 자동 매칭이 안 되는 대형주 (보유종목 이름 정규화 → ACWI 코드)
ALIASES = {"MICHELIN": "MICP.PA", "BMW": "BMWG.DE", "VOLKSWAGEN": "VOWG_p.DE", "LVMH": "LVMH.PA",
           "PETROLEO BRASILEIRO": "PETR4.SA", "AIRBUS": "AIR.PA", "LEONARDO FINMECCANICA": "LDOF.MI", "SIEMENS N": "SIEGn.DE", "SIEMENS": "SIEGn.DE"}
US_SUFFIXES = (".N", ".OQ", ".O", ".K", ".Z", ".A", ".P")
STOP = {"INC", "CORP", "CORPORATION", "LTD", "LIMITED", "PLC", "AG", "SA", "SE", "NV", "CO", "COMPANY", "HOLDINGS",
        "HOLDING", "GROUP", "THE", "CLASS", "ORD", "ADR", "TBK", "PT", "BHD", "PCL", "SAB", "DE", "CV", "ASA", "AB",
        "OYJ", "SPA", "AS", "KGAA", "REG", "SHS", "N", "A", "B", "H", "PUBL", "PCLNVDR", "NVDR", "BERHAD", "PJSC",
        "SJSC", "CL", "TRUST", "REIT", "LIMITE", "INCORPORATED", "INTERNATIONAL", "INTL", "HLDGS", "SERIES",
        "SUBORDINATE", "VOTING", "NON", "PREF", "PREFERRED", "PAR", "PS", "SCA", "AND", "NPV", "AKTIENGESELLSCHAFT",
        "PUBLIC", "LIMITED", "CORPORATIONS", "ADS"}


def _get(url: str, timeout=40) -> requests.Response:
    r = requests.get(url, headers={"User-Agent": UA, "Accept": "*/*"}, timeout=timeout)
    r.raise_for_status()
    return r


def ishares_ids() -> dict[str, str]:
    """iShares 상품 스크리너 → {티커: portfolioId}. 하루 캐시."""
    cache = DATA / "ishares_screener.json"
    if cache.exists() and time.time() - cache.stat().st_mtime < 86400:
        d = json.loads(cache.read_text(encoding="utf-8"))
    else:
        d = _get(ISHARES_SCREENER, 60).json()
        DATA.mkdir(parents=True, exist_ok=True)
        cache.write_text(json.dumps(d), encoding="utf-8")
    return {v.get("localExchangeTicker"): pid for pid, v in d.items() if v.get("localExchangeTicker")}


def fetch(tickers: list[str] | None = None) -> dict[str, Path]:
    """보유종목 원본을 RAW 에 저장. 반환: 티커 → 파일."""
    RAW.mkdir(parents=True, exist_ok=True)
    ids = None
    out = {}
    for t, issuer, *_ in ETFS:
        if tickers and t not in tickers:
            continue
        try:
            if issuer == "iShares":
                ids = ids or ishares_ids()
                body = _get(ISHARES_CSV.format(pid=ids[t])).content
                if body.lstrip()[:1] == b"<":
                    raise RuntimeError("HTML 응답 (봇 차단)")
                asof = _ishares_asof(body.decode("utf-8-sig", errors="ignore"))
                p = RAW / f"{t}_{asof}.csv"
            else:
                body = _get(SPDR_XLSX.format(t=t.lower())).content
                asof = _spdr_asof(body)
                p = RAW / f"{t}_{asof}.xlsx"
            p.write_bytes(body)
            out[t] = p
            print(f"  {t:5s} {issuer:7s} {asof} {len(body) / 1e3:7.0f}KB")
        except Exception as e:                                   # 한 ETF 실패가 전체를 막지 않게
            print(f"  {t:5s} 실패: {e}")
        time.sleep(0.4)
    return out


def _ishares_asof(text: str) -> str:
    m = re.search(r'Fund Holdings as of,"([^"]+)"', text)
    return dt.datetime.strptime(m.group(1), "%b %d, %Y").strftime("%Y%m%d") if m else dt.date.today().strftime("%Y%m%d")


def _spdr_asof(body: bytes) -> str:
    x = pd.read_excel(io.BytesIO(body), header=None, nrows=4)
    m = re.search(r"(\d{2}-[A-Za-z]{3}-\d{4})", " ".join(map(str, x.iloc[:, 1].tolist())))
    return dt.datetime.strptime(m.group(1), "%d-%b-%Y").strftime("%Y%m%d") if m else dt.date.today().strftime("%Y%m%d")


def latest_raw(t: str) -> Path | None:
    fs = sorted(RAW.glob(f"{t}_*.*"))
    return fs[-1] if fs else None


def read_holdings(p: Path) -> pd.DataFrame:
    """원본 → 표준 열: ticker, name, weight(%), location, exchange, cusip, asset."""
    if p.suffix == ".csv":
        text = p.read_text(encoding="utf-8-sig", errors="ignore")
        lines = text.splitlines()
        start = next(i for i, l in enumerate(lines) if l.startswith("Ticker,"))
        body = []
        for l in lines[start:]:
            if not l.strip() or l.startswith("\xa0") or l.startswith('"The content'):
                break
            body.append(l)
        df = pd.read_csv(io.StringIO("\n".join(body)), dtype=str)
        out = pd.DataFrame({
            "ticker": df["Ticker"].str.strip(), "name": df["Name"].str.strip(),
            "weight": pd.to_numeric(df["Weight (%)"].str.replace(",", ""), errors="coerce"),
            "location": df.get("Location"), "exchange": df.get("Exchange"), "cusip": None,
            "asset": df.get("Asset Class"),
        })
    else:
        x = pd.read_excel(p, header=None)
        h = next(i for i in range(15) if str(x.iat[i, 0]).strip() == "Name")
        df = x.iloc[h + 1:].copy()
        df.columns = [str(c).strip() for c in x.iloc[h]]
        df = df[df["Name"].notna() & df["Weight"].notna()]
        out = pd.DataFrame({
            "ticker": df["Ticker"].astype(str).str.strip(), "name": df["Name"].astype(str).str.strip(),
            "weight": pd.to_numeric(df["Weight"], errors="coerce"), "location": "United States", "exchange": "US",
            "cusip": df["Identifier"].astype(str).str.strip(), "asset": "Equity",
        })
        out.loc[out["ticker"].isin(["-", "nan", "CASH_USD"]) | out["name"].str.contains("CASH|FUTURE", case=False), "asset"] = "Cash"
    return out[out["weight"].notna()].reset_index(drop=True)


def cusip_to_isin(cusip: str, country="US") -> str | None:
    if not isinstance(cusip, str) or len(cusip) != 9:
        return None
    s = "".join(str(int(c, 36)) for c in country + cusip.upper())
    total = 0
    for i, ch in enumerate(reversed(s)):
        d = int(ch)
        if i % 2 == 0:
            d *= 2
        total += d // 10 + d % 10
    return f"{country}{cusip.upper()}{(10 - total % 10) % 10}"


def _tnorm(x: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", str(x).upper())


def _clean_ticker(t: str) -> str:
    t = str(t).strip().rstrip("*")
    return re.sub(r"\.R$", "", t)                            # 태국 NVDR (PTT.R)


def _nnorm(x: str) -> str:
    x = re.split(r"\b(?:ADR|GDR|SPONSORED|REPRESENTING|REPTG|AMERICAN DEPOSITARY|DEPOSITARY)\b", str(x).upper())[0]     # ADR 설명 꼬리 제거
    toks = re.sub(r"[^A-Z0-9 ]", " ", x.replace("&", " ").replace("'", "")).split()
    return " ".join(t for t in toks if t not in STOP and len(t) > 1)


def _tok_eq(x: str, y: str) -> bool:
    if x == y:
        return True
    a, b = sorted((x, y), key=len)
    return len(a) >= 6 and b.startswith(a)                  # 잘린 이름(…AKTIENGES)만 접두 일치 허용


def _name_score(a: str, b: str, truncated: bool = False) -> float:
    """a = 보유종목 이름, b = 유니버스 이름 (둘 다 정규화). 0 = 불일치.
    한 단어 이름은 유니버스도 한 단어로 같아야, 여러 단어는 보유종목 단어가 모두 있고(유니버스 단어 75% 이상)
    또는 유니버스 단어가 모두 있고 보유종목 단어 75% 이상, 아니면 문자열 유사도 0.9 이상."""
    if not a or not b:
        return 0.0
    ta, tb = a.split(), b.split()
    if {t for t in ta if t.isdigit()} != {t for t in tb if t.isdigit()}:   # ONE COMMUNICATIONS ≠ ONE 97 COMMUNICATIONS
        return 0.0
    if len(ta) == 1:
        return 1.0 if tb == ta else 0.0
    sub = sum(any(_tok_eq(x, y) or (truncated and i == len(ta) - 1 and len(x) >= 2 and y.startswith(x)) for y in tb)
              for i, x in enumerate(ta)) / len(ta)
    if truncated and sub == 1 and len(ta) >= 3:                 # 34자에서 잘린 긴 법인명: 앞 단어가 모두 맞으면 인정
        return 0.95
    sup = sum(any(_tok_eq(y, x) for x in ta) for y in tb) / len(tb)
    if (sub == 1 and sup >= 0.75) or (sup == 1 and sub >= 0.75):
        return (sub + sup) / 2
    seq = difflib.SequenceMatcher(None, a, b).ratio()
    return seq if seq >= 0.9 else 0.0


class Universe:
    """ACWI 유니버스 매칭 인덱스."""

    def __init__(self, path: Path = UNIVERSE):
        u = pd.read_csv(path, encoding="utf-8-sig", usecols=["code", "name", "country", "isin", "wgt"])
        u = u[u["code"].notna()].drop_duplicates("code").sort_values("wgt", ascending=False)
        self.u = u
        self.codes = set(u["code"])
        self.by_isin = dict(zip(u["isin"].dropna(), u.loc[u["isin"].notna(), "code"]))
        self.by_suffix: dict[tuple[str, str], str] = {}        # (접미사, 정규화 티커) → 코드, 비중 큰 것 우선
        for c in u["code"]:
            if "." not in c:
                continue
            base, suf = c.rsplit(".", 1)
            suf = "." + suf
            if suf in US_SUFFIXES:
                suf = "US"
            for key in {_tnorm(base), _tnorm(base.replace("_n", ""))}:
                self.by_suffix.setdefault((suf, key), c)
        self.names = {ct: [(c, _nnorm(n)) for c, n in zip(g["code"], g["name"])] for ct, g in u.groupby("country")}
        self.country = dict(zip(u["code"], u["country"]))
        self.by_prefix: dict[str, list] = {}                  # 이름 앞 2글자 → 후보 (전체 탐색 가지치기)
        for v in self.names.values():
            for c, cn in v:
                self.by_prefix.setdefault(cn[:2], []).append((c, cn))

    def match(self, r) -> tuple[str | None, str]:
        isin = cusip_to_isin(r.cusip) if isinstance(r.cusip, str) else None
        if isin and isin in self.by_isin:
            return self.by_isin[isin], "isin"
        t = _tnorm(_clean_ticker(r.ticker))
        ex = str(r.exchange or "")
        nn = _nnorm(r.name)
        if nn in ALIASES and ALIASES[nn] in self.codes:
            return ALIASES[nn], "alias"
        is_us = any(k in ex for k in US_EXCHANGE) and not any(k in ex for k in ("Euronext", "Omx", "Nordic", "Helsinki",
                                                                                 "Stockholm", "Copenhagen"))
        sufs = ["US"] if is_us else next((v for k, v in EXCHANGE_SUFFIX if k.lower() in ex.lower()), [])
        for suf in sufs:
            key = (".HK" if suf == ".HK" else suf.replace("_n", ""), t.zfill(4) if suf == ".HK" else t)
            c = self.by_suffix.get(key)
            if c:
                return c, "ticker"
        # 이름 매칭: 같은 국가(홍콩·중국은 서로, 미국 상장은 미국 포함) → 없으면 전체(앞 2글자 같은 이름)
        ct = LOCATION_KO.get(str(r.location))
        pool = list(self.names.get(ct, []))
        if ct in ("중국", "홍콩"):
            pool += self.names.get("홍콩" if ct == "중국" else "중국", [])
        if is_us:
            pool += self.names.get("미국", [])
        # 전체 탐색은 상장국·본사국이 다른 선진국 대형주(STMicro·Spotify 등)만: 완전 일치 + 선진국 종목
        glob = [(c, cn) for c, cn in self.by_prefix.get(nn[:2], []) if self.country.get(c) in C.DM_COUNTRIES]
        for cands, tag in ((pool, "name"), (glob, "name*")):
            scored = sorted(((_name_score(nn, cn, len(str(r.name)) >= 33), c, cn) for c, cn in cands if cn[:2] == nn[:2]), key=lambda x: -x[0])  # 동점은 ACWI 비중 큰 순
            scored = [x for x in scored if x[0] > 0]
            if tag == "name*":
                scored = [x for x in scored if x[0] >= 0.99]
            if not scored:
                continue
            top = scored[0]
            rivals = [x for x in scored[1:] if top[0] - x[0] < 0.02 and x[2] != top[2]]
            if rivals:                                         # 'GRUPO AEROPORTUARIO' 처럼 여러 회사에 똑같이 맞으면 버린다
                return None, f"ambiguous ({top[1]}, {rivals[0][1]})"
            return top[1], f"{tag} {top[0]:.2f}"
        return None, "no match"


def map_all(uni: Universe | None = None) -> pd.DataFrame:
    uni = uni or Universe()
    MAPPED.mkdir(parents=True, exist_ok=True)
    cov, unmatched = [], []
    for t, issuer, cat, label, cmp_id in ETFS:
        p = latest_raw(t)
        if p is None:
            continue
        h = read_holdings(p)
        eq = h[h["asset"].fillna("Equity").str.contains("Equity")].copy()
        res = [uni.match(r) for r in eq.itertuples()]
        eq["code"] = [c for c, _ in res]
        eq["how"] = [m for _, m in res]
        ok = eq[eq["code"].notna()]
        w = ok.groupby("code")["weight"].sum().sort_values(ascending=False)
        w.rename("weight").to_frame().assign(how=ok.groupby("code")["how"].first()).to_csv(
            MAPPED / f"{t}.csv", encoding="utf-8-sig")
        eq_w = eq["weight"].sum()
        cov.append({"ticker": t, "issuer": issuer, "category": cat, "label": label, "compare": cmp_id,
                    "asof": p.stem.split("_")[-1], "n_holdings": len(eq), "n_matched": int(ok["code"].nunique()),
                    "equity_w": round(eq_w, 2), "covered_w": round(ok["weight"].sum(), 2),
                    "coverage_pct": round(ok["weight"].sum() / eq_w * 100, 1) if eq_w else None,
                    "by_name_w": round(ok.loc[ok["how"].str.startswith("name"), "weight"].sum(), 2)})
        miss = eq[eq["code"].isna()].nlargest(15, "weight")
        unmatched += [{"etf": t, **r} for r in miss[["ticker", "name", "weight", "location", "exchange", "how"]].to_dict("records")]
    cv = pd.DataFrame(cov)
    cv.to_csv(MAPPED / "_coverage.csv", index=False, encoding="utf-8-sig")
    pd.DataFrame(unmatched).to_csv(MAPPED / "_unmatched.csv", index=False, encoding="utf-8-sig")
    return cv


def load_mapped() -> list[dict]:
    """groups.py 용: 매칭된 ETF 목록 [{ticker, issuer, category, label, compare, asof, coverage, weights{code: %}}]."""
    cvp = MAPPED / "_coverage.csv"
    if not cvp.exists():
        return []
    cv = pd.read_csv(cvp, encoding="utf-8-sig").set_index("ticker")
    out = []
    for t, issuer, cat, label, cmp_id in ETFS:
        f = MAPPED / f"{t}.csv"
        if t not in cv.index or not f.exists():
            continue
        w = pd.read_csv(f, encoding="utf-8-sig", index_col=0)["weight"]
        r = cv.loc[t]
        out.append({"ticker": t, "issuer": issuer, "category": cat, "label": label, "compare": cmp_id,
                    "asof": str(r["asof"]), "coverage": float(r["coverage_pct"]), "n_holdings": int(r["n_holdings"]),
                    "weights": w.to_dict()})
    return out


def main():
    ap = argparse.ArgumentParser(description="ETF 보유종목 → ACWI 룩스루 (프로토타입)")
    ap.add_argument("--fetch", action="store_true", help="보유종목 새로 받기")
    ap.add_argument("--only", nargs="*", help="이 티커만")
    a = ap.parse_args()
    if a.fetch:
        print("보유종목 받기")
        fetch(a.only)
    cv = map_all()
    pd.set_option("display.width", 200)
    print(cv[["ticker", "category", "label", "asof", "n_holdings", "n_matched", "coverage_pct", "by_name_w"]].to_string(index=False))
    print(f"→ {MAPPED}")


if __name__ == "__main__":
    main()
