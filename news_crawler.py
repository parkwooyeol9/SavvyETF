import contextlib
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime

import yfinance as yf

DEFAULT_HEADLINES_PER_TICKER = 3
MAX_MESSAGE_LENGTH = 3900
MAX_WORKERS = 6


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
) -> dict[str, list[dict[str, str]]]:
    results: dict[str, list[dict[str, str]]] = {}
    if not tickers:
        return results

    with ThreadPoolExecutor(max_workers=min(MAX_WORKERS, len(tickers))) as executor:
        futures = {executor.submit(fetch_ticker_news, ticker, limit): ticker for ticker in tickers}
        for future in as_completed(futures):
            ticker = futures[future]
            try:
                results[ticker] = future.result()
            except Exception:
                results[ticker] = []
    return results


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
) -> list[str]:
    if not tickers:
        return ["No tickers to look up. Run /etf, /sp, or /nas first."]

    news_by_ticker = fetch_news_for_tickers(tickers, limit=limit)
    lines = ["News headlines for last ranking"]
    if context_label:
        lines.append(f"Context: {context_label}")
    lines.append(f"Tickers: {', '.join(tickers)}")
    lines.append("")

    for ticker in tickers:
        headlines = news_by_ticker.get(ticker, [])
        lines.append(f"[{ticker}]")
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
