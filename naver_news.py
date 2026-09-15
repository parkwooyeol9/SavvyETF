"""Naver News search crawler for Korean headlines."""

from __future__ import annotations

import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date
from html import unescape
from urllib.parse import quote

import requests
from lxml import html as lhtml

DEFAULT_HEADLINES_PER_TICKER = 3
MAX_MESSAGE_LENGTH = 3900
MAX_WORKERS = 6
REQUEST_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
        "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 "
        "Mobile/15E148 Safari/604.1"
    ),
    "Referer": "https://m.naver.com/",
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
}
DESKTOP_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
    ),
    "Referer": "https://search.naver.com/search.naver?where=news",
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}
_TIME_RE = re.compile(r"(\d+\s*(?:분|시간|일|주)\s*전|\d{4}\.\d{2}\.\d{2}\.?)")
_HANGUL_RE = re.compile(r"[\uac00-\ud7a3]")
_NOISE = {"Keep에 저장", "Keep에 바로가기", "네이버뉴스", "새 창 열림"}
_RATE_LOCK = threading.Lock()
_LAST_REQUEST = 0.0
_MIN_INTERVAL = 0.12
_ENGLISH_SOURCES = {
    "korea times",
    "korea herald",
    "yonhap eng",
    "yonhap english",
    "reuters",
    "bloomberg",
    "associated press",
    "afp",
}


def _clean_text(value: str) -> str:
    text = unescape(re.sub(r"\s+", " ", value or "")).strip()
    return text


def _looks_korean_headline(title: str, source: str = "") -> bool:
    """Keep Hangul-heavy headlines; drop obvious English wire copy."""
    title = _clean_text(title)
    if not title:
        return False
    if _ENGLISH_SOURCES & {source.strip().lower()}:
        return False
    hangul = len(_HANGUL_RE.findall(title))
    if hangul >= 2:
        return True
    # Brand-only Hangul-less titles (e.g. "NAVER") are not useful as KR news.
    return False


def _search_query_for_ticker(ticker: str, universe: str | None = None) -> str:
    raw = str(ticker or "").strip()
    if not raw:
        return raw
    if universe in {"kospi", "kosdaq"} or raw.upper().endswith((".KS", ".KQ")):
        from kr_names import format_kr_ticker_label, kr_code_from_yahoo

        label = format_kr_ticker_label(raw)
        if "(" in label and label.endswith(")"):
            name = label.rsplit("(", 1)[0].strip()
            if name:
                return f"{name} 주가"
        code = kr_code_from_yahoo(raw)
        return f"{code} 주가" if code else raw
    if universe == "etf":
        from etf_names import lookup_etf_name

        name = lookup_etf_name(raw)
        return name or raw
    return raw


def _throttle() -> None:
    global _LAST_REQUEST
    with _RATE_LOCK:
        now = time.monotonic()
        wait = _MIN_INTERVAL - (now - _LAST_REQUEST)
        if wait > 0:
            time.sleep(wait)
        _LAST_REQUEST = time.monotonic()


def _parse_desktop_news_list(
    content: bytes,
    *,
    limit: int,
    korean_only: bool,
    seen_titles: set[str] | None = None,
) -> list[dict[str, str]]:
    try:
        doc = lhtml.fromstring(content)
    except Exception:
        return []
    lists = doc.xpath('//*[contains(@class,"fds-news-item-list-tab")]')
    if not lists:
        return []
    headlines: list[dict[str, str]] = []
    seen = seen_titles if seen_titles is not None else set()
    for child in lists[0]:
        heads = child.xpath('.//*[contains(@class,"sds-comps-text-type-headline1")]')
        title = _clean_text("".join(heads[0].itertext())) if heads else ""
        title = title.replace("새 창 열림", "").strip()
        if len(title) < 8:
            continue
        src_nodes = child.xpath('.//*[contains(@class,"sds-comps-profile-info-title-text")]')
        source = _clean_text(src_nodes[0].text_content()) if src_nodes else ""
        source = source.replace("새 창 열림", "").strip() or "Naver News"
        if title in seen:
            continue
        if korean_only and not _looks_korean_headline(title, source):
            continue
        link = ""
        for anchor in child.xpath(".//a[@href]"):
            href = (anchor.get("href") or "").strip()
            if not href.startswith("http"):
                continue
            if "keep.naver.com" in href or "search.naver.com" in href:
                continue
            cand = _clean_text(anchor.text_content()).replace("새 창 열림", "").strip()
            if len(cand) < 8:
                continue
            link = href
            break
        seen.add(title)
        item = {"title": title, "source": source, "date": "N/A"}
        if link:
            item["url"] = link
        headlines.append(item)
        if len(headlines) >= limit:
            break
    return headlines


def fetch_naver_news_on_day(
    query: str,
    day: date,
    *,
    max_pages: int = 2,
    korean_only: bool = True,
) -> list[dict[str, str]]:
    """Desktop date-filtered search for a single calendar day."""
    query = (query or "").strip()
    if not query:
        return []
    ds = f"{day:%Y}.{day:%m}.{day:%d}"
    compact = f"{day:%Y%m%d}"
    nso = f"so:dd,p:from{compact}to{compact}"
    seen: set[str] = set()
    out: list[dict[str, str]] = []
    start = 1
    for _ in range(max(1, int(max_pages))):
        url = (
            "https://search.naver.com/search.naver"
            f"?where=news&query={quote(query)}&sm=tab_pge&sort=1"
            f"&photo=0&field=0&pd=3&ds={ds}&de={ds}"
            f"&nso={quote(nso, safe=':,')}&start={start}"
        )
        page: list[dict[str, str]] = []
        try:
            _throttle()
            response = requests.get(url, headers=DESKTOP_HEADERS, timeout=15)
            if response.status_code != 200:
                break
            page = _parse_desktop_news_list(
                response.content,
                limit=40,
                korean_only=korean_only,
                seen_titles=seen,
            )
        except Exception:
            break
        if not page:
            break
        out.extend(page)
        if len(page) < 8:
            break
        start += 10
    return out


def _parse_news_list(
    content: bytes,
    *,
    limit: int,
    korean_only: bool,
    seen_titles: set[str] | None = None,
) -> list[dict[str, str]]:
    try:
        doc = lhtml.fromstring(content)
    except Exception:
        return []

    lists = doc.xpath('//*[contains(@class,"fds-news-item-list-tab")]')
    if not lists:
        return []

    headlines: list[dict[str, str]] = []
    seen = seen_titles if seen_titles is not None else set()

    for child in lists[0]:
        texts = [_clean_text(t) for t in child.itertext() if _clean_text(t)]
        texts = [t for t in texts if t not in _NOISE]
        if len(texts) < 2:
            continue

        source = texts[0]
        date_str = "N/A"
        title_start = 1
        if _TIME_RE.search(texts[1]):
            date_str = texts[1]
            title_start = 2

        title = ""
        link = ""
        for anchor in child.xpath(".//a[@href]"):
            href = (anchor.get("href") or "").strip()
            candidate = _clean_text(anchor.text_content())
            if len(candidate) < 8:
                continue
            if candidate in _NOISE or candidate == source:
                continue
            title = candidate
            link = href
            break

        if not title and title_start < len(texts):
            title = texts[title_start]

        title = _clean_text(title)
        if len(title) < 8 or title in seen:
            continue
        if korean_only and not _looks_korean_headline(title, source):
            continue
        seen.add(title)

        item = {
            "title": title,
            "source": source or "Naver News",
            "date": date_str,
        }
        if link:
            item["url"] = link
        headlines.append(item)
        if len(headlines) >= limit:
            break

    return headlines


def fetch_naver_news_page(
    query: str,
    *,
    limit: int = 40,
    korean_only: bool = True,
    sort: int = 0,
    nso: str | None = None,
    start: int = 1,
    seen_titles: set[str] | None = None,
) -> list[dict[str, str]]:
    """One Naver mobile news search page. ``sort=1`` is date order."""
    query = (query or "").strip()
    if not query or limit <= 0:
        return []
    parts = [
        "https://m.search.naver.com/search.naver",
        f"?where=m_news&query={quote(query)}&sm=mtb_jum&sort={int(sort)}",
        f"&start={max(1, int(start))}",
    ]
    if nso:
        parts.append(f"&nso={quote(nso, safe=':,')}")
    url = "".join(parts)
    try:
        response = requests.get(url, headers=REQUEST_HEADERS, timeout=20)
        response.raise_for_status()
    except Exception:
        return []
    return _parse_news_list(
        response.content,
        limit=limit,
        korean_only=korean_only,
        seen_titles=seen_titles,
    )


def fetch_naver_news(
    query: str,
    limit: int = DEFAULT_HEADLINES_PER_TICKER,
    *,
    korean_only: bool = True,
) -> list[dict[str, str]]:
    """Crawl Naver mobile news search for ``query`` and return headline dicts."""
    return fetch_naver_news_page(
        query, limit=limit, korean_only=korean_only, sort=0, start=1
    )


def fetch_naver_news_range(
    query: str,
    start_day: str,
    end_day: str,
    *,
    max_pages: int = 10,
    korean_only: bool = True,
) -> list[dict[str, str]]:
    """Date-filtered news (YYYY-MM-DD inclusive), newest first."""
    ds = (start_day or "").replace("-", "")[:8]
    de = (end_day or "").replace("-", "")[:8]
    if len(ds) != 8 or len(de) != 8:
        return []
    nso = f"so:dd,p:from{ds}to{de}"
    seen: set[str] = set()
    out: list[dict[str, str]] = []
    start = 1
    for _ in range(max(1, int(max_pages))):
        page = fetch_naver_news_page(
            query,
            limit=40,
            korean_only=korean_only,
            sort=1,
            nso=nso,
            start=start,
            seen_titles=seen,
        )
        if not page:
            break
        out.extend(page)
        start += 10
    return out


def fetch_naver_news_for_tickers(
    tickers: list[str],
    limit: int = DEFAULT_HEADLINES_PER_TICKER,
    *,
    universe: str | None = None,
    korean_only: bool = True,
) -> dict[str, list[dict[str, str]]]:
    results: dict[str, list[dict[str, str]]] = {}
    if not tickers:
        return results

    def _fetch_one(ticker: str) -> list[dict[str, str]]:
        query = _search_query_for_ticker(ticker, universe=universe)
        return fetch_naver_news(query, limit=limit, korean_only=korean_only)

    with ThreadPoolExecutor(max_workers=min(MAX_WORKERS, len(tickers))) as executor:
        futures = {executor.submit(_fetch_one, ticker): ticker for ticker in tickers}
        for future in as_completed(futures):
            ticker = futures[future]
            try:
                results[ticker] = future.result()
            except Exception:
                results[ticker] = []
    return results


def _display_ticker_label(ticker: str, universe: str | None) -> str:
    if universe == "etf":
        from etf_names import format_etf_ticker_label

        return format_etf_ticker_label(ticker)
    if universe in {"kospi", "kosdaq"} or str(ticker).upper().endswith((".KS", ".KQ")):
        from kr_names import format_kr_ticker_label

        return format_kr_ticker_label(ticker)
    return ticker


def _chunk_lines(lines: list[str], max_len: int = MAX_MESSAGE_LENGTH) -> list[str]:
    chunks: list[str] = []
    current: list[str] = []
    current_len = 0

    for line in lines:
        extra = len(line) + (1 if current else 0)
        if current and current_len + extra > max_len:
            chunks.append("\n".join(current))
            current = [line]
            current_len = len(line)
        else:
            current.append(line)
            current_len += extra

    if current:
        chunks.append("\n".join(current))
    return chunks


def format_naver_news_messages(
    tickers: list[str] | None = None,
    context_label: str = "",
    limit: int = DEFAULT_HEADLINES_PER_TICKER,
    *,
    universe: str | None = None,
    query: str | None = None,
) -> list[str]:
    """Format Telegram text chunks for /news_naver."""
    if query:
        headlines = fetch_naver_news(query, limit=max(limit, 8), korean_only=True)
        lines = [f"Naver News: {query}", ""]
        if not headlines:
            lines.append("(no recent headlines found)")
        else:
            for idx, item in enumerate(headlines, start=1):
                lines.append(f"{idx}. {item['title']}")
                lines.append(f"   {item['source']} | {item['date']}")
        return _chunk_lines(lines)

    if not tickers:
        return [
            "No tickers to look up.\n"
            "Run /kospi or /kosdaq first, then /news_naver.\n"
            "Or search directly: /news_naver 삼성전자"
        ]

    news_by_ticker = fetch_naver_news_for_tickers(
        tickers, limit=limit, universe=universe
    )
    lines = ["Naver News headlines for last ranking"]
    if context_label:
        lines.append(f"Context: {context_label}")
    lines.append(
        f"Tickers: {', '.join(_display_ticker_label(t, universe) for t in tickers)}"
    )
    lines.append("")

    for ticker in tickers:
        headlines = news_by_ticker.get(ticker, [])
        label = _display_ticker_label(ticker, universe)
        lines.append(f"[{label}]")
        if not headlines:
            lines.append("  (no recent headlines found)")
        else:
            for idx, item in enumerate(headlines, start=1):
                lines.append(f"  {idx}. {item['title']}")
                lines.append(f"     {item['source']} | {item['date']}")
        lines.append("")

    if lines and lines[-1] == "":
        lines.pop()

    return _chunk_lines(lines)
