import json
import os
import re
import sys
import threading
import time
from concurrent.futures import Future, ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import urlparse

import requests
from dotenv import load_dotenv

from etf_compare import parse_comp_tickers
from news_crawler import format_news_messages
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
from summary_scheduler import start_summary_scheduler
from macro_scheduler import start_macro_scheduler
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

/etf surge
→ Top 3 & bottom 3 by price-up + volume surge

/sp   (or /nas)
→ Same rankings for S&P 500 / NASDAQ 100 (Yahoo chart API)

/etf_pre  /sp_pre  /nas_pre
→ Pre-market % vs previous close (Finnhub live/pre trade quotes)

/heatmap sp
→ Treemap of top names by market cap (color = daily return)

/macro
→ Macro risk monitor: chart, metrics, Finnhub/EDGAR, AI macro risk comment

/news
→ Headlines for the 6 tickers from your last /etf, /sp, or /nas result

/summary
→ ETF + S&P 500 brief, /heatmap sp, then AI briefing from trending news (last)

/aibriefing
→ Trending market news (5-10 articles) read + Korean AI brief (3-4 lines)

/adr TSM ASML ARM
→ ADR listing impact analysis (charts + Excel) for underlying shares

/comp QQQ IVV QNDX
→ ETF charts, metrics, AI pick, Excel workbook

/financial AAPL
→ S&P 500 fundamental analysis: PER, PBR, ROE, margins, EPS growth + charts

/dart 삼성전자
→ 한국 상장사 DART 재무분석: 매출·이익·ROE·성장률 + 차트

/dart etf memb 0167A0
→ 국내 ETF 편입종목·구성비 + 변경 내역 (Naver/KRX PDF)

Auto brief: after US close (YF data ready + 5m) & 22:00 KST
/macro auto: daily 17:00 KST

Price: last trading day return | Volume: latest day / 21d avg
Modes: surge | dropvol (default shows both leaders)

Type /help for the full command list.
"""

HELP_TEXT = """SavvyETF Bot — Commands

/port TICKER1 TICKER2 ...
  Portfolio backtest + TA chart per ticker.
  Example: /port AAPL MSFT GOOGL

/coin SYMBOL
  Crypto technical analysis chart.
  Example: /coin BTC

/etf [MODE]
  Rank US equity ETFs (default: top 3 surge + top 3 drop/vol leaders).
  Includes a TA chart for the #1 surge leader.
  Example: /etf | /etf surge | /etf dropvol

/sp [MODE]
  Rank S&P 500 stocks (same logic).
  Example: /sp | /sp surge

/nas [MODE]
  Rank NASDAQ 100 stocks (same logic).
  Example: /nas | /nas dropvol
  Data: Yahoo chart API (yfinance fallback).

/etf_pre | /sp_pre | /nas_pre
  Pre-market / extended-hours return vs previous close.
  Call ~1–2 hours before US open (04:00–09:30 ET).
  Uses Finnhub quote?trade=true. /etf_pre uses a liquid ETF subset.
  Example: /sp_pre

/etf /sp /nas MODE (optional):
    surge   — price up + volume surge (top 3 & bottom 3)
    dropvol — price down + volume surge (top 3 & bottom 3)
    (omit)  — top 3 from each pattern (6 tickers total)

  Price: last trading day return
  Volume: latest day / 21-day average

/heatmap [etf|sp|nas] [N]
  Finviz-style treemap: tile size = market cap (or ETF AUM),
  color = last trading day return. Default: top 30 names.
  Example: /heatmap sp | /heatmap nas 20 | /heatmap etf 30

/macro
  Macro risk monitor: chart dashboard, yield/credit/vol metrics,
  Finnhub/EDGAR pulse, and AI Korean macro risk comment.
  Auto-sent daily at 17:00 KST (MACRO_SCHEDULE_HOUR_KST).
  Example: /macro | /macro refresh

/news
  Headlines for the 6 tickers from your last ranking.
  Run /etf, /sp, or /nas first, then /news.

/summary
  Full market brief: ETF + S&P 500 (top 3 per board, charts, news),
  S&P 500 heatmap, then AI briefing from trending news at the end.
  Web page: see SUMMARY_PUBLIC_URL or /summary on server.
  Web brief link with button sent at the end (homepage-style page).
  Requires GEMINI_API_KEY for full AI briefing (headline fallback if unset).

/aibriefing
  Search 5-10 trending US market articles, read them, and return a
  3-4 line Korean AI market brief. Aliases: /ai_briefing, /ai briefing
  Example: /aibriefing
  Requires GEMINI_API_KEY for full analysis.

/adr ADR1 ADR2 ...
  Analyze whether US ADR listing impacted underlying home-market shares.
  Returns charts + an Excel workbook.
  Example: /adr TSM ASML ARM

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
  Korean ETF holdings (구성종목) and weights (편입비), plus change vs last snapshot.
  Open DART has no ETF PDF API — uses Naver Finance (KRX PDF-based).
  Example: /dart etf memb 0167A0
  Example: /dart etf memb SOL AI반도체TOP2플러스

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
                "Commands: /etf /sp /nas /etf_pre /sp_pre /nas_pre /heatmap /macro /comp /financial /dart /news /aibriefing /summary /help",
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
    label = {"etf": "ETF", "sp": "S&P 500", "nas": "NASDAQ 100"}[universe]
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
        return [
            {
                "text": (
                    f"{label} rankings are still loading ({detail}).\n"
                    f"S&P/NASDAQ usually finish within ~1 minute. Try /{universe} again shortly."
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

    if lower.startswith(("/etf", "/sp", "/nas")) and not lower.startswith(
        ("/etf_pre", "/sp_pre", "/nas_pre", "/etfcheck")
    ):
        # Avoid matching /etf_pre etc.; require command token exactly /etf|/sp|/nas
        first = lower.split()[0]
        if first not in {"/etf", "/sp", "/nas"}:
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
                label = {"etf": "ETF", "sp": "S&P 500", "nas": "NASDAQ 100"}[universe]
                leader_label = leader.upper()
                if universe == "etf":
                    from etf_names import format_etf_ticker_label

                    leader_label = format_etf_ticker_label(leader)
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
        photo.seek(0)
        payload: dict = {"chat_id": chat_id}
        if text:
            payload["caption"] = text[:1024]
        if parse_mode and text:
            payload["parse_mode"] = parse_mode
        response = requests.post(
            f"https://api.telegram.org/bot{token}/sendPhoto",
            data=payload,
            files={"photo": ("chart.png", photo, "image/png")},
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
                self._send(b"ok", "text/plain; charset=utf-8")
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

            self._send(b"not found", "text/plain; charset=utf-8", status=404)

        def log_message(self, format, *args):
            return

    server = HTTPServer(("0.0.0.0", port), AppHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    print(f"Web server listening on port {port} ( / , /summary , /health )")


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
    start_macro_scheduler(token=token, broadcast_fn=broadcast_messages)
    start_telegram_bot(token)
