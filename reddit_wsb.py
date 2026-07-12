"""r/wallstreetbets hot-topic crawl + Gemini Korean investor summary (/reddit)."""

from __future__ import annotations

import html
import os
import re
import time
import xml.etree.ElementTree as ET
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urljoin

import requests

SUBREDDIT = "wallstreetbets"
DEFAULT_LIMIT = 20
MAX_POSTS_IN_PROMPT = 15
MAX_SELFTEXT_CHARS = 500
MAX_TELEGRAM_POSTS = 12
TICKER_RE = re.compile(r"(?<![A-Z0-9])\$([A-Z]{1,5})\b")
KNOWN_TICKERS = {
    "AAPL",
    "AMD",
    "AMZN",
    "ARM",
    "AVGO",
    "BABA",
    "COIN",
    "COST",
    "CRWD",
    "DIS",
    "GOOG",
    "GOOGL",
    "GS",
    "HOOD",
    "IBM",
    "INTC",
    "IWM",
    "JNJ",
    "JPM",
    "LLY",
    "META",
    "MSFT",
    "MSTR",
    "MU",
    "NFLX",
    "NVDA",
    "PLTR",
    "QCOM",
    "QQQ",
    "RIVN",
    "SMCI",
    "SOFI",
    "SOXL",
    "SPX",
    "SPY",
    "TQQQ",
    "TSLA",
    "UBER",
    "V",
    "XOM",
}
MEGA_THREAD_RE = re.compile(
    r"(daily discussion|weekend discussion|what are your moves|daily outlook|"
    r"weekly earnings thread)",
    re.I,
)

USER_AGENT = (
    "SavvyETF/1.0 (telegram-bot; +https://github.com/parkwooyeol9/SavvyETF; by parkwooyeol9)"
)
ATOM_NS = {"a": "http://www.w3.org/2005/Atom"}
GEMINI_API_ROOT = "https://generativelanguage.googleapis.com/v1beta/models"
DEFAULT_GEMINI_MODEL = "gemini-2.5-flash"


@dataclass
class WsbPost:
    id: str
    title: str
    author: str
    url: str
    permalink: str
    created_utc: float = 0.0
    score: int | None = None
    num_comments: int | None = None
    flair: str = ""
    selftext: str = ""
    source: str = ""
    tickers: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _load_dotenv() -> None:
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).resolve().parent / ".env", override=False)


def _gemini_api_key() -> str:
    return (
        os.environ.get("GEMINI_API_KEY", "").strip()
        or os.environ.get("GOOGLE_API_KEY", "").strip()
    )


def _gemini_model() -> str:
    return os.environ.get("GEMINI_MODEL", DEFAULT_GEMINI_MODEL).strip() or DEFAULT_GEMINI_MODEL


def _session() -> requests.Session:
    session = requests.Session()
    session.headers.update(
        {
            "User-Agent": USER_AGENT,
            "Accept": "application/json, application/atom+xml, text/xml, */*",
        }
    )
    return session


def _strip_html(raw: str) -> str:
    text = re.sub(r"(?is)<!--.*?-->", " ", raw or "")
    text = re.sub(r"(?is)<script.*?>.*?</script>", " ", text)
    text = re.sub(r"(?is)<style.*?>.*?</style>", " ", text)
    text = re.sub(r"(?is)<br\s*/?>", "\n", text)
    text = re.sub(r"(?is)</p>", "\n", text)
    text = re.sub(r"(?is)<[^>]+>", " ", text)
    text = html.unescape(text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _extract_tickers(*texts: str) -> list[str]:
    found: list[str] = []
    for text in texts:
        if not text:
            continue
        upper = text.upper()
        for match in TICKER_RE.findall(upper):
            if match not in found:
                found.append(match)
        for ticker in KNOWN_TICKERS:
            if ticker in found:
                continue
            if re.search(rf"(?<![A-Z0-9]){re.escape(ticker)}(?![A-Z0-9])", upper):
                found.append(ticker)
    return found[:12]


def _is_mega_thread(title: str) -> bool:
    return bool(MEGA_THREAD_RE.search(title or ""))


def _request_with_retries(
    session: requests.Session,
    url: str,
    *,
    params: dict | None = None,
    headers: dict | None = None,
    timeout: float = 30,
    attempts: int = 3,
) -> requests.Response:
    last: requests.Response | None = None
    for attempt in range(attempts):
        response = session.get(url, params=params, headers=headers or {}, timeout=timeout)
        last = response
        if response.status_code != 429:
            return response
        retry_after = response.headers.get("Retry-After") or response.headers.get(
            "x-ratelimit-reset"
        )
        try:
            sleep_s = max(2, min(60, int(float(retry_after))))
        except (TypeError, ValueError):
            sleep_s = 3 + attempt * 4
        time.sleep(sleep_s)
    assert last is not None
    return last


def _oauth_token(session: requests.Session) -> str | None:
    client_id = os.environ.get("REDDIT_CLIENT_ID", "").strip()
    client_secret = os.environ.get("REDDIT_CLIENT_SECRET", "").strip()
    if not client_id or not client_secret:
        return None
    response = session.post(
        "https://www.reddit.com/api/v1/access_token",
        data={"grant_type": "client_credentials"},
        auth=(client_id, client_secret),
        timeout=30,
    )
    if not response.ok:
        return None
    return (response.json() or {}).get("access_token")


def _posts_from_listing(payload: dict[str, Any], *, source: str) -> list[WsbPost]:
    posts: list[WsbPost] = []
    children = ((payload.get("data") or {}).get("children")) or []
    for child in children:
        data = child.get("data") if isinstance(child, dict) else None
        if not isinstance(data, dict):
            continue
        if data.get("stickied") and _is_mega_thread(str(data.get("title") or "")):
            # Keep stickied mega-threads out of the "hot topics" ranking list.
            continue
        title = str(data.get("title") or "").strip()
        if not title:
            continue
        permalink = str(data.get("permalink") or "").strip()
        url = str(data.get("url") or "").strip()
        if permalink:
            permalink = urljoin("https://www.reddit.com", permalink)
        selftext = str(data.get("selftext") or "").strip()[:MAX_SELFTEXT_CHARS]
        post = WsbPost(
            id=str(data.get("id") or ""),
            title=title,
            author=str(data.get("author") or "[deleted]"),
            url=url or permalink,
            permalink=permalink or url,
            created_utc=float(data.get("created_utc") or 0),
            score=int(data["score"]) if data.get("score") is not None else None,
            num_comments=(
                int(data["num_comments"]) if data.get("num_comments") is not None else None
            ),
            flair=str(data.get("link_flair_text") or "").strip(),
            selftext=selftext,
            source=source,
        )
        post.tickers = _extract_tickers(post.title, post.selftext, post.flair)
        posts.append(post)
    return posts


def fetch_wsb_json(limit: int = DEFAULT_LIMIT) -> list[WsbPost]:
    session = _session()
    token = _oauth_token(session)
    headers = {}
    if token:
        base = "https://oauth.reddit.com"
        headers["Authorization"] = f"Bearer {token}"
    else:
        base = "https://www.reddit.com"

    url = f"{base}/r/{SUBREDDIT}/hot.json"
    response = _request_with_retries(
        session,
        url,
        params={"limit": min(max(limit, 5), 50), "raw_json": 1},
        headers=headers,
        timeout=30,
    )
    if response.status_code != 200:
        raise RuntimeError(f"Reddit JSON HTTP {response.status_code}")
    content_type = response.headers.get("Content-Type", "")
    if "json" not in content_type and not response.text.lstrip().startswith("{"):
        raise RuntimeError("Reddit JSON blocked (non-JSON response)")
    return _posts_from_listing(response.json(), source="json" if not token else "oauth")


def fetch_wsb_rss(limit: int = DEFAULT_LIMIT) -> list[WsbPost]:
    session = _session()
    response = _request_with_retries(
        session,
        f"https://www.reddit.com/r/{SUBREDDIT}/.rss",
        params={"limit": min(max(limit, 5), 50)},
        timeout=30,
    )
    if response.status_code != 200:
        raise RuntimeError(f"Reddit RSS HTTP {response.status_code}")
    root = ET.fromstring(response.content)
    posts: list[WsbPost] = []
    for entry in root.findall("a:entry", ATOM_NS):
        title = (entry.findtext("a:title", default="", namespaces=ATOM_NS) or "").strip()
        if not title:
            continue
        if _is_mega_thread(title):
            continue
        href = ""
        for link in entry.findall("a:link", ATOM_NS):
            if link.get("href") and link.get("rel") in (None, "alternate"):
                href = link.get("href") or ""
                break
        author = (
            entry.findtext("a:author/a:name", default="", namespaces=ATOM_NS) or ""
        ).strip()
        updated = entry.findtext("a:updated", default="", namespaces=ATOM_NS) or ""
        created = 0.0
        if updated:
            try:
                created = datetime.fromisoformat(updated.replace("Z", "+00:00")).timestamp()
            except ValueError:
                created = 0.0
        content_html = entry.findtext("a:content", default="", namespaces=ATOM_NS) or ""
        selftext = _strip_html(content_html)
        selftext = re.sub(
            r"submitted by\s+/u/\S+.*$",
            "",
            selftext,
            flags=re.I | re.S,
        ).strip()[:MAX_SELFTEXT_CHARS]
        post_id = ""
        if "/comments/" in href:
            parts = href.rstrip("/").split("/")
            try:
                post_id = parts[parts.index("comments") + 1]
            except (ValueError, IndexError):
                post_id = ""
        post = WsbPost(
            id=post_id,
            title=title,
            author=author or "[unknown]",
            url=href,
            permalink=href,
            created_utc=created,
            selftext=selftext,
            source="rss",
        )
        post.tickers = _extract_tickers(post.title, post.selftext)
        posts.append(post)
        if len(posts) >= limit:
            break
    return posts


def fetch_wsb_hot_posts(limit: int = DEFAULT_LIMIT) -> tuple[list[WsbPost], str]:
    errors: list[str] = []
    for fetcher, name in (
        (fetch_wsb_json, "json"),
        (fetch_wsb_rss, "rss"),
    ):
        try:
            posts = fetcher(limit=limit)
            if posts:
                return posts, name
            errors.append(f"{name}: empty")
        except Exception as exc:
            errors.append(f"{name}: {exc}")
    raise RuntimeError("WSB crawl failed (" + "; ".join(errors) + ")")


def aggregate_ticker_mentions(posts: list[WsbPost]) -> list[tuple[str, int]]:
    counts: dict[str, int] = {}
    for post in posts:
        for ticker in post.tickers:
            counts[ticker] = counts.get(ticker, 0) + 1
    return sorted(counts.items(), key=lambda item: (-item[1], item[0]))


def _parse_llm_json(text: str) -> dict[str, Any]:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    import json

    return json.loads(text)


def _call_gemini_json(prompt: str) -> dict[str, Any]:
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
    parts = candidates[0].get("content", {}).get("parts") or []
    text = "".join(part.get("text", "") for part in parts if part.get("text"))
    if not text:
        raise RuntimeError("Gemini returned empty text")
    return _parse_llm_json(text)


def _build_posts_context(posts: list[WsbPost]) -> str:
    chunks: list[str] = []
    for idx, post in enumerate(posts[:MAX_POSTS_IN_PROMPT], start=1):
        meta = []
        if post.score is not None:
            meta.append(f"score={post.score}")
        if post.num_comments is not None:
            meta.append(f"comments={post.num_comments}")
        if post.flair:
            meta.append(f"flair={post.flair}")
        if post.tickers:
            meta.append("tickers=" + ",".join(post.tickers))
        meta_line = f" ({', '.join(meta)})" if meta else ""
        body = post.selftext.strip() or "(link/title only)"
        chunks.append(
            f"Post {idx}{meta_line}\n"
            f"Title: {post.title}\n"
            f"Author: {post.author}\n"
            f"URL: {post.permalink or post.url}\n"
            f"Body: {body}\n"
        )
    return "\n---\n".join(chunks)


def _rule_based_summary(posts: list[WsbPost], tickers: list[tuple[str, int]]) -> str:
    if not posts:
        return (
            "지금 r/wallstreetbets에서 수집된 핫 포스트가 부족합니다.\n"
            "잠시 후 다시 시도해 주세요."
        )
    titles = [post.title for post in posts[:3]]
    ticker_bit = ", ".join(t for t, _ in tickers[:5]) or "특정 티커보다 매크로·이슈 중심"
    return "\n".join(
        [
            f"현재 WSB 관심은 '{titles[0]}' 등 상위 포스트에 몰려 있습니다.",
            f"언급 빈도가 높은 티커/테마: {ticker_bit}.",
            "커뮤니티 톤은 단기 방향성·이벤트 드리븐 베팅 비중이 커서 추격보다 테마 확인이 우선입니다.",
        ]
    )


def summarize_wsb_with_gemini(
    posts: list[WsbPost],
    tickers: list[tuple[str, int]],
) -> dict[str, Any]:
    ticker_line = ", ".join(f"{t}({n})" for t, n in tickers[:10]) or "(none)"
    prompt = f"""You are a markets analyst summarizing r/wallstreetbets for Korean retail investors.

Read the hot posts below and synthesize what investors are currently focused on.

Return JSON only:
{{
  "themes_ko": ["3-5 short Korean theme labels"],
  "investor_focus_ko": "2-3 Korean sentences on what WSB investors care about right now (tickers, macro, earnings, geopolitics, memes — only if evidenced).",
  "ai_summary_ko": "Exactly 3-4 Korean lines separated by \\n. Cover: (1) dominant narrative, (2) tickers/themes with heat, (3) practical caution (not a buy/sell call). No disclaimer line."
}}

Rules:
- Write ALL text in Korean.
- Be concrete; mention tickers only when supported by posts.
- Treat WSB as noisy retail sentiment, not institutional research.
- No markdown bullets inside string fields.

Mentioned tickers (count): {ticker_line}

POSTS:
{_build_posts_context(posts)}
"""
    parsed = _call_gemini_json(prompt)
    themes = parsed.get("themes_ko") or []
    if not isinstance(themes, list):
        themes = []
    themes = [str(item).strip() for item in themes if str(item).strip()][:5]
    focus = str(parsed.get("investor_focus_ko") or "").strip()
    summary = str(parsed.get("ai_summary_ko") or "").strip()
    if not summary:
        raise RuntimeError("Gemini returned empty ai_summary_ko")
    return {
        "themes_ko": themes,
        "investor_focus_ko": focus,
        "ai_summary_ko": summary,
        "source": "gemini",
    }


def generate_reddit_brief(limit: int = DEFAULT_LIMIT) -> dict[str, Any]:
    _load_dotenv()
    posts, crawl_source = fetch_wsb_hot_posts(limit=limit)
    # Prefer non-mega threads already filtered; keep score order when available.
    ranked = sorted(
        posts,
        key=lambda p: (
            p.score is not None,
            p.score or 0,
            p.num_comments or 0,
            p.created_utc,
        ),
        reverse=True,
    )
    tickers = aggregate_ticker_mentions(ranked)
    generated_at = datetime.now(timezone.utc).astimezone().strftime("%Y-%m-%d %H:%M %Z")

    ai_pack: dict[str, Any]
    try:
        if _gemini_api_key():
            ai_pack = summarize_wsb_with_gemini(ranked, tickers)
        else:
            ai_pack = {
                "themes_ko": [],
                "investor_focus_ko": "",
                "ai_summary_ko": _rule_based_summary(ranked, tickers),
                "source": "rules",
                "error": "GEMINI_API_KEY not set",
            }
    except Exception as exc:
        ai_pack = {
            "themes_ko": [],
            "investor_focus_ko": "",
            "ai_summary_ko": _rule_based_summary(ranked, tickers),
            "source": "rules",
            "error": str(exc),
        }

    return {
        "subreddit": SUBREDDIT,
        "generated_at_display": generated_at,
        "crawl_source": crawl_source,
        "posts": [post.to_dict() for post in ranked],
        "tickers": tickers,
        "ai": ai_pack,
        "fetched_at": time.time(),
    }


def format_reddit_telegram(brief: dict[str, Any]) -> list[dict]:
    posts = brief.get("posts") or []
    tickers = brief.get("tickers") or []
    ai = brief.get("ai") or {}
    crawl = brief.get("crawl_source", "?")

    header = [
        "🟠 r/wallstreetbets 핫 토픽",
        f"{brief.get('generated_at_display', '')} · source={crawl}",
        "",
    ]
    if not posts:
        return [{"text": "\n".join(header + ["수집된 포스트가 없습니다."])}]

    lines = header + ["📌 주요 게시글", ""]
    for idx, post in enumerate(posts[:MAX_TELEGRAM_POSTS], start=1):
        title = str(post.get("title") or "").strip()
        if len(title) > 110:
            title = title[:107] + "..."
        meta_bits: list[str] = []
        if post.get("flair"):
            meta_bits.append(str(post["flair"]))
        if post.get("score") is not None:
            meta_bits.append(f"▲{post['score']}")
        if post.get("num_comments") is not None:
            meta_bits.append(f"💬{post['num_comments']}")
        meta = f" ({', '.join(meta_bits)})" if meta_bits else ""
        lines.append(f"{idx}. {title}{meta}")
        tick = post.get("tickers") or []
        if tick:
            lines.append("   $" + " $".join(tick[:5]))
    messages = [{"text": "\n".join(lines)}]

    interest_lines = ["👀 투자자 관심 티커", ""]
    if tickers:
        interest_lines.append(
            " · ".join(f"${t}×{n}" for t, n in tickers[:10])
        )
    else:
        interest_lines.append("(티커 언급이 적거나 매크로/이슈 중심)")
    themes = ai.get("themes_ko") or []
    if themes:
        interest_lines.extend(["", "키워드: " + " · ".join(str(t) for t in themes)])
    focus = str(ai.get("investor_focus_ko") or "").strip()
    if focus:
        interest_lines.extend(["", focus])
    messages.append({"text": "\n".join(interest_lines)})

    summary = str(ai.get("ai_summary_ko") or "").strip()
    ai_lines = ["🤖 Gemini WSB 요약", ""]
    source = ai.get("source", "rules")
    if ai.get("error") and source == "rules":
        ai_lines.append("(Gemini unavailable — fallback summary)")
        ai_lines.append("")
    ai_lines.append(summary or "(요약 없음)")
    messages.append({"text": "\n".join(ai_lines)})
    return messages
