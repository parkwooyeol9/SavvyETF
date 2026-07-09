"""Trending market news discovery + full-article read + Gemini Korean brief."""

from __future__ import annotations

import json
import os
import re
import time
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import requests
import yfinance as yf
from lxml import html as lxml_html

GEMINI_API_ROOT = "https://generativelanguage.googleapis.com/v1beta/models"
DEFAULT_GEMINI_MODEL = "gemini-2.5-flash"
DEFAULT_ARTICLE_COUNT = 8
MIN_ARTICLE_COUNT = 5
MAX_ARTICLE_COUNT = 10
MAX_BODY_CHARS = 2800
MAX_TOTAL_CONTEXT_CHARS = 22000
FETCH_WORKERS = 6
REQUEST_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    )
}

YAHOO_DISCOVERY_TICKERS = ("SPY", "QQQ", "^GSPC", "AAPL", "MSFT", "NVDA", "TSLA", "AMD")
GOOGLE_NEWS_QUERIES = (
    "US stock market",
    "S&P 500 Federal Reserve",
    "Wall Street earnings economy",
)


@dataclass
class NewsArticle:
    title: str
    source: str
    url: str
    published: str
    snippet: str = ""
    body: str = ""
    score: float = 0.0
    discovered_via: str = ""

    def to_dict(self) -> dict[str, str]:
        return {
            "title": self.title,
            "source": self.source,
            "url": self.url,
            "published": self.published,
            "snippet": self.snippet,
        }


def _load_dotenv() -> None:
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).resolve().parent / ".env", override=False)


def _gemini_api_key() -> str:
    return os.environ.get("GEMINI_API_KEY", "").strip() or os.environ.get("GOOGLE_API_KEY", "").strip()


def _gemini_model() -> str:
    return os.environ.get("GEMINI_MODEL", DEFAULT_GEMINI_MODEL).strip() or DEFAULT_GEMINI_MODEL


def _finnhub_api_key() -> str:
    return os.environ.get("FINNHUB_API_KEY", "").strip()


def _normalize_title(title: str) -> str:
    lowered = title.lower()
    return re.sub(r"[^a-z0-9]+", "", lowered)


def _extract_yahoo_url(content: dict) -> str:
    for key in ("canonicalUrl", "clickThroughUrl"):
        payload = content.get(key)
        if isinstance(payload, dict) and payload.get("url"):
            return str(payload["url"]).strip()
    for key in ("link", "url"):
        if content.get(key):
            return str(content[key]).strip()
    return ""


def _parse_yahoo_news_item(item: dict) -> NewsArticle | None:
    content = item.get("content") if isinstance(item.get("content"), dict) else item
    title = (content.get("title") or item.get("title") or "").strip()
    if not title:
        return None

    provider = content.get("provider")
    if isinstance(provider, dict):
        source = provider.get("displayName") or provider.get("name") or "Yahoo Finance"
    else:
        source = item.get("publisher") or "Yahoo Finance"

    pub_raw = content.get("pubDate") or item.get("providerPublishTime")
    if isinstance(pub_raw, (int, float)):
        published = time.strftime("%Y-%m-%d %H:%M", time.localtime(pub_raw))
        pub_score = float(pub_raw)
    elif isinstance(pub_raw, str) and len(pub_raw) >= 10:
        published = pub_raw[:16].replace("T", " ")
        pub_score = time.time()
    else:
        published = "N/A"
        pub_score = 0.0

    snippet = (content.get("summary") or content.get("description") or content.get("storyline") or "").strip()
    url = _extract_yahoo_url(content)
    if not url:
        return None

    return NewsArticle(
        title=title,
        source=str(source),
        url=url,
        published=published,
        snippet=snippet,
        score=pub_score,
        discovered_via="yahoo",
    )


def _discover_yahoo_articles(per_ticker: int = 4) -> list[NewsArticle]:
    articles: list[NewsArticle] = []
    for ticker in YAHOO_DISCOVERY_TICKERS:
        try:
            raw_news = yf.Ticker(ticker).news or []
        except Exception:
            continue
        for item in raw_news[:per_ticker]:
            parsed = _parse_yahoo_news_item(item)
            if parsed:
                parsed.discovered_via = f"yahoo:{ticker}"
                articles.append(parsed)
    return articles


def _discover_google_news_rss(query: str, limit: int = 8) -> list[NewsArticle]:
    url = (
        "https://news.google.com/rss/search"
        f"?q={requests.utils.quote(query)}&hl=en-US&gl=US&ceid=US:en"
    )
    try:
        response = requests.get(url, headers=REQUEST_HEADERS, timeout=20)
        response.raise_for_status()
    except Exception:
        return []

    articles: list[NewsArticle] = []
    try:
        root = ET.fromstring(response.content)
    except ET.ParseError:
        return []

    for item in root.findall(".//item")[:limit]:
        title = (item.findtext("title") or "").strip()
        link = (item.findtext("link") or "").strip()
        pub_date = (item.findtext("pubDate") or "").strip()
        snippet = (item.findtext("description") or "").strip()
        snippet = re.sub(r"<[^>]+>", "", snippet)
        if not title or not link:
            continue
        source = "Google News"
        if " - " in title:
            maybe_title, maybe_source = title.rsplit(" - ", 1)
            if len(maybe_source) < 40:
                title = maybe_title.strip()
                source = maybe_source.strip()
        articles.append(
            NewsArticle(
                title=title,
                source=source,
                url=link,
                published=pub_date[:16] if pub_date else "N/A",
                snippet=snippet,
                score=time.time(),
                discovered_via=f"google:{query}",
            )
        )
    return articles


def _discover_finnhub_articles(limit: int = 12) -> list[NewsArticle]:
    api_key = _finnhub_api_key()
    if not api_key:
        return []
    try:
        response = requests.get(
            "https://finnhub.io/api/v1/news",
            params={"category": "general", "token": api_key},
            timeout=20,
        )
        response.raise_for_status()
        payload = response.json()
    except Exception:
        return []

    articles: list[NewsArticle] = []
    for item in payload[:limit]:
        title = (item.get("headline") or "").strip()
        url = (item.get("url") or "").strip()
        if not title or not url:
            continue
        ts = item.get("datetime")
        if isinstance(ts, (int, float)):
            published = datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d %H:%M")
            score = float(ts)
        else:
            published = "N/A"
            score = 0.0
        articles.append(
            NewsArticle(
                title=title,
                source=str(item.get("source") or "Finnhub"),
                url=url,
                published=published,
                snippet=str(item.get("summary") or "").strip(),
                score=score,
                discovered_via="finnhub",
            )
        )
    return articles


def _rank_and_dedupe(candidates: list[NewsArticle], limit: int) -> list[NewsArticle]:
    title_hits: dict[str, int] = {}
    for article in candidates:
        norm = _normalize_title(article.title)
        if norm:
            title_hits[norm] = title_hits.get(norm, 0) + 1

    best_by_title: dict[str, NewsArticle] = {}
    for article in candidates:
        norm = _normalize_title(article.title)
        if not norm:
            continue

        score = article.score
        if article.discovered_via.startswith("google"):
            score += 1_000_000
        if article.discovered_via.startswith("finnhub"):
            score += 500_000
        score += title_hits.get(norm, 1) * 10_000

        host = urlparse(article.url).netloc.lower()
        if any(domain in host for domain in ("reuters", "bloomberg", "wsj", "cnbc", "ft.com", "marketwatch")):
            score += 5_000

        ranked = NewsArticle(
            title=article.title,
            source=article.source,
            url=article.url,
            published=article.published,
            snippet=article.snippet,
            score=score,
            discovered_via=article.discovered_via,
        )
        current = best_by_title.get(norm)
        if current is None or ranked.score > current.score:
            best_by_title[norm] = ranked

    unique = list(best_by_title.values())
    unique.sort(key=lambda item: item.score, reverse=True)
    return unique[:limit]


def discover_trending_articles(limit: int = DEFAULT_ARTICLE_COUNT) -> list[NewsArticle]:
    limit = max(MIN_ARTICLE_COUNT, min(MAX_ARTICLE_COUNT, limit))
    candidates: list[NewsArticle] = []
    candidates.extend(_discover_finnhub_articles(limit=limit * 2))
    for query in GOOGLE_NEWS_QUERIES:
        candidates.extend(_discover_google_news_rss(query, limit=limit))
    candidates.extend(_discover_yahoo_articles(per_ticker=4))
    return _rank_and_dedupe(candidates, limit=limit)


def _extract_article_text(html_bytes: bytes) -> str:
    try:
        tree = lxml_html.fromstring(html_bytes)
    except Exception:
        return ""

    for xpath in (
        '//meta[@property="og:description"]/@content',
        '//meta[@name="description"]/@content',
    ):
        values = tree.xpath(xpath)
        if values and isinstance(values[0], str) and len(values[0]) > 80:
            return values[0].strip()[:MAX_BODY_CHARS]

    for bad in tree.xpath("//script|//style|//nav|//footer|//header|//aside"):
        parent = bad.getparent()
        if parent is not None:
            parent.remove(bad)

    paragraphs: list[str] = []
    for xpath in ("//article//p//text()", "//main//p//text()", "//div[contains(@class,'article')]//p//text()", "//p//text()"):
        for chunk in tree.xpath(xpath):
            text = " ".join(str(chunk).split())
            if len(text) >= 50:
                paragraphs.append(text)
        if paragraphs:
            break

    if not paragraphs:
        return ""

    body = "\n".join(paragraphs)
    return re.sub(r"\n{3,}", "\n\n", body).strip()[:MAX_BODY_CHARS]


def _fetch_article_body(article: NewsArticle) -> NewsArticle:
    if article.body:
        return article
    try:
        response = requests.get(article.url, headers=REQUEST_HEADERS, timeout=18, allow_redirects=True)
        response.raise_for_status()
        if "text/html" not in response.headers.get("Content-Type", "text/html"):
            raise RuntimeError("non-html response")
        body = _extract_article_text(response.content)
        if not body:
            body = article.snippet
    except Exception:
        body = article.snippet or article.title

    article.body = (body or article.title).strip()[:MAX_BODY_CHARS]
    return article


def fetch_article_bodies(articles: list[NewsArticle]) -> list[NewsArticle]:
    if not articles:
        return []

    results: list[NewsArticle] = []
    with ThreadPoolExecutor(max_workers=min(FETCH_WORKERS, len(articles))) as executor:
        futures = {executor.submit(_fetch_article_body, article): article for article in articles}
        for future in as_completed(futures):
            try:
                results.append(future.result())
            except Exception:
                fallback = futures[future]
                fallback.body = (fallback.snippet or fallback.title)[:MAX_BODY_CHARS]
                results.append(fallback)

    with_body = [item for item in results if len(item.body or item.snippet) >= 40]
    if len(with_body) >= MIN_ARTICLE_COUNT:
        return with_body[: len(articles)]
    return results[: len(articles)]


def _parse_llm_json(text: str) -> dict[str, Any]:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    return json.loads(text)


def _call_gemini_text(prompt: str) -> dict[str, Any]:
    api_key = _gemini_api_key()
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY not set")

    url = f"{GEMINI_API_ROOT}/{_gemini_model()}:generateContent"
    response = requests.post(
        url,
        params={"key": api_key},
        json={
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {
                "temperature": 0.35,
                "responseMimeType": "application/json",
            },
        },
        timeout=90,
    )
    if not response.ok:
        raise RuntimeError(f"Gemini HTTP {response.status_code}: {response.text[:300]}")

    payload = response.json()
    candidates = payload.get("candidates") or []
    if not candidates:
        raise RuntimeError("Gemini returned no candidates")

    parts_out = candidates[0].get("content", {}).get("parts") or []
    text = "".join(part.get("text", "") for part in parts_out if part.get("text"))
    if not text:
        raise RuntimeError("Gemini returned empty text")
    return _parse_llm_json(text)


DISCLAIMER_PATTERNS = (
    "본 내용은 교육 목적",
    "투자 조언이 아님",
    "투자 조언이 아닌",
    "투자 권유가 아님",
    "투자 권유 아님",
    "참고용이며",
    "교육 목적으로 제공",
)


def _strip_disclaimer(brief: str) -> str:
    lines = [line.strip() for line in brief.split("\n") if line.strip()]
    while lines:
        last = lines[-1]
        if any(pattern in last for pattern in DISCLAIMER_PATTERNS):
            lines.pop()
        else:
            break
    return "\n".join(lines)


def _build_articles_context(articles: list[NewsArticle]) -> str:
    chunks: list[str] = []
    total = 0
    for idx, article in enumerate(articles, start=1):
        body = (article.body or article.snippet or article.title).strip()
        block = (
            f"Article {idx}\n"
            f"Title: {article.title}\n"
            f"Source: {article.source}\n"
            f"Published: {article.published}\n"
            f"URL: {article.url}\n"
            f"Body:\n{body}\n"
        )
        if total + len(block) > MAX_TOTAL_CONTEXT_CHARS:
            break
        chunks.append(block)
        total += len(block)
    return "\n---\n".join(chunks)


def _rule_based_brief(articles: list[NewsArticle]) -> str:
    if not articles:
        return (
            "오늘 수집 가능한 주요 시장 뉴스가 충분하지 않아 요약 품질이 제한됩니다.\n"
            "잠시 후 다시 시도하거나 주요 지수·금리·실적 헤드라인을 직접 확인해 주세요.\n"
            "단기 변동성이 큰 구간에서는 추격 매수보다 관망과 분할 접근이 유리할 수 있습니다."
        )

    themes: list[str] = []
    for article in articles[:6]:
        title = article.title
        if len(title) > 90:
            title = title[:87] + "..."
        themes.append(f"{title} ({article.source})")

    line1 = (
        "현재 시장 관심은 "
        + ", ".join(themes[:3])
        + " 등 주요 헤드라인에 집중되어 있습니다."
    )
    line2 = (
        "뉴스 흐름을 보면 지수·금리·지정학 이슈가 동시에 가격에 반영되며 "
        "섹터 간 온도 차가 크게 나타나는 모습입니다."
    )
    line3 = (
        "단기 모멘텀 추종보다는 핵심 이슈(금리, 실적, 정책)를 기준으로 "
        "관심 종목을 정리하고 변동성에 대비하는 접근이 필요해 보입니다."
    )
    return "\n".join([line1, line2, line3])


def summarize_articles_with_gemini(articles: list[NewsArticle]) -> dict[str, Any]:
    context = _build_articles_context(articles)
    prompt = f"""You are a financial market analyst writing for Korean retail investors.

Read ALL articles below (full bodies). They were selected as currently trending / high-traffic US market news.

Return JSON only:
{{
  "market_brief_ko": "Exactly 3-4 lines in Korean separated by \\n. Cover: (1) the dominant market narrative across articles, (2) key risks or catalysts investors should watch today, (3) a practical stance (patience, selectivity, risk control — NOT a buy/sell order). Do NOT add a legal disclaimer line."
}}

Rules:
- Write ALL text in Korean.
- Synthesize across articles; do not list headlines one by one.
- Be concrete; mention sectors, macro themes, or tickers when clearly supported by the articles.
- No markdown bullets.
- Do not end with disclaimer or investment-advice language.

ARTICLES:
{context}
"""

    parsed = _call_gemini_text(prompt)
    brief = _strip_disclaimer(str(parsed.get("market_brief_ko", "")).strip())
    if not brief:
        raise RuntimeError("Empty market_brief_ko from Gemini")
    return {
        "market_brief_ko": brief,
        "source": "gemini",
        "article_count": len(articles),
        "articles": [article.to_dict() for article in articles],
    }


def generate_ai_briefing(article_count: int = DEFAULT_ARTICLE_COUNT) -> dict[str, Any]:
    """Discover trending articles, read them, and produce a 3-4 line Korean brief."""
    _load_dotenv()
    discovered = discover_trending_articles(limit=article_count)
    if not discovered:
        return {
            "market_brief_ko": _strip_disclaimer(_rule_based_brief([])),
            "source": "rules",
            "article_count": 0,
            "articles": [],
            "error": "No trending articles found",
        }

    articles = fetch_article_bodies(discovered)
    try:
        if _gemini_api_key():
            return summarize_articles_with_gemini(articles)
    except Exception as exc:
        fallback = {
            "market_brief_ko": _strip_disclaimer(_rule_based_brief(articles)),
            "source": "rules",
            "article_count": len(articles),
            "articles": [article.to_dict() for article in articles],
            "error": str(exc),
        }
        return fallback

    return {
        "market_brief_ko": _strip_disclaimer(_rule_based_brief(articles)),
        "source": "rules",
        "article_count": len(articles),
        "articles": [article.to_dict() for article in articles],
    }


def format_ai_briefing_telegram(briefing: dict[str, Any], include_sources: bool = True) -> list[dict]:
    brief_ko = _strip_disclaimer(str(briefing.get("market_brief_ko", "")).strip())
    if not brief_ko:
        return [{"text": "AI briefing unavailable (empty result)."}]

    source = briefing.get("source", "rules")
    article_count = briefing.get("article_count", 0)
    header = "🤖 AI 시장 브리핑 (한국어)\n"
    if briefing.get("error") and source == "rules":
        header += "(Gemini unavailable — headline-based fallback)\n"
    header += f"출처: {source} | 분석 기사 {article_count}건\n\n"
    messages = [{"text": header + brief_ko}]

    if include_sources:
        articles = briefing.get("articles") or []
        if articles:
            lines = ["📰 참고 기사", ""]
            for idx, item in enumerate(articles[:10], start=1):
                title = item.get("title", "")
                src = item.get("source", "")
                lines.append(f"{idx}. {title}")
                lines.append(f"   {src}")
            messages.append({"text": "\n".join(lines)})
    return messages
