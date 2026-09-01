"""Daily KR ESG event monitor for ESG 시황 + SavvyESG (ESG 에이전트).

Screens KIND / Open DART / news for high-impact S·E·G events and publishes
a 09:00 KST snapshot (dashboard JSON + Telegram).
"""

from __future__ import annotations

import hashlib
import json
import re
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any
from urllib.parse import quote
from zoneinfo import ZoneInfo

import requests
from lxml import html as lhtml

from dart_data import _esc

KST = ZoneInfo("Asia/Seoul")
PROJECT_DIR = Path(__file__).resolve().parent
DATA_DIR = PROJECT_DIR / "data" / "esg_events"
LATEST_PATH = DATA_DIR / "latest.json"
R2_KEY = "esg_events/latest.json"

DART_VIEWER = "https://dart.fss.or.kr/dsaf001/main.do?rcpNo={rcept_no}"
KIND_VIEWER = "https://kind.krx.co.kr/common/disclsviewer.do?method=search&acptno={acptno}"
KIND_DETAILS_URL = "https://kind.krx.co.kr/disclosure/details.do"
KIND_MAIN = f"{KIND_DETAILS_URL}?method=searchDetailsMain"

LOOKBACK_DAYS = 14
MAX_HITS_PER_CATEGORY = 18
MAX_NEWS_PER_CATEGORY = 8
MAX_TG = 3800
MAX_TG_DIGEST_ITEMS = 8
MAX_TG_PER_CATEGORY = 3
MAX_TG_NEWS = 2
REQUEST_TIMEOUT = 22

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
HEADERS = {
    "User-Agent": UA,
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

ACPTNO_RE = re.compile(
    r"(?:openDisclsViewer|fnDisClsViewer)\(['\"](\d{10,})['\"]",
    re.I,
)
ACPTNO_HREF_RE = re.compile(r"acptno=(\d{10,})", re.I)
YMD_RE = re.compile(r"(\d{4})[.\-/](\d{2})[.\-/](\d{2})")
RELATIVE_RE = re.compile(r"(\d+)\s*(분|시간|일)\s*전")

# pillar / daily checks — sources match the product table.
CATEGORIES: tuple[dict[str, Any], ...] = (
    {
        "id": "s_accident",
        "pillar": "S",
        "title": "중대재해 발생 공시",
        "check": "중대재해 발생 공시",
        "sources_note": "KRX KIND · Open DART",
        "importance": "매우 높음",
        "kind_keywords": ("중대재해",),
        "dart_keywords": ("중대재해", "산업재해", "산재사망", "사망사고"),
        "dart_types": ("I",),
        "news_queries": ("중대재해 공시 상장", "중대재해 발생 기업"),
    },
    {
        "id": "s_csa",
        "pillar": "S",
        "title": "중대재해처벌법 기소·판결",
        "check": "중대재해처벌법 관련 기소·판결",
        "sources_note": "KIND · 법원·고용노동부 보도",
        "importance": "매우 높음",
        "kind_keywords": ("중대재해처벌",),
        "dart_keywords": ("중대재해처벌", "중처법"),
        "dart_types": ("I", "E"),
        "news_queries": (
            "중대재해처벌법 기소",
            "중대재해처벌법 판결",
            "중처법 유죄",
        ),
    },
    {
        "id": "e_env",
        "pillar": "E",
        "title": "대기·수질·폐기물 위반",
        "check": "대기·수질·폐기물 위반, 조업정지, 과징금",
        "sources_note": "환경부·지자체 · 회사 공시 (KIND/DART)",
        "importance": "매우 높음",
        "kind_keywords": ("조업정지", "과징금"),
        "dart_keywords": (
            "조업정지",
            "배출허용",
            "대기환경",
            "수질오염",
            "폐기물",
            "환경오염",
            "환경 과징금",
            "환경과징금",
        ),
        "dart_types": ("I", "E"),
        "news_queries": (
            "조업정지 과징금 환경",
            "환경부 과징금 상장",
            "대기 배출 위반 기업",
        ),
        "news_keep": ("환경", "대기", "수질", "폐기물", "배출", "조업정지", "환경부"),
    },
    {
        "id": "g_fraud",
        "pillar": "G",
        "title": "횡령·배임·회계·감사의견",
        "check": "횡령·배임, 회계처리 위반, 감사의견 변경",
        "sources_note": "DART · KIND · 증선위 보도",
        "importance": "매우 높음",
        "kind_keywords": ("횡령", "배임", "감사의견"),
        "dart_keywords": (
            "횡령",
            "배임",
            "회계처리",
            "감사의견",
            "의견거절",
            "한정의견",
            "부적정",
            "증선위",
        ),
        "dart_types": ("B", "F", "I"),
        "news_queries": (
            "횡령 배임 상장",
            "감사의견 거절",
            "회계처리 위반 증선위",
        ),
    },
    {
        "id": "g_control",
        "pillar": "G",
        "title": "최대주주·경영권·임원 해임",
        "check": "최대주주 변경, 경영권 분쟁, 임원 해임",
        "sources_note": "KIND · DART",
        "importance": "높음",
        "kind_keywords": ("최대주주변경", "경영권", "임원해임"),
        "dart_keywords": (
            "최대주주변경",
            "최대주주 변경",
            "경영권 분쟁",
            "경영권분쟁",
            "임원 해임",
            "대표이사 해임",
            "해임결정",
        ),
        "dart_types": ("D", "I", "B"),
        "news_queries": ("최대주주 변경 공시", "경영권 분쟁 상장", "임원 해임 상장"),
    },
)


def _now() -> datetime:
    return datetime.now(KST)


def _ymd(value: datetime | None = None) -> str:
    return (value or _now()).strftime("%Y-%m-%d")


def _hit_id(*parts: str) -> str:
    raw = "|".join(p.strip() for p in parts if p)
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]


def _norm_date(raw: Any, *, fallback: str | None = None) -> str:
    text = str(raw or "").strip()
    if not text:
        return fallback or ""
    compact = re.sub(r"[^\d]", "", text)
    if len(compact) >= 8 and compact[:8].isdigit():
        return f"{compact[0:4]}-{compact[4:6]}-{compact[6:8]}"
    found = YMD_RE.search(text)
    if found:
        return f"{found.group(1)}-{found.group(2)}-{found.group(3)}"
    rel = RELATIVE_RE.search(text)
    if rel:
        n = int(rel.group(1))
        unit = rel.group(2)
        now = _now()
        if unit == "일":
            return _ymd(now - timedelta(days=n))
        return _ymd(now)
    return fallback or ""


def _is_fresh(ymd: str, hours: int = 36) -> bool:
    if not ymd:
        return False
    try:
        dt = datetime.strptime(ymd, "%Y-%m-%d").replace(tzinfo=KST)
    except ValueError:
        return False
    return (_now() - dt) <= timedelta(hours=hours)


def is_recent_esg_date(raw: Any, hours: int = 36) -> bool:
    """True when a KIND/DART date string falls within the last `hours`."""
    return _is_fresh(_norm_date(raw), hours=hours)


def _title_matches(title: str, keywords: tuple[str, ...]) -> list[str]:
    return [k for k in keywords if k and k in (title or "")]


def _kind_session() -> requests.Session:
    session = requests.Session()
    session.headers.update(HEADERS)
    return session


def _parse_kind_rows(html_text: str) -> list[dict[str, Any]]:
    if not html_text or len(html_text) < 80:
        return []
    try:
        doc = lhtml.fromstring(html_text)
    except Exception:
        return []

    rows: list[dict[str, Any]] = []
    for tr in doc.xpath("//table[contains(@class,'list')]//tr"):
        hrefs = " ".join(tr.xpath(".//a/@href") or [])
        onclick = " ".join(tr.xpath(".//@onclick") or [])
        blob = hrefs + " " + onclick + " " + lhtml.tostring(tr, encoding="unicode")
        acpt = ""
        m = ACPTNO_RE.search(blob) or ACPTNO_HREF_RE.search(blob)
        if m:
            acpt = m.group(1)

        date_s = ""
        for cell in tr.xpath("./td"):
            text = re.sub(r"\s+", " ", " ".join(cell.xpath(".//text()"))).strip()
            if YMD_RE.search(text):
                date_s = _norm_date(text)
                break

        corp = ""
        for a in tr.xpath(".//a[@id='companysum']|.//a[@title]"):
            corp = (a.get("title") or "").strip() or re.sub(
                r"\s+", " ", a.text_content()
            ).strip()
            if corp:
                break
        if not corp:
            tds = tr.xpath("./td")
            if len(tds) >= 3:
                corp = re.sub(r"\s+", " ", tds[2].text_content()).strip()

        title = ""
        for a in tr.xpath(".//a"):
            href = (a.get("href") or "") + (a.get("onclick") or "")
            if "openDisclsViewer" in href or "acptno=" in href:
                title = re.sub(r"\s+", " ", a.text_content()).strip()
                if title:
                    break
        if not title:
            tds = tr.xpath("./td")
            if len(tds) >= 4:
                title = re.sub(r"\s+", " ", tds[3].text_content()).strip()
        if not title or len(title) < 4:
            continue
        if corp and (corp == title or re.fullmatch(r"\d{1,4}", corp)):
            corp = ""
        rows.append(
            {
                "date": date_s,
                "corp_name": corp,
                "title": title,
                "acptno": acpt,
            }
        )
    return rows


def _kind_form_payload(session: requests.Session) -> dict[str, str]:
    cached = getattr(session, "_kind_form", None)
    if isinstance(cached, dict) and cached:
        return dict(cached)
    resp = session.get(KIND_MAIN, timeout=REQUEST_TIMEOUT)
    resp.raise_for_status()
    doc = lhtml.fromstring(resp.content)
    form = None
    for candidate in doc.xpath("//form"):
        if (candidate.get("id") or candidate.get("name") or "") == "searchForm":
            form = candidate
            break
    if form is None:
        raise RuntimeError("KIND searchForm not found")
    payload: dict[str, str] = {}
    for inp in form.xpath(".//input|.//select"):
        name = inp.get("name")
        if not name or name in payload:
            continue
        typ = (inp.get("type") or "").lower()
        if typ in {"checkbox", "radio"} and inp.get("checked") is None:
            continue
        if inp.tag == "select":
            selected = inp.xpath(".//option[@selected]/@value")
            payload[name] = selected[0] if selected else (
                (inp.xpath(".//option[1]/@value") or [""])[0]
            )
        else:
            payload[name] = inp.get("value") or ""
    session._kind_form = payload  # type: ignore[attr-defined]
    return dict(payload)


def search_kind(
    keyword: str,
    *,
    days: int = LOOKBACK_DAYS,
    limit: int = 20,
    session: requests.Session | None = None,
) -> list[dict[str, Any]]:
    keyword = (keyword or "").strip()
    if not keyword:
        return []
    end = _now()
    start = end - timedelta(days=days)
    sess = session or _kind_session()
    try:
        payload = _kind_form_payload(sess)
    except Exception as exc:
        print(f"KIND form load failed ({keyword!r}): {exc}")
        return []
    payload.update(
        {
            "method": "searchDetailsSub",
            "forward": "details_sub",
            "currentPageSize": "100",
            "pageIndex": "1",
            "orderMode": payload.get("orderMode") or "1",
            "orderStat": payload.get("orderStat") or "D",
            "fromDate": start.strftime("%Y-%m-%d"),
            "toDate": end.strftime("%Y-%m-%d"),
            "reportNm": keyword,
            "reportNmTemp": keyword,
        }
    )
    try:
        resp = sess.post(
            KIND_DETAILS_URL,
            data=payload,
            timeout=REQUEST_TIMEOUT,
            headers={
                **HEADERS,
                "Referer": KIND_MAIN,
                "Origin": "https://kind.krx.co.kr",
                "X-Requested-With": "XMLHttpRequest",
            },
        )
        resp.raise_for_status()
    except Exception as exc:
        print(f"KIND search failed ({keyword!r}): {exc}")
        return []
    if "errorpage" in resp.text or "요청하신 페이지는 존재하지" in resp.text:
        print(f"KIND search failed ({keyword!r}): error page")
        return []
    rows = _parse_kind_rows(resp.text)
    out: list[dict[str, Any]] = []
    for row in rows[:limit]:
        acpt = row.get("acptno") or ""
        title = row.get("title") or ""
        date_s = row.get("date") or ""
        corp = row.get("corp_name") or ""
        out.append(
            {
                "id": _hit_id("KIND", acpt, title, date_s),
                "date": date_s,
                "corp_name": corp,
                "stock_code": "",
                "title": title,
                "source": "KIND",
                "source_url": KIND_VIEWER.format(acptno=acpt) if acpt else "",
                "matched": [keyword],
                "fresh": _is_fresh(date_s),
            }
        )
    return out


def _dart_hits_for_category(cat: dict[str, Any], *, days: int) -> tuple[list[dict[str, Any]], str | None]:
    from esg_data import screen_keyword_disclosures

    keywords = tuple(cat.get("dart_keywords") or ())
    if not keywords:
        return [], None
    types = tuple(cat.get("dart_types") or (None,))
    merged: list[dict[str, Any]] = []
    seen: set[str] = set()
    err: str | None = None
    for ty in types:
        try:
            rows = screen_keyword_disclosures(
                keywords,
                days=days,
                max_pages=5,
                limit=MAX_HITS_PER_CATEGORY,
                pblntf_ty=ty,
            )
        except Exception as exc:
            err = str(exc)
            continue
        for row in rows:
            key = str(row.get("rcept_no") or f"{row.get('date')}|{row.get('report_nm')}")
            if key in seen:
                continue
            seen.add(key)
            title = str(row.get("report_nm") or "").strip()
            date_s = _norm_date(row.get("date"))
            rcept = str(row.get("rcept_no") or "")
            merged.append(
                {
                    "id": _hit_id("DART", rcept, title),
                    "date": date_s,
                    "corp_name": str(row.get("corp_name") or ""),
                    "stock_code": str(row.get("stock_code") or "").strip(),
                    "title": title,
                    "source": "DART",
                    "source_url": DART_VIEWER.format(rcept_no=rcept) if rcept else "",
                    "matched": list(row.get("matched") or _title_matches(title, keywords)),
                    "fresh": _is_fresh(date_s),
                }
            )
        time.sleep(0.08)
    merged.sort(key=lambda h: h.get("date") or "", reverse=True)
    return merged[:MAX_HITS_PER_CATEGORY], err


def _google_news(query: str, *, limit: int = 6) -> list[dict[str, Any]]:
    url = (
        "https://news.google.com/rss/search?"
        f"q={quote(query + ' when:14d')}&hl=ko&gl=KR&ceid=KR:ko"
    )
    try:
        resp = requests.get(
            url,
            headers={**HEADERS, "Accept": "application/rss+xml, application/xml"},
            timeout=REQUEST_TIMEOUT,
        )
        resp.raise_for_status()
        root = ET.fromstring(resp.content)
    except Exception:
        return []
    items = root.findall(".//item")
    if not items:
        items = root.findall(".//{*}item")
    out: list[dict[str, Any]] = []
    for item in items[:limit]:
        title = (item.findtext("title") or "").strip()
        link = (item.findtext("link") or "").strip()
        pub = (item.findtext("pubDate") or "").strip()
        source_el = item.find("source")
        source = (source_el.text or "Google News").strip() if source_el is not None else "Google News"
        if " - " in title:
            title, maybe_src = title.rsplit(" - ", 1)
            if maybe_src:
                source = maybe_src.strip() or source
        date_s = ""
        if pub:
            try:
                date_s = parsedate_to_datetime(pub).astimezone(KST).strftime("%Y-%m-%d")
            except (TypeError, ValueError, OverflowError):
                date_s = _norm_date(pub)
        if not title:
            continue
        out.append(
            {
                "id": _hit_id("NEWS", source, title, date_s),
                "date": date_s,
                "corp_name": "",
                "stock_code": "",
                "title": title,
                "source": source or "Google News",
                "source_url": link,
                "matched": [],
                "fresh": _is_fresh(date_s),
                "kind": "news",
            }
        )
    return out


def _naver_news(query: str, *, limit: int = 4) -> list[dict[str, Any]]:
    try:
        from naver_news import fetch_naver_news

        rows = fetch_naver_news(query, limit=limit, korean_only=True)
    except Exception:
        return []
    out: list[dict[str, Any]] = []
    for row in rows:
        title = str(row.get("title") or "").strip()
        if not title:
            continue
        date_s = _norm_date(row.get("date"), fallback=_ymd())
        source = str(row.get("source") or "Naver")
        url = str(row.get("url") or "")
        out.append(
            {
                "id": _hit_id("NAVER", source, title, date_s),
                "date": date_s,
                "corp_name": "",
                "stock_code": "",
                "title": title,
                "source": source,
                "source_url": url,
                "matched": [],
                "fresh": _is_fresh(date_s),
                "kind": "news",
            }
        )
    return out


def _news_relevant(title: str, cat: dict[str, Any]) -> bool:
    keep = tuple(cat.get("news_keep") or ()) + tuple(cat.get("dart_keywords") or ())
    keep += tuple(cat.get("kind_keywords") or ())
    return bool(_title_matches(title, keep))


def _collect_news(cat: dict[str, Any]) -> list[dict[str, Any]]:
    queries = tuple(cat.get("news_queries") or ())
    merged: list[dict[str, Any]] = []
    seen: set[str] = set()
    for q in queries:
        for item in _naver_news(q) + _google_news(q):
            title = item.get("title") or ""
            if not _news_relevant(title, cat):
                continue
            key = re.sub(r"\s+", "", title.lower())
            if key in seen:
                continue
            seen.add(key)
            item["matched"] = _title_matches(
                title,
                tuple(cat.get("dart_keywords") or ()) + tuple(cat.get("kind_keywords") or ()),
            )
            merged.append(item)
        time.sleep(0.05)
    merged.sort(key=lambda h: h.get("date") or "", reverse=True)
    return merged[:MAX_NEWS_PER_CATEGORY]


def _merge_hits(*groups: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for group in groups:
        for item in group:
            title_key = re.sub(r"\s+", "", (item.get("title") or "").lower())
            corp_key = re.sub(r"\s+", "", (item.get("corp_name") or "").lower())
            key = f"{item.get('date')}|{corp_key}|{title_key}"
            if key in seen:
                continue
            seen.add(key)
            out.append(item)
    out.sort(key=lambda h: (h.get("date") or "", h.get("corp_name") or ""), reverse=True)
    return out


def _collect_category(
    cat: dict[str, Any],
    *,
    days: int,
    session: requests.Session | None,
) -> dict[str, Any]:
    errors: list[str] = []
    kind_hits: list[dict[str, Any]] = []
    for kw in tuple(cat.get("kind_keywords") or ()):
        try:
            kind_hits.extend(search_kind(kw, days=days, session=session))
        except Exception as exc:
            errors.append(f"KIND {kw}: {exc}")
        time.sleep(0.25)
    keep = tuple(cat.get("news_keep") or ())
    if keep:
        kind_hits = [
            h
            for h in kind_hits
            if _title_matches(h.get("title") or "", keep)
            or _title_matches(
                h.get("title") or "",
                tuple(cat.get("dart_keywords") or ()),
            )
        ]

    dart_hits, dart_err = _dart_hits_for_category(cat, days=days)
    if dart_err:
        if "DART_API_KEY is not set" in dart_err:
            print(f"DART skipped ({cat['id']}): API key not set")
        else:
            errors.append(f"DART: {dart_err}")

    news_hits: list[dict[str, Any]] = []
    try:
        news_hits = _collect_news(cat)
    except Exception as exc:
        errors.append(f"news: {exc}")

    filings = _merge_hits(kind_hits, dart_hits)[:MAX_HITS_PER_CATEGORY]
    news_only = []
    filing_titles = {re.sub(r"\s+", "", (h.get("title") or "").lower()) for h in filings}
    for n in news_hits:
        key = re.sub(r"\s+", "", (n.get("title") or "").lower())
        if key in filing_titles:
            continue
        news_only.append(n)

    return {
        "id": cat["id"],
        "pillar": cat["pillar"],
        "title": cat["title"],
        "check": cat["check"],
        "sources_note": cat["sources_note"],
        "importance": cat["importance"],
        "hits": filings,
        "news": news_only[:MAX_NEWS_PER_CATEGORY],
        "error": "; ".join(errors[:3]) if errors else None,
    }


def build_esg_events_bundle(*, days: int = LOOKBACK_DAYS) -> dict[str, Any]:
    days = max(3, min(int(days), 30))
    now = _now()
    errors: list[str] = []
    session = _kind_session()
    categories: list[dict[str, Any]] = []

    # KIND session is cookie-bound — keep KIND sequential; DART/news inside each cat.
    for cat in CATEGORIES:
        try:
            categories.append(_collect_category(cat, days=days, session=session))
        except Exception as exc:
            errors.append(f"{cat['id']}: {exc}")
            categories.append(
                {
                    "id": cat["id"],
                    "pillar": cat["pillar"],
                    "title": cat["title"],
                    "check": cat["check"],
                    "sources_note": cat["sources_note"],
                    "importance": cat["importance"],
                    "hits": [],
                    "news": [],
                    "error": str(exc),
                }
            )

    by_pillar = {"E": 0, "S": 0, "G": 0}
    total = 0
    fresh = 0
    for cat in categories:
        n = len(cat.get("hits") or []) + len(cat.get("news") or [])
        total += n
        by_pillar[str(cat.get("pillar") or "G")] = (
            by_pillar.get(str(cat.get("pillar") or "G"), 0) + n
        )
        fresh += sum(1 for h in (cat.get("hits") or []) if h.get("fresh"))
        fresh += sum(1 for h in (cat.get("news") or []) if h.get("fresh"))
        if cat.get("error"):
            errors.append(str(cat["error"]))

    return {
        "ok": True,
        "generated_at": now.isoformat(timespec="seconds"),
        "generated_at_display": now.strftime("%Y-%m-%d %H:%M KST"),
        "as_of": _ymd(now),
        "lookback_days": days,
        "timezone": "Asia/Seoul",
        "note": (
            "매일 09:00 KST 갱신 · KIND·DART 공시 + 법원·고용노동부·환경부·증선위 관련 보도. "
            "텔레그램은 고중요도·당일 건만 하루 최대 5건. 법적·투자 자문이 아닙니다."
        ),
        "channel": {
            "name": "ESG 에이전트",
            "handle": "@SavvyESG",
            "href": "https://t.me/SavvyESG",
        },
        "categories": categories,
        "summary": {
            "total": total,
            "fresh": fresh,
            "by_pillar": by_pillar,
        },
        "errors": errors[:8],
        "source": "kind+dart+news",
    }


def persist_bundle(bundle: dict[str, Any]) -> dict[str, Any]:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    LATEST_PATH.write_text(
        json.dumps(bundle, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    r2_ok = False
    try:
        from r2_data import put_json, r2_configured

        if r2_configured():
            r2_ok = bool(put_json(R2_KEY, bundle))
    except Exception as exc:
        print(f"esg_events R2 upload skipped: {exc}")
    return {"local": True, "r2": r2_ok}


def load_latest() -> dict[str, Any] | None:
    if LATEST_PATH.is_file():
        try:
            parsed = json.loads(LATEST_PATH.read_text(encoding="utf-8"))
            if isinstance(parsed, dict) and parsed.get("categories"):
                return parsed
        except (OSError, json.JSONDecodeError):
            pass
    try:
        from r2_data import get_json

        remote = get_json(R2_KEY)
        if isinstance(remote, dict) and remote.get("categories"):
            return remote
    except Exception:
        pass
    return None


def _fmt_hit_line(item: dict[str, Any], *, idx: int | None = None) -> str:
    date_s = item.get("date") or ""
    corp = _esc(item.get("corp_name") or "")
    title = _esc(item.get("title") or "")
    src = _esc(item.get("source") or "")
    code = (item.get("stock_code") or "").strip()
    code_s = f" <code>{_esc(code)}</code>" if code else ""
    prefix = f"{idx}. " if idx is not None else "· "
    head = f"{prefix}{date_s} {corp}{code_s}".strip()
    link = ""
    url = item.get("source_url") or ""
    if url:
        link = f' <a href="{_esc(url)}">원문</a>'
    return f"{head}\n    {title} · {src}{link}"


def _digest_worthy(item: dict[str, Any], cat: dict[str, Any]) -> bool:
    if item.get("fresh"):
        return True
    if cat.get("importance") == "매우 높음" and _is_fresh(
        item.get("date") or "", hours=72
    ):
        return True
    return False


def _digest_rank(item: dict[str, Any], cat: dict[str, Any]) -> tuple:
    fresh = 1 if item.get("fresh") else 0
    imp = 2 if cat.get("importance") == "매우 높음" else 1 if cat.get("importance") == "높음" else 0
    pillar = {
        "s_accident": 4,
        "s_csa": 4,
        "g_fraud": 3,
        "e_env": 3,
        "g_control": 1,
    }.get(str(cat.get("id") or ""), 0)
    return (fresh, imp, pillar, item.get("date") or "")


def _collect_digest_items(
    bundle: dict[str, Any],
) -> list[tuple[dict[str, Any], dict[str, Any], str]]:
    picked: list[tuple[dict[str, Any], dict[str, Any], str]] = []
    per_cat: dict[str, int] = {}
    news_n = 0
    candidates: list[tuple[tuple, dict[str, Any], dict[str, Any], str]] = []
    for cat in bundle.get("categories") or []:
        for item in cat.get("hits") or []:
            if _digest_worthy(item, cat):
                candidates.append((_digest_rank(item, cat), cat, item, "hit"))
        for item in cat.get("news") or []:
            if item.get("fresh"):
                candidates.append((_digest_rank(item, cat), cat, item, "news"))
    candidates.sort(key=lambda row: row[0], reverse=True)
    for _rank, cat, item, kind in candidates:
        cat_id = str(cat.get("id") or "")
        if per_cat.get(cat_id, 0) >= MAX_TG_PER_CATEGORY:
            continue
        if kind == "news" and news_n >= MAX_TG_NEWS:
            continue
        picked.append((cat, item, kind))
        per_cat[cat_id] = per_cat.get(cat_id, 0) + 1
        if kind == "news":
            news_n += 1
        if len(picked) >= MAX_TG_DIGEST_ITEMS:
            break
    return picked


def _format_digest_blocks(picked: list[tuple[dict[str, Any], dict[str, Any], str]]) -> list[str]:
    grouped: list[tuple[dict[str, Any], list[tuple[dict[str, Any], str]]]] = []
    index: dict[str, int] = {}
    for cat, item, kind in picked:
        cat_id = str(cat.get("id") or "")
        if cat_id not in index:
            index[cat_id] = len(grouped)
            grouped.append((cat, []))
        grouped[index[cat_id]][1].append((item, kind))
    blocks: list[str] = []
    for cat, rows in grouped:
        lines = [
            f"<b>{_esc(cat.get('pillar'))} · {_esc(cat.get('title'))}</b> "
            f"({_esc(cat.get('importance'))})",
        ]
        for i, (item, _kind) in enumerate(rows, start=1):
            lines.append(_fmt_hit_line(item, idx=i))
        blocks.append("\n".join(lines))
    return blocks


def format_esg_events_telegram(bundle: dict[str, Any]) -> list[dict[str, Any]]:
    """Channel digest: high-impact / fresh items only, packed into as few messages as possible."""
    picked = _collect_digest_items(bundle)
    if not picked:
        return []
    summary = bundle.get("summary") or {}
    by_p = summary.get("by_pillar") or {}
    header = "\n".join(
        [
            "<b>ESG 에이전트 · 일일 시황 (중요 건)</b>",
            f"<i>{_esc(bundle.get('generated_at_display') or bundle.get('generated_at'))} · "
            f"최근 {bundle.get('lookback_days', LOOKBACK_DAYS)}일 · @SavvyESG</i>",
            "",
            f"S {by_p.get('S', 0)} · E {by_p.get('E', 0)} · G {by_p.get('G', 0)} · "
            f"24h 신규 {summary.get('fresh', 0)} · 송출 {len(picked)}건",
            "<i>과열 공시·단순 스크리닝은 생략. 전체는 웹 ESG 시황.</i>",
        ]
    )
    blocks = _format_digest_blocks(picked)
    footer = (
        "\n<i>Source: KIND · Open DART · 뉴스 · Not legal/investment advice.</i>"
    )

    packed: list[str] = []
    current = header
    for block in blocks:
        candidate = f"{current}\n\n{block}"
        if len(candidate) + len(footer) < MAX_TG:
            current = candidate
            continue
        packed.append(current + (footer if current == header else ""))
        current = block
    packed.append(current + footer)

    return [{"text": text, "parse_mode": "HTML"} for text in packed if text.strip()]


def format_esg_events_sections(bundle: dict[str, Any]) -> list[dict[str, Any]]:
    sections: list[dict[str, Any]] = []
    summary = bundle.get("summary") or {}
    by_p = summary.get("by_pillar") or {}
    sections.append(
        {
            "heading": "ESG 에이전트 · 일일 시황",
            "html_or_text": (
                f"{_esc(bundle.get('generated_at_display') or '')} · "
                f"최근 {bundle.get('lookback_days', LOOKBACK_DAYS)}일<br/>"
                f"S {by_p.get('S', 0)} · E {by_p.get('E', 0)} · G {by_p.get('G', 0)} · "
                f"24h 신규 {summary.get('fresh', 0)}"
            ),
        }
    )
    for cat in bundle.get("categories") or []:
        items = []
        for item in (cat.get("hits") or [])[:12]:
            items.append(f"<li>{_fmt_hit_line(item).replace(chr(10), '<br/>')}</li>")
        for item in (cat.get("news") or [])[:6]:
            items.append(f"<li>{_fmt_hit_line(item).replace(chr(10), '<br/>')}</li>")
        body = (
            f"<p><i>{_esc(cat.get('sources_note'))} · {_esc(cat.get('importance'))}</i></p>"
            + (
                f"<ul>{''.join(items)}</ul>"
                if items
                else "<p>해당 기간 신규 건 없음.</p>"
            )
        )
        sections.append(
            {
                "heading": f"{cat.get('pillar')} · {cat.get('title')}",
                "html_or_text": body,
            }
        )
    return sections


def run_esg_events(*, publish: bool = True, days: int = LOOKBACK_DAYS) -> dict[str, Any]:
    bundle = build_esg_events_bundle(days=days)
    persist_bundle(bundle)
    messages = format_esg_events_telegram(bundle)
    if publish:
        try:
            from web_publish import publish_brief

            publish_brief(
                "esg",
                "esg_events",
                title="ESG 에이전트 · 일일 시황",
                generated_at=bundle.get("generated_at_display")
                or bundle.get("generated_at"),
                sections=format_esg_events_sections(bundle),
                meta={
                    "mode": "events",
                    "as_of": bundle.get("as_of"),
                    "lookback_days": bundle.get("lookback_days"),
                    "summary": bundle.get("summary"),
                    "channel": bundle.get("channel"),
                },
            )
        except Exception as pub_exc:
            print(f"web_publish esg_events skipped: {pub_exc}")
    return {
        "mode": "events",
        "bundle": bundle,
        "text_summary": (messages[0]["text"] if messages else ""),
        "telegram_messages": messages,
    }


if __name__ == "__main__":
    result = run_esg_events(publish=False)
    bundle = result["bundle"]
    print(
        json.dumps(
            {
                "ok": bundle.get("ok"),
                "as_of": bundle.get("as_of"),
                "summary": bundle.get("summary"),
                "errors": bundle.get("errors"),
                "messages": len(result.get("telegram_messages") or []),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
