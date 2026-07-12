import html
import json
import os
import re
import sys
import threading
import time
from concurrent.futures import Future, ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import requests
from dotenv import load_dotenv

from etf_compare import parse_comp_tickers
from news_crawler import format_news_messages
from naver_news import format_naver_news_messages
from stock_crawler import (
    ensure_universe_caches,
    format_rankings_message,
    get_ranking_tickers,
    get_top_leader_ticker,
    get_warmup_status,
    is_cache_ready,
    is_cache_warmup_running,
    parse_rank_command,
    start_cache_watchdog,
    start_universe_cache_warmup,
    warmup_all_caches,
    warmup_deferred_caches,
    warmup_startup_caches,
)
from reddit_scheduler import start_reddit_scheduler
from summary_kor_intra_scheduler import start_summary_kor_intra_scheduler
from summary_kor_scheduler import start_summary_kor_scheduler
from summary_scheduler import start_summary_scheduler
from scheduler_grace import mark_service_started

PROJECT_DIR = Path(__file__).resolve().parent
WEB_DIR = PROJECT_DIR / "web"
ENV_FILE = PROJECT_DIR / ".env"
KNOWN_CHATS_FILE = PROJECT_DIR / "data" / "known_chats.json"
BLOCKED_CHATS_FILE = PROJECT_DIR / "data" / "blocked_chats.json"
load_dotenv(ENV_FILE)

STARTUP_TEXT = """SavvyETF Bot is online.

What each command returns:

/port AAPL MSFT GOOGL
→ Portfolio backtest chart + technical chart per stock

/coin BTC
→ Crypto technical analysis chart

/etf
→ Top 3 price-up+volume surge & top 3 price-down+volume surge ETFs

/sp   (or /nas)
→ Same rankings for S&P 500 / NASDAQ 100

/kospi  (or /kosdaq)
→ Same rankings for KOSPI 200 / KOSDAQ 100

/etf_pre  /sp_pre  /nas_pre
→ Pre-market % vs previous close

/heatmap sp
→ Treemap of top names by market cap (color = daily return)

/macro
→ Macro risk monitor: chart, metrics, Finnhub/EDGAR, AI macro risk comment

/news
→ Headlines for the 6 tickers from your last /etf, /sp, or /nas result

/news_naver
→ Naver News headlines for last ranking (or /news_naver 삼성전자)

/summary
→ ETF + S&P 500 brief, heatmap, AI briefing (scheduled 06:30 KST)

/summary_pre
→ Premarket brief: /sp_pre only (ETF excluded); PDF + 21:50 KST schedule

/summary_kor
→ KOSPI 200 + KOSDAQ 100 brief (Yahoo .KS/.KQ) + Naver News + DART + PDF/web

/summary_kor_intra
→ Same as /summary_kor using mid-session Yahoo returns (auto 11:00 & 15:00 KST)

/aibriefing
→ Trending market news (5-10 articles) read + Korean AI brief (3-4 lines)

/reddit
→ WSB hot topics + Gemini KR + /financial for top 2 tickers (web + PDF)

/adr TSM ASML ARM
→ ADR listing impact analysis (charts + Excel) for underlying shares

/idx
→ MSCI ACWI/World/EM country top5 → major markets index/futures/FX returns

/comp QQQ IVV QNDX
→ ETF charts, metrics, AI pick, Excel workbook

/financial AAPL
→ S&P 500 fundamental analysis: PER, PBR, ROE, margins, EPS growth + charts

/dart 삼성전자
→ 한국 상장사 DART 재무분석: 매출·이익·ROE·성장률 + 차트

/dart etf memb 0167A0
→ 국내 ETF 편입종목·구성비(Naver) + DART 펀드공시(리밸/변경) 파싱

Auto schedule (KST):
  /summary 06:30 · /summary_pre 21:50
  /summary_kor_intra 11:00 / 15:00 (weekdays)
  /summary_kor 15:40 (weekdays)
  /reddit 17:00 / 19:00 / 21:00

Type /help for the full command list.
"""

HELP_TEXT = """SavvyETF Bot — Commands

⏱ Auto schedule (KST)
  /summary           06:30  — post-close market brief (skip weekend/US holiday)
  /summary_pre       21:50  — premarket brief (/sp_pre only)
  /summary_kor_intra 11:00, 15:00 — Korea intraday rankings (weekdays)
  /summary_kor       15:40  — Korea EOD brief after close (weekdays)
  /reddit            17:00, 19:00, 21:00 — WSB + Gemini KR + financial top-2

/port TICKER1 TICKER2 ...
  Portfolio backtest + TA chart per ticker.
  Example: /port AAPL MSFT GOOGL

/coin SYMBOL
  Crypto technical analysis chart.
  Example: /coin BTC

/heatmap [etf|sp|nas] [N]
  Finviz-style treemap: tile size = market cap (or ETF AUM),
  color = last trading day return. Default: top 30 names.
  Example: /heatmap sp | /heatmap nas 20 | /heatmap etf 30

/macro
  Macro risk monitor: chart dashboard, yield/credit/vol metrics,
  Finnhub/EDGAR pulse, and AI Korean macro risk comment.
  Manual only (no auto schedule).
  Example: /macro | /macro refresh

/news
  Headlines for the 6 tickers from your last ranking.
  Run /etf, /sp, or /nas first, then /news.

/news_naver [query]
  Naver News crawl for Korean headlines.
  Without args: uses tickers from your last ranking (/kospi, /kosdaq, …).
  With query: /news_naver 삼성전자

/summary
  Full market brief: ETF + S&P 500 (top 3 per board, charts, news),
  S&P 500 heatmap, then AI briefing from trending news at the end.
  Web page: SUMMARY_PUBLIC_URL/summary · PDF: /summary.pdf
  Requires GEMINI_API_KEY for full AI briefing (headline fallback if unset).

/summary_pre
  Premarket brief: S&P 500 via /sp_pre only (ETF excluded).
  Includes premarket rankings, news, leader TA chart, and PDF (/summary_pre.pdf).
  Requires FINNHUB_API_KEY.
  Example: /summary_pre

/summary_kor
  Korea market brief: KOSPI 200 + KOSDAQ 100 rankings, leader charts,
  Naver Korean headlines, DART financials for top leaders, PDF + web.
  Prices: Yahoo Finance (.KS / .KQ). News: Naver crawl. Financials: Open DART.
  Auto weekdays 15:40 KST (after market close).
  Web: /summary_kor · PDF: /summary_kor.pdf (separate from US /summary)
  Example: /summary_kor | /kospi | /kosdaq

/summary_kor_intra
  Same as /summary_kor but force-refreshes Yahoo for mid-session returns
  (vs previous close). Auto weekdays 11:00 and 15:00 KST.
  Web: /summary_kor_intra · PDF: /summary_kor_intra.pdf
  Example: /summary_kor_intra

/aibriefing
  Search 5-10 trending US market articles, read them, and return a
  3-4 line Korean AI market brief. Aliases: /ai_briefing, /ai briefing
  Example: /aibriefing
  Requires GEMINI_API_KEY for full analysis.

/reddit
  Crawl r/wallstreetbets hot posts, Gemini Korean summary, then /financial
  analysis (charts + metrics) for the top 2 mentioned equity tickers.
  Web: /reddit · PDF: /reddit.pdf
  Auto: 17:00, 19:00, 21:00 KST.
  Example: /reddit
  Requires GEMINI_API_KEY for AI summary (rule-based fallback if unset).
  Optional: REDDIT_CLIENT_ID + REDDIT_CLIENT_SECRET for OAuth JSON feed.

/adr ADR1 ADR2 ...
  Analyze whether US ADR listing impacted underlying home-market shares.
  Returns charts + an Excel workbook.
  Underlying history is merged across FinMind/EODHD/Finnhub/Stooq/Yahoo
  (±3y around listing) so pre-listing series is less Yahoo-limited.
  Example: /adr TSM ASML ARM

/idx
  MSCI ACWI / World / EM country weight top 5 (via iShares geographic breakdown),
  treat the union as major countries, map each to a representative cash index,
  then show latest daily index return, futures return (when available), and FX.
  Example: /idx

/comp ETF1 ETF2 ...
  Compare US ETFs with charts (performance, returns, cost, overlap),
  price history (index proxy if short history), AI Korean pick, Excel export.
  Example: /comp QQQ IVV QNDX | /comp SPY, VOO, IVV

/financial TICKER
  Fundamental analysis for S&P 500 stocks: PER, PBR, ROE, margins,
  EPS/revenue growth, and historical trend charts.
  Primary data: Finnhub (FINNHUB_API_KEY). Fallback: Yahoo Finance.
  Example: /financial AAPL | /financial MSFT

/dart COMPANY
  Korean listed company fundamentals from Open DART: revenue, operating/net income,
  assets, equity, EPS, margins, ROE, YoY growth, and trend charts.
  Example: /dart 삼성전자 | /dart SK하이닉스 | /dart 005930
  Requires DART_API_KEY in .env (https://opendart.fss.or.kr/)

/dart etf memb TICKER|NAME
  Korean ETF holdings (구성종목) and weights (편입비) via Naver Finance,
  change vs last snapshot, plus Open DART fund disclosures (투자설명서/
  기재정정 등) filtered to the ETF — parsed rebalance/change bullets + links.
  Example: /dart etf memb 0167A0
  Example: /dart etf memb SOL AI반도체TOP2플러스
  Requires DART_API_KEY for the disclosure section.

ℹ️ /help
  Show this guide again.
"""


def summary_public_url() -> str:
    from summary_builder import resolve_summary_public_url

    return resolve_summary_public_url()


def load_known_chats() -> set[int]:
    if not KNOWN_CHATS_FILE.exists():
        return set()
    try:
        with KNOWN_CHATS_FILE.open(encoding="utf-8") as handle:
            data = json.load(handle)
        return {int(chat_id) for chat_id in data}
    except (json.JSONDecodeError, TypeError, ValueError):
        return set()


def load_blocked_chats() -> set[int]:
    if not BLOCKED_CHATS_FILE.exists():
        return set()
    try:
        with BLOCKED_CHATS_FILE.open(encoding="utf-8") as handle:
            data = json.load(handle)
        return {int(chat_id) for chat_id in data}
    except (json.JSONDecodeError, TypeError, ValueError):
        return set()


def save_blocked_chats(chat_ids: set[int]) -> None:
    BLOCKED_CHATS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with BLOCKED_CHATS_FILE.open("w", encoding="utf-8") as handle:
        json.dump(sorted(chat_ids), handle)


def block_chat(chat_id: int, reason: str) -> None:
    blocked = load_blocked_chats()
    if chat_id in blocked:
        return
    blocked.add(chat_id)
    save_blocked_chats(blocked)
    remove_known_chat(chat_id)
    print(f"Chat {chat_id} removed from delivery list: {reason}")


def unblock_chat(chat_id: int) -> None:
    blocked = load_blocked_chats()
    if chat_id not in blocked:
        return
    blocked.remove(chat_id)
    save_blocked_chats(blocked)
    print(f"Chat {chat_id} unblocked for delivery")


def remove_known_chat(chat_id: int) -> None:
    chats = load_known_chats()
    if chat_id not in chats:
        return
    chats.remove(chat_id)
    KNOWN_CHATS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with KNOWN_CHATS_FILE.open("w", encoding="utf-8") as handle:
        json.dump(sorted(chats), handle)


def save_known_chat(chat_id: int) -> None:
    chats = load_known_chats()
    if chat_id in chats:
        return
    chats.add(chat_id)
    KNOWN_CHATS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with KNOWN_CHATS_FILE.open("w", encoding="utf-8") as handle:
        json.dump(sorted(chats), handle)


def startup_chat_ids() -> set[int]:
    chats = load_known_chats()
    for raw_id in os.environ.get("TELEGRAM_CHAT_ID", "").split(","):
        raw_id = raw_id.strip()
        if raw_id:
            chats.add(int(raw_id))
    return chats - load_blocked_chats()


def _telegram_error_description(response: requests.Response) -> str:
    try:
        payload = response.json()
        if isinstance(payload, dict):
            return str(payload.get("description", ""))
    except ValueError:
        pass
    return response.text


def _is_unreachable_chat_error(response: requests.Response) -> bool:
    if response.status_code in {403, 404}:
        return True
    if response.status_code == 400:
        description = _telegram_error_description(response).lower()
        return any(
            phrase in description
            for phrase in (
                "chat not found",
                "peer_id_invalid",
                "group chat was upgraded",
                "bot was kicked",
                "user is deactivated",
                "bot can't initiate conversation",
                "can't initiate conversation",
                "bot is not a member",
                "have no rights",
                "need administrator",
                "group chat was deactivated",
                "blocked by the user",
                "user_is_blocked",
            )
        )
    return False


def send_text(
    token: str,
    chat_id: int,
    text: str,
    parse_mode: str | None = None,
    *,
    button_url: str | None = None,
    button_text: str = "Open in browser",
) -> bool:
    payload: dict = {"chat_id": chat_id, "text": text}
    if parse_mode:
        payload["parse_mode"] = parse_mode
    if button_url:
        payload["reply_markup"] = {
            "inline_keyboard": [[{"text": button_text, "url": button_url}]]
        }
    try:
        response = requests.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json=payload,
            timeout=60,
        )
    except requests.RequestException as exc:
        print(f"sendMessage network error for chat {chat_id}: {exc}")
        return False

    if response.ok:
        return True

    description = _telegram_error_description(response)
    print(f"sendMessage failed for chat {chat_id}: {response.text}")
    if response.status_code in {400, 403, 404} or _is_unreachable_chat_error(response):
        block_chat(chat_id, description)
    return False


def _send_message_payload(token: str, chat_id: int, message: str | dict) -> None:
    if isinstance(message, dict):
        send_reply(token, chat_id, message)
    else:
        send_text(token, chat_id, message)


def broadcast_messages(token: str, messages: list[str] | list[dict]) -> None:
    chat_ids = startup_chat_ids()
    if not chat_ids:
        print("Broadcast skipped: no chat IDs configured.")
        return
    for chat_id in chat_ids:
        for message in messages:
            try:
                _send_message_payload(token, chat_id, message)
                time.sleep(0.35)
            except requests.RequestException as exc:
                print(f"Broadcast failed for chat {chat_id}: {exc}")


_greeted_this_session: set[int] = set()
_last_ranking_by_chat: dict[int, dict] = {}
_bot_username: str | None = None


def _redact_telegram(text: str, token: str) -> str:
    """Never log the bot token (Telegram puts it in request URLs)."""
    if token and token in text:
        return text.replace(token, "***")
    return text


def clear_telegram_webhook(token: str) -> None:
    """Polling and webhooks cannot run together; clear any leftover webhook."""
    try:
        response = requests.get(
            f"https://api.telegram.org/bot{token}/deleteWebhook",
            params={"drop_pending_updates": "false"},
            timeout=30,
        )
        if response.ok and (response.json() or {}).get("ok"):
            print("Telegram webhook cleared (polling mode).")
        else:
            print(f"Telegram deleteWebhook: {_redact_telegram(response.text[:200], token)}")
    except requests.RequestException as exc:
        print(f"Telegram deleteWebhook failed: {_redact_telegram(str(exc), token)}")


def fetch_bot_username(token: str) -> str | None:
    try:
        response = requests.get(f"https://api.telegram.org/bot{token}/getMe", timeout=30)
        if not response.ok:
            print(f"Could not fetch bot username: HTTP {response.status_code}")
            return None
        payload = response.json()
        if payload.get("ok"):
            return payload["result"].get("username")
    except requests.RequestException as exc:
        print(f"Could not fetch bot username: {_redact_telegram(str(exc), token)}")
    return None


def normalize_command_text(text: str) -> str:
    normalized = text.strip()
    if _bot_username:
        normalized = re.sub(
            rf"@{re.escape(_bot_username)}\b",
            "",
            normalized,
            flags=re.IGNORECASE,
        ).strip()
    return normalized


def extract_incoming_message(update: dict) -> dict | None:
    for key in ("message", "edited_message", "channel_post", "edited_channel_post"):
        message = update.get(key)
        if message and message.get("text"):
            return message
    return None


def extract_chat_id_from_update(update: dict) -> int | None:
    message = extract_incoming_message(update)
    if message:
        return message["chat"]["id"]

    member_update = update.get("my_chat_member") or update.get("chat_member")
    if member_update:
        return member_update.get("chat", {}).get("id")
    return None


def fetch_pending_updates(token: str) -> tuple[list[dict], int | None]:
    try:
        response = requests.get(
            f"https://api.telegram.org/bot{token}/getUpdates",
            params={
                "allowed_updates": json.dumps(
                    [
                        "message",
                        "edited_message",
                        "channel_post",
                        "edited_channel_post",
                        "my_chat_member",
                    ]
                )
            },
            timeout=35,
        )
    except requests.RequestException as exc:
        print(f"fetch_pending_updates failed: {_redact_telegram(str(exc), token)}")
        return [], None

    if response.status_code == 409:
        print(
            "Telegram 409 on startup getUpdates — another poller holds the token. "
            "Retrying after 15s…"
        )
        time.sleep(15)
        return [], None

    if not response.ok:
        print(
            f"fetch_pending_updates HTTP {response.status_code}: "
            f"{_redact_telegram(response.text[:200], token)}"
        )
        return [], None

    payload = response.json()
    if not payload.get("ok"):
        return [], None

    updates = payload.get("result", [])
    last_update_id = updates[-1]["update_id"] if updates else None
    return updates, last_update_id


def chat_ids_from_updates(updates: list[dict]) -> set[int]:
    chat_ids: set[int] = set()
    for update in updates:
        chat_id = extract_chat_id_from_update(update)
        if chat_id is not None:
            chat_ids.add(chat_id)
    return chat_ids


def process_my_chat_member(token: str, update: dict) -> None:
    member_update = update.get("my_chat_member")
    if not member_update:
        return

    chat = member_update.get("chat", {})
    chat_id = chat.get("id")
    if chat_id is None:
        return

    new_status = member_update.get("new_chat_member", {}).get("status")
    if new_status in {"administrator", "member"}:
        unblock_chat(chat_id)
        save_known_chat(chat_id)
        chat_type = chat.get("type", "unknown")
        print(f"Bot added to {chat_type} {chat_id}")
        if chat_type == "channel":
            send_text(
                token,
                chat_id,
                "SavvyETF Bot is ready in this channel.\n"
                "Commands: /etf /sp /nas /kospi /kosdaq /etf_pre /sp_pre /nas_pre /heatmap /macro /idx /comp /financial /dart /news /news_naver /aibriefing /reddit /summary /summary_pre /summary_kor /summary_kor_intra /help",
            )
    elif new_status in {"left", "kicked"}:
        block_chat(chat_id, f"bot status is {new_status}")


def process_telegram_update(token: str, update: dict) -> None:
    if update.get("my_chat_member"):
        process_my_chat_member(token, update)
        return

    message = extract_incoming_message(update)
    if not message:
        return

    chat_id = message["chat"]["id"]
    chat_type = message["chat"].get("type", "private")
    command_text = normalize_command_text(message["text"])

    save_known_chat(chat_id)
    if chat_type != "channel":
        maybe_send_deferred_startup_guide(token, chat_id)

    replies = handle_telegram_message(command_text, chat_id)
    if not isinstance(replies, list):
        replies = [replies]

    for reply in replies:
        send_reply(token, chat_id, reply)


# Keep getUpdates responsive: heavy commands run off the poll loop.
# Cap workers to limit RAM on Render Starter (512MB).
_UPDATE_EXECUTOR = ThreadPoolExecutor(max_workers=2, thread_name_prefix="tg-cmd")
_chat_inflight: dict[int, Future] = {}
_chat_inflight_lock = threading.Lock()


def _run_telegram_update(token: str, update: dict, chat_id: int | None) -> None:
    update_id = update.get("update_id")
    try:
        print(f"Handling update {update_id} (chat={chat_id})")
        process_telegram_update(token, update)
    except Exception as exc:
        print(f"Update handler error (update={update_id}, chat={chat_id}): {exc}")
        if chat_id is not None:
            send_text(token, chat_id, f"Command failed: {exc}")
    finally:
        if chat_id is not None:
            with _chat_inflight_lock:
                _chat_inflight.pop(chat_id, None)
        print(f"Finished update {update_id} (chat={chat_id})")


def enqueue_telegram_update(token: str, update: dict) -> None:
    """Poller calls this and returns to getUpdates immediately."""
    chat_id = extract_chat_id_from_update(update)

    with _chat_inflight_lock:
        if chat_id is not None:
            existing = _chat_inflight.get(chat_id)
            if existing is not None and not existing.done():
                send_text(
                    token,
                    chat_id,
                    "Still working on your previous command. Please wait a moment.",
                )
                return
        future = _UPDATE_EXECUTOR.submit(_run_telegram_update, token, update, chat_id)
        if chat_id is not None:
            _chat_inflight[chat_id] = future


def send_startup_guide_to_chat(token: str, chat_id: int) -> bool:
    if chat_id in _greeted_this_session:
        return False
    if not send_text(token, chat_id, STARTUP_TEXT):
        return False
    _greeted_this_session.add(chat_id)
    save_known_chat(chat_id)
    print(f"Startup guide sent to chat {chat_id}")
    return True


def broadcast_startup_guide(token: str, extra_chat_ids: set[int] | None = None) -> bool:
    chat_ids = startup_chat_ids()
    if extra_chat_ids:
        chat_ids |= extra_chat_ids

    if not chat_ids:
        print("Startup guide deferred: no chat IDs yet.")
        print("It will be sent when you message the bot, or set TELEGRAM_CHAT_ID in .env")
        return False

    for chat_id in chat_ids:
        send_startup_guide_to_chat(token, chat_id)
    return True


def maybe_send_deferred_startup_guide(token: str, chat_id: int) -> None:
    if chat_id not in _greeted_this_session:
        send_startup_guide_to_chat(token, chat_id)


def _ranking_loading_reply(universe: str) -> list[dict]:
    label = {
        "etf": "ETF",
        "sp": "S&P 500",
        "nas": "NASDAQ 100",
        "kospi": "KOSPI 200",
        "kosdaq": "KOSDAQ 100",
    }.get(universe, universe.upper())
    status = get_warmup_status(universe)
    if status.get("phase") == "failed" and status.get("error"):
        start_universe_cache_warmup(universe, force=True)
        return [
            {
                "text": (
                    f"{label} cache build failed earlier:\n{status['error']}\n\n"
                    f"Retrying now. Send /{universe} again in ~30–60 seconds."
                )
            }
        ]
    if is_cache_warmup_running(universe) or status.get("running"):
        detail = status.get("message") or "still building"
        hint = (
            "KOSPI/KOSDAQ first build can take a few minutes."
            if universe in {"kospi", "kosdaq"}
            else "S&P/NASDAQ usually finish within ~1 minute."
        )
        return [
            {
                "text": (
                    f"{label} rankings are still loading ({detail}).\n"
                    f"{hint} Try /{universe} again shortly."
                )
            }
        ]
    start_universe_cache_warmup(universe)
    return [
        {
            "text": (
                f"Loading {label} rankings "
                f"(Yahoo chart → same-day disk cache).\n"
                f"First build usually takes under a minute. Try /{universe} again shortly."
            )
        }
    ]


def handle_telegram_message(message, chat_id: int):
    normalized = message.strip()
    lower = normalized.lower()

    if lower in {"/help", "/start", "help"}:
        return [{"text": HELP_TEXT}]

    if lower.startswith("/summary_pre"):
        try:
            from summary_pre_builder import generate_summary_pre

            replies: list[dict] = [
                {"text": "🌅 Building premarket brief (/sp_pre, ETF excluded)…"}
            ]
            summary = generate_summary_pre(public_url=summary_public_url())
            replies.extend(summary["telegram_messages"])
            return replies
        except Exception as exc:
            return [{"text": f"Error building premarket summary: {exc}"}]

    if lower.startswith("/summary_kor_intra"):
        try:
            from summary_kor_builder import generate_summary_kor_intra

            replies: list[dict] = [
                {
                    "text": (
                        "🇰🇷 Building Korea intraday brief "
                        "(force-refresh Yahoo · KOSPI200 + KOSDAQ100)…"
                    )
                }
            ]
            summary = generate_summary_kor_intra(public_url=summary_public_url())
            replies.extend(summary["telegram_messages"])
            return replies
        except Exception as exc:
            return [{"text": f"Error building Korea intraday summary: {exc}"}]

    if lower.startswith("/summary_kor"):
        try:
            from summary_kor_builder import generate_summary_kor

            replies: list[dict] = [
                {"text": "🇰🇷 Building Korea brief (KOSPI200 + KOSDAQ100)…"}
            ]
            summary = generate_summary_kor(public_url=summary_public_url())
            replies.extend(summary["telegram_messages"])
            return replies
        except Exception as exc:
            return [{"text": f"Error building Korea summary: {exc}"}]

    if lower.startswith("/summary"):
        try:
            from summary_builder import SUMMARY_UNIVERSES, caches_ready, generate_and_save_summary

            if not caches_ready():
                missing = ensure_universe_caches(SUMMARY_UNIVERSES)
                if missing:
                    labels = ", ".join(
                        {"etf": "ETF", "sp": "S&P 500", "nas": "NASDAQ 100"}.get(u, u)
                        for u in missing
                    )
                    return [
                        {
                            "text": (
                                f"Summary caches are loading ({labels}). "
                                "First run may take 2–5 minutes — try /summary again shortly."
                            )
                        }
                    ]
            summary = generate_and_save_summary(public_url=summary_public_url())
            return summary["telegram_messages"]
        except Exception as exc:
            return [{"text": f"Error building summary: {exc}"}]

    if lower in {"/aibriefing", "/ai_briefing", "/ai briefing"} or lower.startswith("/aibriefing "):
        try:
            from ai_briefing import format_ai_briefing_telegram, generate_ai_briefing

            briefing = generate_ai_briefing()
            return format_ai_briefing_telegram(briefing, include_sources=True)
        except Exception as exc:
            return [{"text": f"Error generating AI briefing: {exc}"}]

    if lower in {"/reddit", "/wsb"} or lower.startswith("/reddit "):
        try:
            from reddit_builder import generate_and_save_reddit_brief

            replies: list[dict] = [
                {
                    "text": (
                        "🟠 Crawling r/wallstreetbets + /financial for top tickers…"
                    )
                }
            ]
            brief = generate_and_save_reddit_brief(public_url=summary_public_url())
            replies.extend(brief.get("telegram_messages") or [])
            return replies
        except Exception as exc:
            return [{"text": f"Error building Reddit brief: {exc}"}]

    if lower.startswith("/news_naver"):
        try:
            parts = normalized.split(maxsplit=1)
            query = parts[1].strip() if len(parts) > 1 else ""
            if query:
                messages = format_naver_news_messages(query=query)
                return [{"text": text} for text in messages]

            context = _last_ranking_by_chat.get(chat_id)
            if not context:
                return [
                    {
                        "text": (
                            "No recent ranking found.\n"
                            "Run /kospi or /kosdaq first, then /news_naver.\n"
                            "Or search directly: /news_naver 삼성전자"
                        )
                    }
                ]
            messages = format_naver_news_messages(
                context["tickers"],
                context_label=context["label"],
                universe=context.get("universe"),
            )
            return [{"text": text} for text in messages]
        except Exception as exc:
            return [{"text": f"Error fetching Naver news: {exc}"}]

    if lower.startswith("/news"):
        try:
            context = _last_ranking_by_chat.get(chat_id)
            if not context:
                return [
                    {
                        "text": (
                            "No recent ranking found.\n"
                            "Run /etf, /sp, or /nas first, then use /news."
                        )
                    }
                ]
            messages = format_news_messages(
                context["tickers"],
                context_label=context["label"],
                universe=context.get("universe"),
            )
            return [{"text": text} for text in messages]
        except Exception as exc:
            return [{"text": f"Error fetching news: {exc}"}]

    if lower.startswith("/dart"):
        try:
            from dart_etf_memb import is_dart_etf_memb_command, parse_dart_etf_memb_query
            from dart_pipeline import run_dart_analysis, run_dart_etf_memb

            if is_dart_etf_memb_command(normalized):
                query = parse_dart_etf_memb_query(normalized)
                replies: list[dict] = [{"text": f"ETF 편입종목 조회 중: {query}…"}]
                result = run_dart_etf_memb(query)
                replies.extend(result["telegram_messages"])
                return replies

            from dart_data import parse_dart_query

            query = parse_dart_query(normalized)
            replies = [{"text": f"DART 재무분석 중: {query}…"}]
            result = run_dart_analysis(query)
            replies.extend(result["telegram_messages"])
            return replies
        except ValueError as exc:
            return [
                {
                    "text": (
                        "Usage:\n"
                        "/dart 한국기업명\n"
                        "  Example: /dart 삼성전자 | /dart 005930\n"
                        "/dart etf memb TICKER|NAME\n"
                        "  Example: /dart etf memb 0167A0\n"
                        "  Example: /dart etf memb SOL AI반도체TOP2플러스\n\n"
                        f"{exc}"
                    )
                }
            ]
        except Exception as exc:
            return [{"text": f"DART analysis failed: {exc}"}]

    if lower.startswith("/financial"):
        try:
            from financial_data import parse_financial_ticker
            from financial_pipeline import run_financial_analysis

            symbol = parse_financial_ticker(normalized)
            replies: list[dict] = [{"text": f"Analyzing {symbol} fundamentals…"}]
            result = run_financial_analysis(symbol)
            replies.extend(result["telegram_messages"])
            return replies
        except ValueError as exc:
            return [
                {
                    "text": (
                        "Usage: /financial TICKER\n"
                        "Example: /financial AAPL\n"
                        "Example: /financial MSFT\n\n"
                        f"{exc}"
                    )
                }
            ]
        except Exception as exc:
            return [{"text": f"Financial analysis failed: {exc}"}]

    if lower.startswith("/comp"):
        tickers = parse_comp_tickers(normalized)
        if len(tickers) < 2:
            return [
                {
                    "text": (
                        "Usage: /comp ETF1 ETF2 [ETF3 ...]\n"
                        "Example: /comp QQQ IVV QNDX\n"
                        "Example: /comp SPY, VOO, IVV"
                    )
                }
            ]
        try:
            from etf_compare_pipeline import run_etf_comparison

            result = run_etf_comparison(tickers)
            replies: list[dict] = [{"text": "Building ETF comparison…"}]
            replies.extend(result.get("telegram_messages") or [
                {
                    "text": result["text_summary"],
                    "document_path": str(result["excel_path"]),
                    "parse_mode": "HTML",
                }
            ])
            return replies
        except Exception as exc:
            return [{"text": f"ETF comparison failed: {exc}"}]

    if lower.startswith("/adr"):
        parts = normalized.split()
        symbols = [p.upper() for p in parts[1:] if p.strip()]
        if not symbols:
            return [{"text": "Usage: /adr TSM ASML ARM\n\n" + HELP_TEXT}]
        try:
            from adr_pipeline import run_adr_analysis

            result = run_adr_analysis(symbols)
            replies: list[dict] = [
                {"text": "Analyzing ADR impact…"},
                {"text": result["text_summary"]},
                {"text": "ADR Impact — Summary chart", "photo": result["panel_chart"]},
                {
                    "text": "ADR Impact — Aligned overlay (t=0 rebased returns)",
                    "photo": result["overlay_chart"],
                },
            ]
            for sym, buf in result["single_charts"].items():
                replies.append({"text": f"{sym} — event chart", "photo": buf})
            replies.append(
                {
                    "text": "ADR Impact — Excel workbook",
                    "document_path": str(result["excel_path"]),
                }
            )
            return replies
        except Exception as exc:
            return [{"text": f"ADR analysis failed: {exc}"}]

    if lower.startswith("/idx"):
        try:
            from idx_pipeline import run_idx_dashboard

            replies: list[dict] = [
                {"text": "🌍 Building MSCI country / major-market dashboard…"}
            ]
            result = run_idx_dashboard()
            replies.extend(result.get("telegram_messages") or [])
            return replies
        except Exception as exc:
            return [{"text": f"/idx failed: {exc}"}]

    if lower.startswith("/heatmap"):
        try:
            from heatmap import is_size_cache_ready, parse_heatmap_command, plot_market_heatmap

            universe, top_n = parse_heatmap_command(normalized)
            if not is_cache_ready(universe):
                return _ranking_loading_reply(universe)
            replies: list[dict] = []
            if not is_size_cache_ready(universe):
                replies.append(
                    {
                        "text": (
                            "Building market-cap/AUM cache for heatmap "
                            "(first run may take 1–2 minutes)…"
                        )
                    }
                )
            chart_buf, caption, _ = plot_market_heatmap(universe, top_n=top_n)
            replies.append({"text": caption, "photo": chart_buf})
            return replies
        except ValueError as exc:
            return [{"text": f"Invalid heatmap command: {exc}\n\nUsage: /heatmap sp | /heatmap nas 20 | /heatmap etf 30"}]
        except Exception as exc:
            return [{"text": f"Heatmap failed: {exc}"}]

    if lower.startswith("/macro"):
        try:
            from macro_data import macro_cache_ready
            from macro_pipeline import run_macro_dashboard

            parts = normalized.split()
            force = len(parts) > 1 and parts[1].lower() == "refresh"
            replies: list[dict] = []
            if force or not macro_cache_ready():
                replies.append(
                    {"text": "Building macro risk dashboard…" if force else "Loading macro data…"}
                )
            result = run_macro_dashboard(force=force)
            replies.extend(result.get("telegram_messages") or [
                {
                    "text": result["text_summary"],
                    "photo": result["chart"],
                    "parse_mode": "HTML",
                }
            ])
            return replies
        except Exception as exc:
            return [{"text": f"Macro dashboard failed: {exc}"}]

    if normalized.startswith("/port"):
        try:
            from analysis import analyze_stock, simulate_portfolio

            tickers = normalized.split()[1:]
            if not tickers:
                return [{"text": "Please provide stock tickers after /port (e.g. /port AAPL MSFT GOOGL)"}]

            portfolio_return, simulator = simulate_portfolio(tickers)
            responses = []

            plot_buffer = simulator.plot_returns()
            responses.append(
                {
                    "text": (
                        f"Portfolio Overview:\n"
                        f"Tickers: {', '.join(tickers)}\n"
                        f"Expected Annual Return: {portfolio_return:.2f}%"
                    ),
                    "photo": plot_buffer,
                }
            )

            for ticker in tickers:
                try:
                    plot_buffer = analyze_stock(ticker)
                    responses.append(
                        {
                            "text": f"Technical Analysis for {ticker.upper()}",
                            "photo": plot_buffer,
                        }
                    )
                except Exception as exc:
                    responses.append({"text": f"Error analyzing {ticker}: {exc}"})

            return responses
        except Exception as exc:
            return [{"text": f"Error simulating portfolio: {exc}"}]

    if lower.startswith("/coin"):
        try:
            from analysis import analyze_crypto

            parts = normalized.split()
            if len(parts) < 2:
                return [{"text": "Please provide a coin symbol (e.g. /coin BTC)"}]

            symbol = parts[1]
            plot_buffer = analyze_crypto(symbol)
            return [
                {
                    "text": f"Technical Analysis for {symbol.upper()}",
                    "photo": plot_buffer,
                }
            ]
        except Exception as exc:
            return [{"text": f"Error analyzing cryptocurrency: {str(exc)}"}]

    if lower.startswith(("/etf_pre", "/sp_pre", "/nas_pre")):
        try:
            from premarket_rankings import (
                format_premarket_telegram,
                build_premarket_rankings,
                parse_premarket_command,
            )

            universe = parse_premarket_command(normalized)
            label = {"etf": "ETF", "sp": "S&P 500", "nas": "NASDAQ 100"}[universe]
            replies: list[dict] = [
                {
                    "text": (
                        f"Fetching {label} pre-market quotes via Finnhub "
                        f"(~30 quotes/min to avoid rate limits; "
                        f"S&P 500 can take ~15–20 min)…"
                    )
                }
            ]
            result = build_premarket_rankings(universe)
            replies.append({"text": format_premarket_telegram(result), "parse_mode": "HTML"})
            tickers = [row["ticker"] for row in (result["gainers"] + result["losers"])]
            if tickers:
                _last_ranking_by_chat[chat_id] = {
                    "tickers": tickers,
                    "label": f"{result['label']} pre-market",
                    "universe": universe,
                }
            return replies
        except ValueError as exc:
            return [
                {
                    "text": (
                        "Usage: /etf_pre | /sp_pre | /nas_pre\n"
                        "Returns live/pre-market % vs previous close (Finnhub).\n\n"
                        f"{exc}"
                    )
                }
            ]
        except Exception as exc:
            return [{"text": f"Pre-market ranking failed: {exc}"}]

    if lower.startswith(("/etf", "/sp", "/nas", "/kospi", "/kosdaq")) and not lower.startswith(
        ("/etf_pre", "/sp_pre", "/nas_pre", "/etfcheck")
    ):
        # Avoid matching /etf_pre etc.; require command token exactly
        first = lower.split()[0]
        if first not in {"/etf", "/sp", "/nas", "/kospi", "/kosdaq"}:
            return [{"text": HELP_TEXT}]
        try:
            universe, mode = parse_rank_command(normalized)
            if not is_cache_ready(universe):
                return _ranking_loading_reply(universe)
            tickers, context_label = get_ranking_tickers(
                universe=universe,
                mode=mode,
            )
            _last_ranking_by_chat[chat_id] = {
                "tickers": tickers,
                "label": context_label,
                "universe": universe,
            }
            text = format_rankings_message(universe=universe, mode=mode)
            responses = [{"text": text}]
            leader = get_top_leader_ticker(universe, mode)
            if leader:
                label = {
                    "etf": "ETF",
                    "sp": "S&P 500",
                    "nas": "NASDAQ 100",
                    "kospi": "KOSPI 200",
                    "kosdaq": "KOSDAQ 100",
                }[universe]
                leader_label = leader.upper()
                if universe == "etf":
                    from etf_names import format_etf_ticker_label

                    leader_label = format_etf_ticker_label(leader)
                elif universe in {"kospi", "kosdaq"}:
                    from kr_names import format_kr_ticker_label

                    leader_label = format_kr_ticker_label(leader)
                responses.append(
                    {
                        "text": f"📈 {label} top leader: {leader_label}",
                        "chart_ticker": leader,
                    }
                )
            return responses
        except ValueError as exc:
            return [{"text": f"Invalid command: {exc}\n\n{HELP_TEXT}"}]
        except Exception as exc:
            return [{"text": f"Error ranking stocks: {exc}"}]

    return [{"text": HELP_TEXT}]


def _handle_telegram_send_response(
    response: requests.Response,
    chat_id: int,
    *,
    method: str,
    fallback_text: str = "",
    token: str = "",
    parse_mode: str | None = None,
) -> bool:
    if response.ok:
        return True

    description = _telegram_error_description(response)
    print(f"{method} failed for chat {chat_id}: {response.text}")
    if _is_unreachable_chat_error(response):
        block_chat(chat_id, description)
        return False
    if fallback_text and token:
        send_text(token, chat_id, fallback_text, parse_mode=parse_mode)
    return False


def send_reply(token, chat_id, reply):
    photo = reply.get("photo")
    photo_path = reply.get("photo_path")
    chart_ticker = reply.get("chart_ticker")
    document_path = reply.get("document_path")

    if photo is None and chart_ticker:
        try:
            from analysis import analyze_stock

            photo = analyze_stock(chart_ticker)
        except Exception as exc:
            send_text(
                token,
                chat_id,
                f"{reply.get('text', chart_ticker)}\nChart error: {exc}",
                parse_mode=reply.get("parse_mode"),
            )
            return

    text = reply.get("text", "")
    parse_mode = reply.get("parse_mode")

    if photo is None and photo_path is not None:
        path = Path(photo_path)
        payload: dict = {"chat_id": chat_id}
        if text:
            payload["caption"] = text[:1024]
        if parse_mode and text:
            payload["parse_mode"] = parse_mode
        with path.open("rb") as handle:
            response = requests.post(
                f"https://api.telegram.org/bot{token}/sendPhoto",
                data=payload,
                files={"photo": ("photo.jpg", handle, "image/jpeg")},
                timeout=60,
            )
        _handle_telegram_send_response(
            response,
            chat_id,
            method="sendPhoto",
            fallback_text=text,
            token=token,
            parse_mode=parse_mode,
        )
        return

    if photo is not None:
        from chart_buffers import photo_to_upload_bytes
        from io import BytesIO

        try:
            png_bytes = photo_to_upload_bytes(photo)
        except Exception as exc:
            send_text(
                token,
                chat_id,
                f"{text}\nChart upload error: {exc}".strip(),
                parse_mode=parse_mode,
            )
            return
        payload: dict = {"chat_id": chat_id}
        if text:
            payload["caption"] = text[:1024]
        if parse_mode and text:
            payload["parse_mode"] = parse_mode
        response = requests.post(
            f"https://api.telegram.org/bot{token}/sendPhoto",
            data=payload,
            files={"photo": ("chart.png", BytesIO(png_bytes), "image/png")},
            timeout=60,
        )
        _handle_telegram_send_response(
            response,
            chat_id,
            method="sendPhoto",
            fallback_text=text,
            token=token,
            parse_mode=parse_mode,
        )
        return

    if document_path is not None:
        try:
            path = Path(document_path)
            data: dict = {"chat_id": chat_id}
            if text:
                data["caption"] = text[:1024]
            button_url = reply.get("button_url")
            button_text = reply.get("button_text", "Open in browser")
            if button_url:
                data["reply_markup"] = json.dumps(
                    {"inline_keyboard": [[{"text": button_text, "url": button_url}]]}
                )
            mime = _web_content_type(path)
            with path.open("rb") as handle:
                response = requests.post(
                    f"https://api.telegram.org/bot{token}/sendDocument",
                    data=data,
                    files={"document": (path.name, handle, mime)},
                    timeout=180,
                )
            _handle_telegram_send_response(
                response,
                chat_id,
                method="sendDocument",
                fallback_text=text,
                token=token,
            )
        except Exception as exc:
            send_text(token, chat_id, f"{text}\nDocument error: {exc}".strip())
        return

    button_url = reply.get("button_url")
    button_text = reply.get("button_text", "Open in browser")
    send_text(
        token,
        chat_id,
        text,
        parse_mode=parse_mode,
        button_url=button_url,
        button_text=button_text,
    )


def _web_content_type(path: Path) -> str:
    suffix = path.suffix.lower()
    return {
        ".html": "text/html; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".js": "application/javascript; charset=utf-8",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".ico": "image/x-icon",
        ".pdf": "application/pdf",
        ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }.get(suffix, "application/octet-stream")


def _read_web_file(relative_path: str) -> tuple[bytes, str] | None:
    target = (WEB_DIR / relative_path).resolve()
    if not str(target).startswith(str(WEB_DIR.resolve())):
        return None
    if not target.is_file():
        return None
    return target.read_bytes(), _web_content_type(target)


def start_web_server():
    port = int(os.environ.get("PORT", "8080"))

    class AppHandler(BaseHTTPRequestHandler):
        def _send(self, body: bytes, content_type: str, status: int = 200) -> None:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            path = urlparse(self.path).path

            if path == "/health":
                import importlib.util

                kor_spec = importlib.util.find_spec("summary_kor_builder")
                payload = {
                    "ok": True,
                    "summary_kor_builder": kor_spec is not None,
                    "py_modules": sorted(p.name for p in PROJECT_DIR.glob("*.py")),
                }
                self._send(
                    json.dumps(payload).encode("utf-8"),
                    "application/json; charset=utf-8",
                )
                return

            if path in {"/", "/index.html"}:
                payload = _read_web_file("index.html")
                if payload:
                    self._send(*payload)
                    return

            if path.startswith("/css/"):
                payload = _read_web_file(path.lstrip("/"))
                if payload:
                    self._send(*payload)
                    return

            if path == "/summary":
                from summary_builder import load_summary_html

                body_text = load_summary_html()
                if not body_text:
                    body_text = (
                        "<html><body><p>Summary not generated yet. "
                        "Use /summary in Telegram or wait for the scheduled brief.</p></body></html>"
                    )
                self._send(body_text.encode("utf-8"), "text/html; charset=utf-8")
                return

            if path == "/summary_kor":
                from summary_kor_builder import load_summary_kor_html

                body_text = load_summary_kor_html()
                if not body_text:
                    body_text = (
                        "<html><body><p>Korea summary not generated yet. "
                        "Use /summary_kor in Telegram first.</p></body></html>"
                    )
                self._send(body_text.encode("utf-8"), "text/html; charset=utf-8")
                return

            if path == "/summary_kor_intra":
                from summary_kor_builder import load_summary_kor_intra_html

                body_text = load_summary_kor_intra_html()
                if not body_text:
                    body_text = (
                        "<html><body><p>Korea intraday summary not generated yet. "
                        "Use /summary_kor_intra in Telegram first.</p></body></html>"
                    )
                self._send(body_text.encode("utf-8"), "text/html; charset=utf-8")
                return

            if path == "/reddit":
                from reddit_builder import load_reddit_html

                body_text = load_reddit_html()
                if not body_text:
                    body_text = (
                        "<html><body><p>Reddit / WSB brief not generated yet. "
                        "Use /reddit in Telegram first.</p></body></html>"
                    )
                self._send(body_text.encode("utf-8"), "text/html; charset=utf-8")
                return

            if path == "/summary.pdf":
                from summary_pdf import SUMMARY_PDF_PATH

                if SUMMARY_PDF_PATH.is_file():
                    data = SUMMARY_PDF_PATH.read_bytes()
                    self.send_response(200)
                    self.send_header("Content-Type", "application/pdf")
                    self.send_header("Content-Length", str(len(data)))
                    self.send_header(
                        "Content-Disposition",
                        'attachment; filename="savvyetf-summary.pdf"',
                    )
                    self.end_headers()
                    self.wfile.write(data)
                    return
                self._send(
                    b"PDF not generated yet. Run /summary in Telegram first.",
                    "text/plain; charset=utf-8",
                    status=404,
                )
                return

            if path == "/summary_pre.pdf":
                from summary_pdf import SUMMARY_PRE_PDF_PATH

                if SUMMARY_PRE_PDF_PATH.is_file():
                    data = SUMMARY_PRE_PDF_PATH.read_bytes()
                    self.send_response(200)
                    self.send_header("Content-Type", "application/pdf")
                    self.send_header("Content-Length", str(len(data)))
                    self.send_header(
                        "Content-Disposition",
                        'attachment; filename="savvyetf-summary-pre.pdf"',
                    )
                    self.end_headers()
                    self.wfile.write(data)
                    return
                self._send(
                    b"Premarket PDF not generated yet. Run /summary_pre in Telegram first.",
                    "text/plain; charset=utf-8",
                    status=404,
                )
                return

            if path == "/summary_kor.pdf":
                from summary_pdf import SUMMARY_KOR_PDF_PATH

                if SUMMARY_KOR_PDF_PATH.is_file():
                    data = SUMMARY_KOR_PDF_PATH.read_bytes()
                    self.send_response(200)
                    self.send_header("Content-Type", "application/pdf")
                    self.send_header("Content-Length", str(len(data)))
                    self.send_header(
                        "Content-Disposition",
                        'attachment; filename="savvyetf-summary-kor.pdf"',
                    )
                    self.end_headers()
                    self.wfile.write(data)
                    return
                self._send(
                    b"Korea PDF not generated yet. Run /summary_kor in Telegram first.",
                    "text/plain; charset=utf-8",
                    status=404,
                )
                return

            if path == "/summary_kor_intra.pdf":
                from summary_pdf import SUMMARY_KOR_INTRA_PDF_PATH

                if SUMMARY_KOR_INTRA_PDF_PATH.is_file():
                    data = SUMMARY_KOR_INTRA_PDF_PATH.read_bytes()
                    self.send_response(200)
                    self.send_header("Content-Type", "application/pdf")
                    self.send_header("Content-Length", str(len(data)))
                    self.send_header(
                        "Content-Disposition",
                        'attachment; filename="savvyetf-summary-kor-intra.pdf"',
                    )
                    self.end_headers()
                    self.wfile.write(data)
                    return
                self._send(
                    b"Korea intraday PDF not generated yet. "
                    b"Run /summary_kor_intra in Telegram first.",
                    "text/plain; charset=utf-8",
                    status=404,
                )
                return

            if path == "/reddit.pdf":
                from summary_pdf import REDDIT_PDF_PATH

                if REDDIT_PDF_PATH.is_file():
                    data = REDDIT_PDF_PATH.read_bytes()
                    self.send_response(200)
                    self.send_header("Content-Type", "application/pdf")
                    self.send_header("Content-Length", str(len(data)))
                    self.send_header(
                        "Content-Disposition",
                        'attachment; filename="savvyetf-reddit.pdf"',
                    )
                    self.end_headers()
                    self.wfile.write(data)
                    return
                self._send(
                    b"Reddit PDF not generated yet. Run /reddit in Telegram first.",
                    "text/plain; charset=utf-8",
                    status=404,
                )
                return

            if path in {"/kakao", "/kakao/"}:
                from kakao_notify import status_payload

                st = status_payload()
                auth = html.escape(st.get("authorize_url") or "")
                body = f"""<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8"><title>SavvyETF Kakao</title>
<style>body{{font-family:system-ui,sans-serif;max-width:640px;margin:2rem auto;padding:0 1rem;line-height:1.5}}
code{{background:#f2f2f2;padding:0.1rem 0.3rem}}a.button{{display:inline-block;margin-top:1rem;padding:0.7rem 1rem;
background:#fee500;color:#191919;text-decoration:none;border-radius:8px;font-weight:700}}</style></head>
<body>
<h1>Kakao notify setup</h1>
<p>스케줄된 <code>/summary</code> 결과를 카카오톡 <b>나에게 보내기</b>로 받습니다.</p>
<ul>
<li>enabled: <code>{st['enabled']}</code></li>
<li>REST API key: <code>{st['has_rest_api_key']}</code></li>
<li>access token: <code>{st['has_access_token']}</code></li>
<li>refresh token: <code>{st['has_refresh_token']}</code></li>
<li>redirect: <code>{html.escape(st['redirect_uri'])}</code></li>
</ul>
<p>1) Developers에서 카카오 로그인 + talk_message 동의 항목을 켜세요.<br>
2) Redirect URI를 위 주소로 등록하세요.<br>
3) 아래 버튼으로 한 번 로그인/동의하세요.</p>
{"<a class='button' href='" + auth + "'>카카오 계정 연결</a>" if auth else "<p><b>KAKAO_REST_API_KEY</b> env가 필요합니다.</p>"}
<p class="meta">Open Builder 스킬 URL: <code>/kakao/skill</code> (POST)</p>
</body></html>"""
                self._send(body.encode("utf-8"), "text/html; charset=utf-8")
                return

            if path == "/kakao/auth":
                from kakao_notify import build_authorize_url, _rest_api_key

                if not _rest_api_key():
                    self._send(b"KAKAO_REST_API_KEY not set", "text/plain; charset=utf-8", 400)
                    return
                self.send_response(302)
                self.send_header("Location", build_authorize_url())
                self.end_headers()
                return

            if path == "/kakao/callback":
                from kakao_notify import exchange_code_for_tokens

                query = parse_qs(urlparse(self.path).query)
                code = (query.get("code") or [""])[0]
                err = (query.get("error") or [""])[0]
                if err:
                    self._send(
                        f"Kakao auth error: {err}".encode("utf-8"),
                        "text/plain; charset=utf-8",
                        400,
                    )
                    return
                if not code:
                    self._send(b"Missing code", "text/plain; charset=utf-8", 400)
                    return
                try:
                    exchange_code_for_tokens(code)
                except Exception as exc:
                    self._send(
                        f"Token exchange failed: {exc}".encode("utf-8"),
                        "text/plain; charset=utf-8",
                        500,
                    )
                    return
                self._send(
                    b"Kakao connected. Scheduled summaries will also go to KakaoTalk (memo to me).",
                    "text/plain; charset=utf-8",
                )
                return

            if path == "/kakao/status":
                from kakao_notify import status_payload

                body = json.dumps(status_payload(), ensure_ascii=False, indent=2).encode("utf-8")
                self._send(body, "application/json; charset=utf-8")
                return

            if path == "/kakao/test":
                from kakao_notify import kakao_notify_enabled, send_scheduled_summary_to_kakao

                if not kakao_notify_enabled():
                    self._send(
                        b"KAKAO_NOTIFY_ENABLED is false or KAKAO_REST_API_KEY missing",
                        "text/plain; charset=utf-8",
                        400,
                    )
                    return
                # Minimal payload for a live smoke test
                summary = {
                    "generated_at_display": "Kakao test ping",
                    "ticker_count": 0,
                    "universes": [],
                    "ai_analysis": {
                        "market_brief_ko": "SavvyETF Kakao notify test. Open the web brief link."
                    },
                }
                ok = send_scheduled_summary_to_kakao(summary, public_url=summary_public_url())
                if ok:
                    self._send(b"Kakao test memo sent (check Chat with myself).", "text/plain; charset=utf-8")
                else:
                    self._send("Kakao test failed — see server logs.".encode("utf-8"), "text/plain; charset=utf-8", 500)
                return

            self._send(b"not found", "text/plain; charset=utf-8", status=404)

        def do_POST(self):
            path = urlparse(self.path).path
            if path == "/kakao/skill":
                from kakao_notify import build_skill_response
                from summary_builder import SUMMARY_META_PATH, resolve_summary_public_url

                length = int(self.headers.get("Content-Length") or 0)
                if length:
                    self.rfile.read(length)  # body unused for this lightweight skill
                meta = None
                if SUMMARY_META_PATH.is_file():
                    try:
                        meta = json.loads(SUMMARY_META_PATH.read_text(encoding="utf-8"))
                    except (OSError, json.JSONDecodeError):
                        meta = None
                payload = build_skill_response(meta, public_url=summary_public_url() or resolve_summary_public_url())
                body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
                self._send(body, "application/json; charset=utf-8")
                return

            self._send(b"not found", "text/plain; charset=utf-8", status=404)

        def log_message(self, format, *args):
            return

    server = HTTPServer(("0.0.0.0", port), AppHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    print(
        f"Web server listening on port {port} "
        f"( / , /summary , /summary_kor , /summary_kor_intra , /reddit , /summary.pdf , /summary_pre.pdf , /summary_kor.pdf , /summary_kor_intra.pdf , /reddit.pdf , /kakao , /kakao/skill , /health )"
    )


def get_bot_token() -> str:
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    placeholder = "your_bot_token_from_botfather"
    if not token or token == placeholder:
        if not ENV_FILE.exists():
            print(f".env file not found at: {ENV_FILE}")
            print("Run:  bash setup.sh")
        else:
            print(f"Edit {ENV_FILE} and set TELEGRAM_BOT_TOKEN to your token from @BotFather.")
        sys.exit(1)
    return token


def start_telegram_bot(token: str):
    global _bot_username
    clear_telegram_webhook(token)
    _bot_username = fetch_bot_username(token)
    if _bot_username:
        print(f"Bot username: @{_bot_username}")

    print("Starting Telegram bot (async command workers)...")
    pending_updates, last_update_id = fetch_pending_updates(token)
    broadcast_startup_guide(token, chat_ids_from_updates(pending_updates))

    # Never block the poll loop on command handlers — including backlog at boot.
    for update in pending_updates:
        enqueue_telegram_update(token, update)

    while True:
        try:
            params = {
                "timeout": 25,
                "allowed_updates": json.dumps(
                    [
                        "message",
                        "edited_message",
                        "channel_post",
                        "edited_channel_post",
                        "my_chat_member",
                    ]
                ),
            }
            if last_update_id is not None:
                params["offset"] = last_update_id + 1

            response = requests.get(
                f"https://api.telegram.org/bot{token}/getUpdates",
                params=params,
                timeout=35,
            )

            # 409 = another getUpdates long-poll is active (local bot, old Render
            # instance during deploy, etc.). Wait and retry; never log the token URL.
            if response.status_code == 409:
                print(
                    "Telegram 409 Conflict: another getUpdates poller is using this bot token. "
                    "Stop any local bot.py / extra Render instance. Retrying in 20s…"
                )
                time.sleep(20)
                continue

            if not response.ok:
                print(
                    f"Telegram getUpdates HTTP {response.status_code}: "
                    f"{_redact_telegram(response.text[:200], token)}"
                )
                time.sleep(5)
                continue

            payload = response.json()

            if not payload.get("ok"):
                print(f"Telegram API error: {payload}")
                time.sleep(5)
                continue

            for update in payload.get("result", []):
                last_update_id = update["update_id"]
                enqueue_telegram_update(token, update)

        except requests.RequestException as exc:
            print(f"Network error in bot loop: {_redact_telegram(str(exc), token)}")
            time.sleep(5)
        except Exception as exc:
            print(f"Error in bot loop: {_redact_telegram(str(exc), token)}")
            time.sleep(5)


if __name__ == "__main__":
    token = get_bot_token()
    mark_service_started()
    start_web_server()
    if os.environ.get("BOT_DEFER_CACHE_WARMUP", "true").lower() not in {"0", "false", "no"}:
        threading.Thread(
            target=warmup_startup_caches,
            name="cache-warmup",
            daemon=True,
        ).start()
        threading.Thread(
            target=warmup_deferred_caches,
            name="deferred-cache-warmup",
            daemon=True,
        ).start()
        start_cache_watchdog()
    else:
        warmup_startup_caches()
        warmup_deferred_caches()
        start_cache_watchdog()
    start_summary_scheduler(
        token=token,
        broadcast_fn=broadcast_messages,
        refresh_cache_fn=warmup_all_caches,
        public_url=summary_public_url(),
    )
    start_reddit_scheduler(token=token, broadcast_fn=broadcast_messages)
    start_summary_kor_intra_scheduler(
        token=token,
        broadcast_fn=broadcast_messages,
        public_url=summary_public_url(),
    )
    start_summary_kor_scheduler(
        token=token,
        broadcast_fn=broadcast_messages,
        public_url=summary_public_url(),
    )
    start_telegram_bot(token)
