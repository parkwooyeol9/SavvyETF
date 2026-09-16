"""KOSPI/KOSDAQ leader news sentiment history — Naver titles + lexicon scores.

Backfill:  python nlp_history.py --backfill
Daily:     python nlp_history.py --today
"""

from __future__ import annotations

import argparse
import json
import os
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta
from email.utils import parsedate_to_datetime
from html import unescape
from pathlib import Path
from typing import Any
from urllib.parse import urlencode
from zoneinfo import ZoneInfo

import requests

from naver_news import fetch_naver_news_on_day
from scheduler_grace import past_startup_grace
from scheduler_slots import due_slot_id
from summary_scheduler import _load_state, update_scheduler_state

PROJECT_DIR = Path(__file__).resolve().parent
UNIVERSE_PATH = PROJECT_DIR / "data" / "universes" / "nlp_history.json"
KOSDAQ100_PATH = PROJECT_DIR / "data" / "universes" / "kosdaq100.json"
KOSPI200_PATH = PROJECT_DIR / "data" / "universes" / "kospi200.json"
WEBAPP_UNIVERSE = PROJECT_DIR / "webapp" / "src" / "data" / "nlpHistoryUniverse.json"
LOCAL_DIR = PROJECT_DIR / "data" / "nlp_history"
R2_PREFIX = "nlp_history"
KST = ZoneInfo("Asia/Seoul")

LOOKBACK_DAYS = 365
RECENT_DAYS = 7
MAX_HEADLINES_PER_DAY = 8
MAX_HEADLINES_TOP = 12
MAX_PAGES_PER_DAY = 1
MAX_PAGES_TOP = 3
MAX_PAGES_REST = 2
TOP_KOSPI_DENSE = 20
TOP_KOSDAQ_DENSE = 10
TOP_N = 10
KIND_WEIGHT_NEWS = 1.0

NAVER_MV_URL = "https://m.stock.naver.com/api/stocks/marketValue/{market}"
NAVER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
        "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
    ),
    "Referer": "https://m.stock.naver.com/",
    "Accept": "application/json,text/plain,*/*",
    "Accept-Language": "ko-KR,ko;q=0.9",
}

# Keep in sync with webapp/src/lib/nlpPulse.ts
POS_KO = [
    "호실적", "급등", "수주", "배당", "상향", "흑자", "확대", "신고가", "매수", "회복",
    "최대실적", "깜짝실적", "공급계약", "독점", "자사주", "상승", "반등", "호조", "개선",
    "흑자전환", "사상최대", "어닝서프라이즈", "실적개선", "실적호조", "가이던스 상향",
    "목표가 상향", "투자의견 상향", "신규수주", "대규모수주", "본계약", "우선협상",
    "낙찰", "수출", "증설", "허가", "승인", "임상 성공", "자사주매입", "자사주 소각",
    "배당확대", "특별배당", "무상증자", "수주잔고", "독점공급",
]
NEG_KO = [
    "적자", "급락", "하향", "리콜", "횡령", "적발", "감산", "하회", "매도", "손실",
    "적자전환", "영업정지", "과징금", "하락", "우려", "부진", "축소", "파업",
    "실적쇼크", "어닝쇼크", "가이던스 하향", "목표가 하향", "투자의견 하향", "적자확대",
    "손상차손", "충당금", "분식", "배임", "기소", "압수수색", "제재", "중대재해",
    "수주취소", "계약해지", "자본잠식", "관리종목", "상장폐지", "감자", "블록딜",
    "대량매도", "실적하회",
]
POS_EN = [
    "beat", "surge", "upgrade", "buy", "record", "raises", "guidance up", "outperform",
    "rally", "dividend", "buyback", "growth", "strong", "profit", "raises guidance",
    "beats estimates", "new contract", "approval",
]
NEG_EN = [
    "miss", "plunge", "downgrade", "sell", "cut", "guidance down", "underperform",
    "lawsuit", "probe", "layoff", "loss", "weak", "fraud", "recall", "cuts guidance",
    "misses estimates", "investigation", "warning",
]
MARKET_CTX = ("코스피", "코스닥", "증시", "뉴욕증시", "나스닥", "다우", "환율", "원달러", "원·달러")
GENERIC_DIR = ("급등", "급락", "상승", "하락", "반등", "surge", "plunge", "rally")

_YMD_RE = re.compile(r"(\d{4})\.(\d{2})\.(\d{2})")
_REL_RE = re.compile(r"(\d+)\s*(분|시간|일)\s*전")
_PREF_RE = re.compile(r"(우B|우C|우선|우)$")

SEED_NAMES: list[dict[str, str]] = [
    {"code": "005930", "name": "삼성전자", "market": "kospi", "yahoo": "005930.KS"},
    {"code": "000660", "name": "SK하이닉스", "market": "kospi", "yahoo": "000660.KS"},
    {"code": "402340", "name": "SK스퀘어", "market": "kospi", "yahoo": "402340.KS"},
    {"code": "009150", "name": "삼성전기", "market": "kospi", "yahoo": "009150.KS"},
    {"code": "373220", "name": "LG에너지솔루션", "market": "kospi", "yahoo": "373220.KS"},
    {"code": "005380", "name": "현대차", "market": "kospi", "yahoo": "005380.KS"},
    {"code": "207940", "name": "삼성바이오로직스", "market": "kospi", "yahoo": "207940.KS"},
    {"code": "105560", "name": "KB금융", "market": "kospi", "yahoo": "105560.KS"},
    {"code": "032830", "name": "삼성생명", "market": "kospi", "yahoo": "032830.KS"},
    {"code": "028260", "name": "삼성물산", "market": "kospi", "yahoo": "028260.KS"},
    {"code": "196170", "name": "알테오젠", "market": "kosdaq", "yahoo": "196170.KQ"},
    {"code": "086520", "name": "에코프로", "market": "kosdaq", "yahoo": "086520.KQ"},
    {"code": "247540", "name": "에코프로비엠", "market": "kosdaq", "yahoo": "247540.KQ"},
    {"code": "036930", "name": "주성엔지니어링", "market": "kosdaq", "yahoo": "036930.KQ"},
    {"code": "277810", "name": "레인보우로보틱스", "market": "kosdaq", "yahoo": "277810.KQ"},
    {"code": "039030", "name": "이오테크닉스", "market": "kosdaq", "yahoo": "039030.KQ"},
    {"code": "240810", "name": "원익IPS", "market": "kosdaq", "yahoo": "240810.KQ"},
    {"code": "058470", "name": "리노공업", "market": "kosdaq", "yahoo": "058470.KQ"},
    {"code": "222800", "name": "심텍", "market": "kosdaq", "yahoo": "222800.KQ"},
    {"code": "108490", "name": "로보티즈", "market": "kosdaq", "yahoo": "108490.KQ"},
]


def _clip(n: float, lo: float = -100.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, n))


def is_market_wide_noise(title: str, name: str = "") -> bool:
    text = title or ""
    if name and name in text:
        return False
    return any(tok in text for tok in MARKET_CTX)


def score_text(text: str, name: str = "") -> tuple[float, list[str]]:
    raw = (text or "").lower()
    if is_market_wide_noise(text, name):
        return 0.0, []
    skip_generic = any(tok in text for tok in MARKET_CTX)
    matched: list[str] = []
    pos = 0
    neg = 0
    for w in POS_KO:
        if skip_generic and w in GENERIC_DIR:
            continue
        if w in text:
            pos += 1
            matched.append(w)
    for w in NEG_KO:
        if skip_generic and w in GENERIC_DIR:
            continue
        if w in text:
            neg += 1
            matched.append(w)
    for w in POS_EN:
        if skip_generic and w in GENERIC_DIR:
            continue
        if w in raw:
            pos += 1
            matched.append(w)
    for w in NEG_EN:
        if skip_generic and w in GENERIC_DIR:
            continue
        if w in raw:
            neg += 1
            matched.append(w)
    denom = pos + neg
    score = _clip(((pos - neg) / denom) * 100.0) if denom else 0.0
    uniq: list[str] = []
    for w in matched:
        if w not in uniq:
            uniq.append(w)
        if len(uniq) >= 6:
            break
    return score, uniq


def title_matches_name(name: str, title: str) -> bool:
    if name == "에코프로":
        return "에코프로" in title and "에코프로비엠" not in title
    return name in title


def news_query_for(name: str) -> str:
    return f"{(name or '').strip()} 주가"


def _decode_xml(text: str) -> str:
    return unescape(re.sub(r"<[^>]+>", "", text or "")).strip()


def crawl_google_rss(spec: dict[str, str]) -> list[dict[str, Any]]:
    params = urlencode(
        {
            "q": f"{spec['name']} 주가 when:1y",
            "hl": "ko",
            "gl": "KR",
            "ceid": "KR:ko",
        }
    )
    url = "https://news.google.com/rss/search?" + params
    try:
        res = requests.get(
            url,
            headers={
                "User-Agent": NAVER_HEADERS["User-Agent"],
                "Accept": "application/rss+xml, application/xml, text/xml,*/*",
            },
            timeout=20,
        )
        res.raise_for_status()
        xml = res.text
    except Exception:
        return []
    collected: list[dict[str, Any]] = []
    seen: set[str] = set()
    for chunk in re.findall(r"<item>([\s\S]*?)</item>", xml):
        title_m = re.search(r"<title[^>]*>([\s\S]*?)</title>", chunk)
        if not title_m:
            continue
        title = _decode_xml(title_m.group(1))
        if " - " in title:
            title, source = title.rsplit(" - ", 1)
            title = title.strip()
            source = source.strip() or "news"
        else:
            source = "news"
        if not title or title in seen:
            continue
        if not title_matches_name(spec["name"], title):
            continue
        if is_market_wide_noise(title, spec["name"]):
            continue
        pub_m = re.search(r"<pubDate[^>]*>([\s\S]*?)</pubDate>", chunk)
        day = None
        if pub_m:
            try:
                day = parsedate_to_datetime(_decode_xml(pub_m.group(1))).date().isoformat()
            except Exception:
                day = None
        if not day:
            continue
        link_m = re.search(r"<link[^>]*>([\s\S]*?)</link>", chunk)
        score, matched = score_text(title, spec["name"])
        seen.add(title)
        item = {
            "title": title,
            "source": source,
            "date": day,
            "score": round(score, 1),
            "matched": matched,
        }
        if link_m:
            href = _decode_xml(link_m.group(1))
            if href.startswith("http"):
                item["url"] = href
        collected.append(item)
    return collected


def parse_headline_date(raw: str, *, today: date | None = None) -> str | None:
    text = (raw or "").strip()
    m = _YMD_RE.search(text)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    today = today or datetime.now(KST).date()
    if text in {"어제"}:
        return (today - timedelta(days=1)).isoformat()
    rel = _REL_RE.search(text)
    if not rel:
        return None
    n = int(rel.group(1))
    unit = rel.group(2)
    if unit == "일":
        return (today - timedelta(days=n)).isoformat()
    return today.isoformat()


def _month_windows(start: date, end: date) -> list[tuple[date, date]]:
    windows: list[tuple[date, date]] = []
    cur = date(start.year, start.month, 1)
    while cur <= end:
        if cur.month == 12:
            nxt = date(cur.year + 1, 1, 1)
        else:
            nxt = date(cur.year, cur.month + 1, 1)
        last = nxt - timedelta(days=1)
        lo = max(cur, start)
        hi = min(last, end)
        if lo <= hi:
            windows.append((lo, hi))
        cur = nxt
    return windows


def _is_preferred(name: str) -> bool:
    return bool(_PREF_RE.search((name or "").strip()))


def load_constituents(path: Path, market: str) -> list[dict[str, str]]:
    suffix = ".KS" if market == "kospi" else ".KQ"
    if not path.exists():
        return []
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return []
    rows = payload.get("constituents") or payload.get("names") or []
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    for row in rows:
        if not isinstance(row, dict):
            continue
        code = str(row.get("code") or "").strip()
        name = str(row.get("name") or "").strip()
        if len(code) != 6 or not code.isdigit() or not name or code in seen:
            continue
        seen.add(code)
        out.append(
            {
                "code": code,
                "name": name,
                "market": market,
                "yahoo": str(row.get("yahoo") or f"{code}{suffix}"),
            }
        )
    return out


def _normalize_spec(row: dict[str, Any]) -> dict[str, str] | None:
    code = str(row.get("code") or "").strip()
    name = str(row.get("name") or "").strip()
    if len(code) != 6 or not code.isdigit() or not name:
        return None
    market = str(row.get("market") or "kospi").strip().lower()
    if market in {"kosdaq", "kq"}:
        market = "kosdaq"
        suffix = ".KQ"
    else:
        market = "kospi"
        suffix = ".KS"
    return {
        "code": code,
        "name": name,
        "market": market,
        "yahoo": str(row.get("yahoo") or f"{code}{suffix}"),
    }


def load_local_payloads() -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    if not LOCAL_DIR.exists():
        return out
    for path in LOCAL_DIR.glob("*.json"):
        if path.name == "index.json":
            continue
        data = _read_json(path)
        if data and data.get("code"):
            out[str(data["code"])] = data
    return out


def specs_from_payloads(payloads: dict[str, dict[str, Any]]) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    for row in payloads.values():
        spec = _normalize_spec(row)
        if spec:
            out.append(spec)
    return out


def fetch_market_leaders(market: str, top_n: int = TOP_N) -> list[dict[str, str]]:
    key = "KOSPI" if market == "kospi" else "KOSDAQ"
    suffix = ".KS" if market == "kospi" else ".KQ"
    try:
        res = requests.get(
            NAVER_MV_URL.format(market=key),
            params={"page": 1, "pageSize": 30},
            headers=NAVER_HEADERS,
            timeout=20,
        )
        res.raise_for_status()
        rows = (res.json() or {}).get("stocks") or []
    except Exception:
        return []
    out: list[dict[str, str]] = []
    for row in rows:
        name = str(row.get("stockName") or "").strip()
        code = str(row.get("itemCode") or "").strip()
        if len(code) != 6 or not code.isdigit() or not name:
            continue
        if _is_preferred(name):
            continue
        out.append(
            {
                "code": code,
                "name": name,
                "market": market,
                "yahoo": f"{code}{suffix}",
            }
        )
        if len(out) >= top_n:
            break
    return out


def resolve_universe(
    *,
    refresh: bool = True,
    market: str = "all",
    limit: int | None = None,
    offset: int = 0,
) -> list[dict[str, str]]:
    market = (market or "all").strip().lower()
    names: list[dict[str, str]] = []
    if market == "kosdaq":
        names = load_constituents(KOSDAQ100_PATH, "kosdaq")
    elif market == "kospi":
        names = load_constituents(KOSPI200_PATH, "kospi")
    else:
        if refresh:
            names = fetch_market_leaders("kospi") + fetch_market_leaders("kosdaq")
        if len(names) < TOP_N * 2:
            if UNIVERSE_PATH.exists():
                try:
                    payload = json.loads(UNIVERSE_PATH.read_text(encoding="utf-8"))
                    stored = payload.get("names") if isinstance(payload, dict) else payload
                    if isinstance(stored, list) and stored:
                        names = [spec for spec in (_normalize_spec(r) for r in stored) if spec]
                except Exception:
                    names = []
            if len(names) < TOP_N * 2:
                names = [dict(row) for row in SEED_NAMES]
    if offset:
        names = names[max(0, offset) :]
    if limit is not None:
        names = names[: max(0, limit)]
    return names


def save_universe(names: list[dict[str, str]], *, source: str | None = None) -> None:
    UNIVERSE_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "universe": "nlp_history",
        "as_of": datetime.now(KST).date().isoformat(),
        "source": source
        or "KOSDAQ 100 + KOSPI 200 constituents",
        "count": len(names),
        "names": names,
    }
    text = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    UNIVERSE_PATH.write_text(text, encoding="utf-8")
    try:
        WEBAPP_UNIVERSE.parent.mkdir(parents=True, exist_ok=True)
        WEBAPP_UNIVERSE.write_text(text, encoding="utf-8")
    except Exception:
        pass


def _local_path(code: str) -> Path:
    return LOCAL_DIR / f"{code}.json"


def _read_json(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def _upload_r2(code: str | None, payload: dict[str, Any]) -> bool:
    try:
        from r2_data import put_json

        key = f"{R2_PREFIX}/index.json" if code is None else f"{R2_PREFIX}/{code}.json"
        return bool(put_json(key, payload))
    except Exception:
        return False


def crawl_name_headlines(
    spec: dict[str, str],
    start: date,
    end: date,
    *,
    max_pages: int = MAX_PAGES_PER_DAY,
    stride: int = 1,
) -> list[dict[str, Any]]:
    query = news_query_for(spec["name"])
    collected: list[dict[str, Any]] = []
    seen: set[str] = set()
    day = start
    step = max(1, stride)
    while day <= end:
        rows = fetch_naver_news_on_day(query, day, max_pages=max_pages, korean_only=True)
        for row in rows:
            title = (row.get("title") or "").strip()
            if not title or title in seen:
                continue
            if is_market_wide_noise(title, spec["name"]):
                continue
            score, matched = score_text(title, spec["name"])
            seen.add(title)
            item = {
                "title": title,
                "source": row.get("source") or "Naver News",
                "date": day.isoformat(),
                "score": round(score, 1),
                "matched": matched,
            }
            if row.get("url"):
                item["url"] = row["url"]
            collected.append(item)
        if (day - start).days % 50 == 0:
            print(f"    {spec['code']} {spec['name']} {day} headlines={len(collected)}", flush=True)
        day += timedelta(days=step)
    return collected


def _pick_day_headlines(rows: list[dict[str, Any]], cap: int = MAX_HEADLINES_PER_DAY) -> list[dict[str, Any]]:
    ranked = sorted(
        rows,
        key=lambda r: (abs(float(r.get("score") or 0)), str(r.get("title") or "")),
        reverse=True,
    )
    return ranked[: max(1, cap)]


def aggregate_days(
    headlines: list[dict[str, Any]],
    *,
    cap: int = MAX_HEADLINES_PER_DAY,
) -> list[dict[str, Any]]:
    by_day: dict[str, list[dict[str, Any]]] = {}
    for row in headlines:
        by_day.setdefault(str(row.get("date") or ""), []).append(row)
    days: list[dict[str, Any]] = []
    for day in sorted(by_day):
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
            continue
        picked = _pick_day_headlines(by_day[day], cap)
        wsum = 0.0
        w = 0.0
        bull_n = 0
        bear_n = 0
        for row in picked:
            score = float(row.get("score") or 0)
            wsum += score * KIND_WEIGHT_NEWS
            w += KIND_WEIGHT_NEWS
            if score >= 12:
                bull_n += 1
            elif score <= -12:
                bear_n += 1
        days.append(
            {
                "date": day,
                "score": round(_clip(wsum / w) if w else 0.0, 1),
                "n": len(picked),
                "bull_n": bull_n,
                "bear_n": bear_n,
                "headlines": [
                    {
                        "title": r["title"],
                        "source": r.get("source") or "Naver News",
                        "score": r.get("score") or 0,
                        "matched": r.get("matched") or [],
                        **({"url": r["url"]} if r.get("url") else {}),
                    }
                    for r in picked
                ],
            }
        )
    return days


def merge_days(old: list[dict[str, Any]], new: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by: dict[str, dict[str, Any]] = {}
    for row in old:
        day = str(row.get("date") or "")
        if day:
            by[day] = row
    for row in new:
        day = str(row.get("date") or "")
        if not day:
            continue
        prev = by.get(day)
        if not prev:
            by[day] = row
            continue
        titles = {str(h.get("title") or "") for h in (prev.get("headlines") or [])}
        combined = list(prev.get("headlines") or [])
        for h in row.get("headlines") or []:
            title = str(h.get("title") or "")
            if title and title not in titles:
                combined.append(h)
                titles.add(title)
        rebuilt = aggregate_days(
            [
                {
                    "title": h.get("title"),
                    "source": h.get("source"),
                    "date": day,
                    "score": h.get("score") or 0,
                    "matched": h.get("matched") or [],
                    **({"url": h["url"]} if h.get("url") else {}),
                }
                for h in combined
            ],
            cap=max(MAX_HEADLINES_PER_DAY, min(MAX_HEADLINES_TOP, len(combined))),
        )
        if rebuilt:
            by[day] = rebuilt[0]
    return [by[k] for k in sorted(by)]


def recent_window_start(today: date | None = None) -> str:
    today = today or datetime.now(KST).date()
    return (today - timedelta(days=RECENT_DAYS - 1)).isoformat()


def recent_score_from_days(days: list[dict[str, Any]], today: date | None = None) -> float | None:
    start = recent_window_start(today)
    weight = 0
    total = 0.0
    for day in days:
        if str(day.get("date") or "") < start:
            continue
        score = day.get("score")
        if score is None:
            continue
        n = int(day.get("n") or 0)
        w = n if n > 0 else 1
        total += float(score) * w
        weight += w
    return None if weight <= 0 else total / weight


def build_name_payload(spec: dict[str, str], days: list[dict[str, Any]]) -> dict[str, Any]:
    n_headlines = sum(int(d.get("n") or 0) for d in days)
    last = days[-1] if days else None
    today = datetime.now(KST).date()
    recent_from = recent_window_start(today)
    recent_days = [d for d in days if str(d.get("date") or "") >= recent_from]
    recent_n = sum(int(d.get("n") or 0) for d in recent_days)
    return {
        "code": spec["code"],
        "name": spec["name"],
        "market": spec["market"],
        "yahoo": spec["yahoo"],
        "query": news_query_for(spec["name"]),
        "updated_at": datetime.now(KST).isoformat(),
        "n_days": len(days),
        "n_headlines": n_headlines,
        "last_score": None if last is None else last.get("score"),
        "last_date": None if last is None else last.get("date"),
        "last_n": None if last is None else int(last.get("n") or 0),
        "recent_n": recent_n,
        "recent_score": recent_score_from_days(days, today),
        "days": days,
    }


def build_index(payloads: list[dict[str, Any]]) -> dict[str, Any]:
    names = []
    for row in payloads:
        names.append(
            {
                "code": row["code"],
                "name": row["name"],
                "market": row["market"],
                "yahoo": row["yahoo"],
                "n_days": row.get("n_days") or 0,
                "n_headlines": row.get("n_headlines") or 0,
                "last_score": row.get("last_score"),
                "last_date": row.get("last_date"),
                "last_n": row.get("last_n") or 0,
                "recent_n": row.get("recent_n") or 0,
                "recent_score": row.get("recent_score"),
            }
        )
    return {
        "ok": True,
        "generated_at": datetime.now(KST).isoformat(),
        "lookback_days": LOOKBACK_DAYS,
        "max_headlines_per_day": MAX_HEADLINES_TOP,
        "methodology": [
            "유니버스: 코스닥 100 + 코스피 200 구성종목",
            "뉴스: Google News RSS when:1y + 네이버 데스크톱 일자 검색 '{종목} 주가'",
            f"최근 {RECENT_DAYS}일: 시총 상위 {TOP_KOSPI_DENSE}+{TOP_KOSDAQ_DENSE}종은 하루 최대 {MAX_HEADLINES_TOP}건, 나머지는 {MAX_HEADLINES_PER_DAY}건",
            "점수: NLP 탭과 같은 호재−악재 제목 렉시콘 (−100~+100). 증시 종합기사는 제외",
            "일자 점수: 그날 제목의 단순 평균",
            f"맵 점수: 최근 {RECENT_DAYS}일 기사 건수 가중 평균. 7일 뉴스가 없으면 흐리게 표시",
        ],
        "names": names,
    }


def save_payload(payload: dict[str, Any]) -> None:
    code = str(payload.get("code") or "")
    if not code:
        return
    _write_json(_local_path(code), payload)
    _upload_r2(code, payload)


def save_index(index: dict[str, Any]) -> None:
    _write_json(LOCAL_DIR / "index.json", index)
    _upload_r2(None, index)


def _load_existing(code: str) -> dict[str, Any] | None:
    local = _read_json(_local_path(code))
    if local:
        return local
    try:
        from r2_data import get_json

        remote = get_json(f"{R2_PREFIX}/{code}.json")
        return remote if isinstance(remote, dict) else None
    except Exception:
        return None


def backfill_one(
    spec: dict[str, str],
    start: date,
    end: date,
    *,
    google_only: bool = False,
    naver_stride: int = 1,
) -> dict[str, Any]:
    headlines = crawl_google_rss(spec)
    if not google_only:
        headlines.extend(crawl_name_headlines(spec, start, end, stride=naver_stride))
    days = aggregate_days(headlines, cap=MAX_HEADLINES_PER_DAY)
    existing = _load_existing(spec["code"])
    if existing and isinstance(existing.get("days"), list):
        days = merge_days(existing["days"], days)
    payload = build_name_payload(spec, days)
    save_payload(payload)
    return payload


def _merge_specs(*groups: list[dict[str, str]]) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    for group in groups:
        for spec in group:
            code = spec.get("code")
            if not code or code in seen:
                continue
            seen.add(code)
            out.append(spec)
    return out


def run_backfill(
    *,
    workers: int | None = None,
    google_only: bool = False,
    market: str = "all",
    skip_existing: bool = False,
    min_days: int = 20,
    naver_stride: int | None = None,
    limit: int | None = None,
    offset: int = 0,
) -> dict[str, Any]:
    end = datetime.now(KST).date()
    start = end - timedelta(days=LOOKBACK_DAYS)
    names = resolve_universe(refresh=market == "all", market=market, limit=limit, offset=offset)
    existing_payloads = load_local_payloads()
    archived = specs_from_payloads(existing_payloads)
    save_universe(_merge_specs(names, archived))
    LOCAL_DIR.mkdir(parents=True, exist_ok=True)
    stride = naver_stride if naver_stride is not None else (1 if len(names) <= 25 else 7)
    todo = names
    skipped: list[dict[str, Any]] = []
    if skip_existing:
        keep: list[dict[str, str]] = []
        for spec in names:
            prev = existing_payloads.get(spec["code"])
            if prev and int(prev.get("n_days") or 0) >= min_days:
                skipped.append(prev)
                continue
            keep.append(spec)
        todo = keep
    n_workers = max(1, min(workers or (8 if google_only else 3), len(todo) or 1))
    payloads: list[dict[str, Any]] = list(skipped)
    print(
        f"nlp history backfill {len(todo)} names (skip {len(skipped)}) {start} → {end} "
        f"workers={n_workers} google_only={google_only} stride={stride} market={market}",
        flush=True,
    )
    if todo:
        with ThreadPoolExecutor(max_workers=n_workers) as pool:
            futs = {
                pool.submit(
                    backfill_one,
                    spec,
                    start,
                    end,
                    google_only=google_only,
                    naver_stride=stride,
                ): spec
                for spec in todo
            }
            for fut in as_completed(futs):
                spec = futs[fut]
                try:
                    payload = fut.result()
                except Exception as exc:
                    print(f"  FAIL {spec['code']} {spec['name']}: {exc}", flush=True)
                    payload = build_name_payload(spec, [])
                    save_payload(payload)
                payloads.append(payload)
                print(
                    f"  {payload['code']} {payload['name']}: "
                    f"{payload['n_days']} days / {payload['n_headlines']} headlines",
                    flush=True,
                )
    by_code = {str(row.get("code")): row for row in existing_payloads.values()}
    for row in payloads:
        by_code[str(row.get("code"))] = row
    merged = list(by_code.values())
    merged.sort(key=lambda r: (0 if r.get("market") == "kospi" else 1, str(r.get("code"))))
    index = build_index(merged)
    save_index(index)
    print(f"wrote {LOCAL_DIR} index names={len(index['names'])}", flush=True)
    return index


def dense_name_codes() -> set[str]:
    kospi = load_constituents(KOSPI200_PATH, "kospi")[:TOP_KOSPI_DENSE]
    kosdaq = load_constituents(KOSDAQ100_PATH, "kosdaq")[:TOP_KOSDAQ_DENSE]
    return {spec["code"] for spec in kospi + kosdaq}


def run_today_append() -> dict[str, Any]:
    today = datetime.now(KST).date()
    existing = load_local_payloads()
    names = specs_from_payloads(existing)
    if not names:
        names = resolve_universe(refresh=False, market="all")
        if names:
            save_universe(names)
    dense = dense_name_codes()
    recent_start = today - timedelta(days=RECENT_DAYS - 1)
    payloads: list[dict[str, Any]] = []
    for spec in names:
        top = spec["code"] in dense
        start = recent_start if top else today
        pages = MAX_PAGES_TOP if top else MAX_PAGES_REST
        cap = MAX_HEADLINES_TOP if top else MAX_HEADLINES_PER_DAY
        headlines = crawl_google_rss(spec) + crawl_name_headlines(
            spec, start, today, max_pages=pages
        )
        new_days = aggregate_days(headlines, cap=cap)
        prev = existing.get(spec["code"]) or build_name_payload(spec, [])
        merged = merge_days(prev.get("days") or [], new_days)
        payload = build_name_payload(spec, merged)
        save_payload(payload)
        payloads.append(payload)
        print(
            f"  today {spec['code']} {spec['name']}: "
            f"{'top7d' if top else 'today'} +{len(headlines)} raw → {payload['n_days']} days"
        )
    by_code = {str(row.get("code")): row for row in existing.values()}
    for row in payloads:
        by_code[str(row.get("code"))] = row
    merged_all = list(by_code.values())
    merged_all.sort(key=lambda r: (0 if r.get("market") == "kospi" else 1, str(r.get("code"))))
    index = build_index(merged_all)
    save_index(index)
    return index


def start_nlp_history_scheduler() -> None:
    if os.environ.get("NLP_HISTORY_SCHEDULE_ENABLED", "true").strip().lower() in {
        "0",
        "false",
        "no",
        "off",
    }:
        print("nlp history scheduler disabled.")
        return

    def loop() -> None:
        print("nlp history scheduler active — daily 16:25 KST append")
        while True:
            try:
                if past_startup_grace():
                    now = datetime.now(KST)
                    state = _load_state()
                    slot = due_slot_id(
                        now,
                        16,
                        25,
                        last_slot=state.get("last_nlp_history_slot"),
                        window_minutes=40,
                    )
                    if slot:
                        print("nlp history daily append…")
                        try:
                            run_today_append()
                            update_scheduler_state(last_nlp_history_slot=slot)
                        except Exception as exc:
                            print(f"nlp history append failed: {exc}")
            except Exception as exc:
                print(f"nlp history scheduler loop error: {exc}")
            time.sleep(60)

    threading.Thread(target=loop, name="nlp-history-scheduler", daemon=True).start()


def main() -> None:
    parser = argparse.ArgumentParser(description="NLP news sentiment history")
    parser.add_argument("--backfill", action="store_true")
    parser.add_argument("--today", action="store_true")
    parser.add_argument("--google-only", action="store_true")
    parser.add_argument("--workers", type=int, default=3)
    parser.add_argument("--market", choices=["all", "kosdaq", "kospi"], default="all")
    parser.add_argument("--skip-existing", action="store_true")
    parser.add_argument("--min-days", type=int, default=20)
    parser.add_argument("--naver-stride", type=int, default=None)
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--offset", type=int, default=0)
    args = parser.parse_args()
    if args.today and not args.backfill:
        run_today_append()
        return
    run_backfill(
        workers=args.workers,
        google_only=args.google_only,
        market=args.market,
        skip_existing=args.skip_existing,
        min_days=args.min_days,
        naver_stride=args.naver_stride,
        limit=args.limit,
        offset=args.offset,
    )


if __name__ == "__main__":
    main()
