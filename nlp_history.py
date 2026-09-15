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
LOCAL_DIR = PROJECT_DIR / "data" / "nlp_history"
R2_PREFIX = "nlp_history"
KST = ZoneInfo("Asia/Seoul")

LOOKBACK_DAYS = 365
MAX_HEADLINES_PER_DAY = 8
MAX_PAGES_PER_DAY = 1
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
]
NEG_KO = [
    "적자", "급락", "하향", "리콜", "횡령", "적발", "감산", "하회", "매도", "손실",
    "적자전환", "영업정지", "과징금", "하락", "우려", "부진", "축소", "파업",
]
POS_EN = [
    "beat", "surge", "upgrade", "buy", "record", "raises", "guidance up", "outperform",
    "rally", "dividend", "buyback", "growth", "strong", "profit",
]
NEG_EN = [
    "miss", "plunge", "downgrade", "sell", "cut", "guidance down", "underperform",
    "lawsuit", "probe", "layoff", "loss", "weak", "fraud", "recall",
]

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


def score_text(text: str) -> tuple[float, list[str]]:
    raw = (text or "").lower()
    matched: list[str] = []
    pos = 0
    neg = 0
    for w in POS_KO:
        if w in text:
            pos += 1
            matched.append(w)
    for w in NEG_KO:
        if w in text:
            neg += 1
            matched.append(w)
    for w in POS_EN:
        if w in raw:
            pos += 1
            matched.append(w)
    for w in NEG_EN:
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
        score, matched = score_text(title)
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


def resolve_universe(*, refresh: bool = True) -> list[dict[str, str]]:
    names: list[dict[str, str]] = []
    if refresh:
        names = fetch_market_leaders("kospi") + fetch_market_leaders("kosdaq")
    if len(names) < TOP_N * 2:
        if UNIVERSE_PATH.exists():
            try:
                payload = json.loads(UNIVERSE_PATH.read_text(encoding="utf-8"))
                stored = payload.get("names") if isinstance(payload, dict) else payload
                if isinstance(stored, list) and stored:
                    names = [
                        {
                            "code": str(r["code"]),
                            "name": str(r["name"]),
                            "market": str(r.get("market") or "kospi"),
                            "yahoo": str(r.get("yahoo") or f"{r['code']}.KS"),
                        }
                        for r in stored
                        if r.get("code") and r.get("name")
                    ]
            except Exception:
                names = []
        if len(names) < TOP_N * 2:
            names = [dict(row) for row in SEED_NAMES]
    return names


def save_universe(names: list[dict[str, str]]) -> None:
    UNIVERSE_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "universe": "nlp_history",
        "as_of": datetime.now(KST).date().isoformat(),
        "source": "Naver m.stock marketValue KOSPI/KOSDAQ top 10 (preferred skipped)",
        "count": len(names),
        "names": names,
    }
    UNIVERSE_PATH.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


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
) -> list[dict[str, Any]]:
    query = news_query_for(spec["name"])
    collected: list[dict[str, Any]] = []
    seen: set[str] = set()
    day = start
    while day <= end:
        rows = fetch_naver_news_on_day(query, day, max_pages=max_pages, korean_only=True)
        for row in rows:
            title = (row.get("title") or "").strip()
            if not title or title in seen:
                continue
            score, matched = score_text(title)
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
        day += timedelta(days=1)
    return collected


def _pick_day_headlines(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    ranked = sorted(
        rows,
        key=lambda r: (abs(float(r.get("score") or 0)), str(r.get("title") or "")),
        reverse=True,
    )
    return ranked[:MAX_HEADLINES_PER_DAY]


def aggregate_days(headlines: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_day: dict[str, list[dict[str, Any]]] = {}
    for row in headlines:
        by_day.setdefault(str(row.get("date") or ""), []).append(row)
    days: list[dict[str, Any]] = []
    for day in sorted(by_day):
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
            continue
        picked = _pick_day_headlines(by_day[day])
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
            ]
        )
        if rebuilt:
            by[day] = rebuilt[0]
    return [by[k] for k in sorted(by)]


def build_name_payload(spec: dict[str, str], days: list[dict[str, Any]]) -> dict[str, Any]:
    n_headlines = sum(int(d.get("n") or 0) for d in days)
    last = days[-1] if days else None
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
            }
        )
    return {
        "ok": True,
        "generated_at": datetime.now(KST).isoformat(),
        "lookback_days": LOOKBACK_DAYS,
        "max_headlines_per_day": MAX_HEADLINES_PER_DAY,
        "methodology": [
            "유니버스: 네이버 시가총액 코스피 상위 10 + 코스닥 상위 10 (우선주 제외)",
            "뉴스: Google News RSS when:1y + 네이버 데스크톱 일자 검색 '{종목} 주가'",
            "점수: NLP 탭과 같은 호재−악재 제목 렉시콘 (−100~+100)",
            "일자 점수: 그날 제목의 단순 평균. 하루 최대 8건 보관",
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
) -> dict[str, Any]:
    headlines = crawl_google_rss(spec)
    if not google_only:
        headlines.extend(crawl_name_headlines(spec, start, end))
    days = aggregate_days(headlines)
    existing = _load_existing(spec["code"])
    if existing and isinstance(existing.get("days"), list):
        days = merge_days(existing["days"], days)
    payload = build_name_payload(spec, days)
    save_payload(payload)
    return payload


def run_backfill(*, workers: int | None = None, google_only: bool = False) -> dict[str, Any]:
    end = datetime.now(KST).date()
    start = end - timedelta(days=LOOKBACK_DAYS)
    names = resolve_universe(refresh=True)
    save_universe(names)
    LOCAL_DIR.mkdir(parents=True, exist_ok=True)
    n_workers = max(1, min(workers or (8 if google_only else 3), len(names) or 1))
    payloads: list[dict[str, Any]] = []
    print(
        f"nlp history backfill {len(names)} names {start} → {end} "
        f"workers={n_workers} google_only={google_only}",
        flush=True,
    )
    with ThreadPoolExecutor(max_workers=n_workers) as pool:
        futs = {
            pool.submit(backfill_one, spec, start, end, google_only=google_only): spec
            for spec in names
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
    payloads.sort(key=lambda r: (0 if r.get("market") == "kospi" else 1, str(r.get("code"))))
    index = build_index(payloads)
    save_index(index)
    print(f"wrote {LOCAL_DIR} index names={len(index['names'])}", flush=True)
    return index


def run_today_append() -> dict[str, Any]:
    today = datetime.now(KST).date()
    names = resolve_universe(refresh=False)
    if not names:
        names = resolve_universe(refresh=True)
        save_universe(names)
    payloads: list[dict[str, Any]] = []
    for spec in names:
        headlines = crawl_google_rss(spec) + crawl_name_headlines(spec, today, today, max_pages=2)
        new_days = aggregate_days(headlines)
        existing = _load_existing(spec["code"]) or build_name_payload(spec, [])
        merged = merge_days(existing.get("days") or [], new_days)
        payload = build_name_payload(spec, merged)
        save_payload(payload)
        payloads.append(payload)
        print(f"  today {spec['code']} {spec['name']}: +{len(headlines)} raw → {payload['n_days']} days")
    payloads.sort(key=lambda r: (0 if r.get("market") == "kospi" else 1, str(r.get("code"))))
    index = build_index(payloads)
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
    args = parser.parse_args()
    if args.today and not args.backfill:
        run_today_append()
        return
    run_backfill(workers=args.workers, google_only=args.google_only)


if __name__ == "__main__":
    main()
