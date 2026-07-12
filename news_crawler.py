import contextlib
import os
import re
import sys
import time
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime

import requests
import yfinance as yf

DEFAULT_HEADLINES_PER_TICKER = 3
MAX_MESSAGE_LENGTH = 3900
MAX_WORKERS = 6
REQUEST_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    )
}


@contextlib.contextmanager
def _quiet_yfinance():
    with open(os.devnull, "w", encoding="utf-8") as devnull:
        old_stderr = sys.stderr
        sys.stderr = devnull
        try:
            yield
        finally:
            sys.stderr = old_stderr


def _parse_news_item(item: dict) -> dict[str, str] | None:
    content = item.get("content") if isinstance(item.get("content"), dict) else item

    title = (content.get("title") or item.get("title") or "").strip()
    if not title:
        return None

    provider = content.get("provider")
    if isinstance(provider, dict):
        source = provider.get("displayName") or provider.get("name") or "Unknown"
    else:
        source = item.get("publisher") or "Unknown"

    pub_raw = content.get("pubDate") or item.get("providerPublishTime")
    if isinstance(pub_raw, (int, float)):
        date_str = time.strftime("%Y-%m-%d", time.localtime(pub_raw))
    elif isinstance(pub_raw, str) and len(pub_raw) >= 10:
        try:
            date_str = datetime.fromisoformat(pub_raw.replace("Z", "+00:00")).strftime("%Y-%m-%d")
        except ValueError:
            date_str = pub_raw[:10]
    else:
        date_str = "N/A"

    return {"title": title, "source": str(source), "date": date_str}


def _fetch_google_news_rss(query: str, limit: int = DEFAULT_HEADLINES_PER_TICKER) -> list[dict[str, str]]:
    url = (
        "https://news.google.com/rss/search"
        f"?q={requests.utils.quote(query)}&hl=en-US&gl=US&ceid=US:en"
    )
    try:
        response = requests.get(url, headers=REQUEST_HEADERS, timeout=20)
        response.raise_for_status()
        root = ET.fromstring(response.content)
    except Exception:
        return []

    headlines: list[dict[str, str]] = []
    for item in root.findall(".//item")[:limit]:
        title = (item.findtext("title") or "").strip()
        if not title:
            continue
        source = "Google News"
        if " - " in title:
            maybe_title, maybe_source = title.rsplit(" - ", 1)
            if len(maybe_source) < 40:
                title = maybe_title.strip()
                source = maybe_source.strip()
        pub_date = (item.findtext("pubDate") or "").strip()
        if pub_date and len(pub_date) >= 16:
            date_str = pub_date[:16]
        elif pub_date:
            date_str = pub_date[:10]
        else:
            date_str = "N/A"
        headlines.append({"title": title, "source": source, "date": date_str})
    return headlines


def fetch_etf_news(ticker: str, limit: int = DEFAULT_HEADLINES_PER_TICKER) -> list[dict[str, str]]:
    from etf_names import etf_news_search_query, lookup_etf_name

    name = lookup_etf_name(ticker)
    query = etf_news_search_query(ticker, name)
    headlines = _fetch_google_news_rss(query, limit=limit)
    if headlines:
        return headlines
    return _fetch_google_news_rss(f"{ticker} ETF", limit=limit)


CRYPTO_NEWS_QUERIES = {
    "BTC": "Bitcoin cryptocurrency market",
    "ETH": "Ethereum cryptocurrency market",
}


def fetch_crypto_news(symbol: str, limit: int = DEFAULT_HEADLINES_PER_TICKER) -> list[dict[str, str]]:
    query = CRYPTO_NEWS_QUERIES.get(symbol.strip().upper(), f"{symbol} cryptocurrency")
    headlines = _fetch_google_news_rss(query, limit=limit)
    if headlines:
        return headlines
    return _fetch_google_news_rss(f"{symbol} crypto", limit=limit)


def fetch_ticker_news(ticker: str, limit: int = DEFAULT_HEADLINES_PER_TICKER) -> list[dict[str, str]]:
    with _quiet_yfinance():
        try:
            raw_news = yf.Ticker(ticker).news or []
        except Exception:
            return []

    headlines: list[dict[str, str]] = []
    for item in raw_news:
        parsed = _parse_news_item(item)
        if parsed:
            headlines.append(parsed)
        if len(headlines) >= limit:
            break
    return headlines


def fetch_news_for_tickers(
    tickers: list[str],
    limit: int = DEFAULT_HEADLINES_PER_TICKER,
    *,
    universe: str | None = None,
) -> dict[str, list[dict[str, str]]]:
    results: dict[str, list[dict[str, str]]] = {}
    if not tickers:
        return results

    if universe == "etf":
        from etf_names import prefetch_etf_names

        prefetch_etf_names(tickers)

    def _fetch_one(ticker: str) -> list[dict[str, str]]:
        if universe == "etf":
            return fetch_etf_news(ticker, limit=limit)
        return fetch_ticker_news(ticker, limit=limit)

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


def format_news_messages(
    tickers: list[str],
    context_label: str = "",
    limit: int = DEFAULT_HEADLINES_PER_TICKER,
    *,
    universe: str | None = None,
) -> list[str]:
    if not tickers:
        return ["No tickers to look up. Run /etf, /sp, or /nas first."]

    news_by_ticker = fetch_news_for_tickers(tickers, limit=limit, universe=universe)
    lines = ["News headlines for last ranking"]
    if context_label:
        lines.append(f"Context: {context_label}")
    lines.append(f"Tickers: {', '.join(_display_ticker_label(t, universe) for t in tickers)}")
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
