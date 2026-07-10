import json
import os
import re
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import urlparse

import requests
from dotenv import load_dotenv

from etf_compare import parse_comp_tickers
from news_crawler import format_news_messages
from stock_crawler import (
    format_rankings_message,
    get_ranking_tickers,
    get_top_leader_ticker,
    is_cache_ready,
    is_cache_warmup_running,
    parse_rank_command,
    start_universe_cache_warmup,
    warmup_all_caches,
    warmup_deferred_caches,
    warmup_startup_caches,
)
from summary_scheduler import start_summary_scheduler

from etfcheck_scheduler import start_etfcheck_scheduler
from macro_scheduler import start_macro_scheduler
from scheduler_grace import mark_service_started

PROJECT_DIR = Path(__file__).resolve().parent
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
→ Same rankings for S&P 500 / NASDAQ 100

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

/etfcheck
→ ETF CHECK (etfcheck.co.kr) 일간 거래대금·순유입 랭킹 캡처
  Auto turnover once daily at 15:45 KST (weekdays)

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

  MODE (optional):
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

/etfcheck
  Capture ETF CHECK rankings: turnover + inflow (manual).
  Auto: turnover only once at 15:45 KST on weekdays.
  Example: /etfcheck

  Auto-sent after US market close once Yahoo Finance daily data is ready (+5m),
  and at 22:00 KST if SUMMARY_SCHEDULE_HOURS_KST includes 22.

ℹ️ /help
  Show this guide again.
"""


def summary_public_url() -> str:
    base = os.environ.get("SUMMARY_PUBLIC_URL", "").strip().rstrip("/")
    if base:
        return f"{base}/summary"
    port = os.environ.get("PORT", "8080")
    return f"http://localhost:{port}/summary"


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


def send_text(token: str, chat_id: int, text: str, parse_mode: str | None = None) -> bool:
    payload: dict = {"chat_id": chat_id, "text": text}
    if parse_mode:
        payload["parse_mode"] = parse_mode
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
_etfcheck_command_lock = threading.Lock()


def fetch_bot_username(token: str) -> str | None:
    try:
        response = requests.get(f"https://api.telegram.org/bot{token}/getMe", timeout=30)
        response.raise_for_status()
        payload = response.json()
        if payload.get("ok"):
            return payload["result"].get("username")
    except requests.RequestException as exc:
        print(f"Could not fetch bot username: {exc}")
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
    response.raise_for_status()
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
                "Commands: /etf /sp /nas /heatmap /macro /comp /etfcheck /news /aibriefing /summary /help",
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

    if command_text.lower().startswith("/etfcheck"):
        handle_etfcheck_command(token, chat_id)
        return

    replies = handle_telegram_message(command_text, chat_id)
    if not isinstance(replies, list):
        replies = [replies]

    for reply in replies:
        send_reply(token, chat_id, reply)


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


def handle_etfcheck_command(token: str, chat_id: int) -> None:
    if not _etfcheck_command_lock.acquire(blocking=False):
        send_text(
            token,
            chat_id,
            "ETF CHECK capture is already running. Please wait for it to finish.",
        )
        return

    def worker() -> None:
        from etfcheck_pipeline import run_manual_etfcheck_capture

        try:
            send_text(token, chat_id, "Capturing ETF CHECK rankings from etfcheck.co.kr…")

            def deliver(message: dict) -> None:
                send_reply(token, chat_id, message)
                print(f"ETF CHECK message delivered to chat {chat_id}")

            run_manual_etfcheck_capture(deliver)
            print(f"ETF CHECK capture complete for chat {chat_id}")
        except Exception as exc:
            print(f"ETF CHECK capture failed for chat {chat_id}: {exc}")
            send_text(token, chat_id, f"ETF CHECK capture failed: {exc}")
        finally:
            _etfcheck_command_lock.release()

    threading.Thread(target=worker, name=f"etfcheck-{chat_id}", daemon=True).start()


def _ranking_loading_reply(universe: str) -> list[dict]:
    label = {"etf": "ETF", "sp": "S&P 500", "nas": "NASDAQ 100"}[universe]
    if is_cache_warmup_running(universe):
        return [{"text": f"{label} rankings are still loading. Please try again in a few minutes."}]
    start_universe_cache_warmup(universe)
    return [
        {
            "text": (
                f"Loading {label} rankings from Yahoo Finance now "
                f"(first run may take 2–5 minutes). Try /{universe} again shortly."
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
            from summary_builder import caches_ready, generate_and_save_summary

            if not caches_ready():
                return [{"text": "Summary is not ready yet. Ranking caches are still loading."}]
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
            )
            return [{"text": text} for text in messages]
        except Exception as exc:
            return [{"text": f"Error fetching news: {exc}"}]

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

    if lower.startswith(("/etf", "/sp", "/nas")):
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
            }
            text = format_rankings_message(universe=universe, mode=mode)
            responses = [{"text": text}]
            leader = get_top_leader_ticker(universe, mode)
            if leader:
                label = {"etf": "ETF", "sp": "S&P 500", "nas": "NASDAQ 100"}[universe]
                responses.append(
                    {
                        "text": f"📈 {label} top leader: {leader.upper()}",
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
                files={"photo": ("etfcheck.jpg", handle, "image/jpeg")},
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
            with path.open("rb") as handle:
                response = requests.post(
                    f"https://api.telegram.org/bot{token}/sendDocument",
                    data=data,
                    files={"document": (path.name, handle)},
                    timeout=120,
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

    send_text(token, chat_id, text, parse_mode=parse_mode)


def start_web_server():
    port = int(os.environ.get("PORT", "8080"))

    class AppHandler(BaseHTTPRequestHandler):
        def do_GET(self):
            path = urlparse(self.path).path
            if path in {"/", "/health"}:
                body = b"ok"
                content_type = "text/plain; charset=utf-8"
            elif path == "/summary":
                from summary_builder import load_summary_html

                body_text = load_summary_html()
                if not body_text:
                    body_text = (
                        "<html><body><p>Summary not generated yet. "
                        "Use /summary in Telegram or wait for the scheduled brief.</p></body></html>"
                    )
                body = body_text.encode("utf-8")
                content_type = "text/html; charset=utf-8"
            else:
                self.send_response(404)
                self.end_headers()
                self.wfile.write(b"not found")
                return

            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, format, *args):
            return

    server = HTTPServer(("0.0.0.0", port), AppHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    print(f"Web server listening on port {port} ( /summary )")


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


def _skip_startup_etfcheck(command_text: str) -> bool:
    if os.environ.get("BOT_SKIP_STARTUP_ETFCHECK", "true").lower() in {"0", "false", "no"}:
        return False
    return command_text.strip().lower().startswith("/etfcheck")


def start_telegram_bot(token: str):
    global _bot_username
    _bot_username = fetch_bot_username(token)
    if _bot_username:
        print(f"Bot username: @{_bot_username}")

    print("Starting Telegram bot...")
    pending_updates, last_update_id = fetch_pending_updates(token)
    broadcast_startup_guide(token, chat_ids_from_updates(pending_updates))

    for update in pending_updates:
        message = extract_incoming_message(update)
        if message:
            command_text = normalize_command_text(message.get("text", ""))
            if _skip_startup_etfcheck(command_text):
                print("Skipping queued /etfcheck from startup backlog (manual only after bot is online).")
                continue
        process_telegram_update(token, update)

    while True:
        try:
            params = {
                "allowed_updates": json.dumps(
                    [
                        "message",
                        "edited_message",
                        "channel_post",
                        "edited_channel_post",
                        "my_chat_member",
                    ]
                )
            }
            if last_update_id is not None:
                params["offset"] = last_update_id + 1

            response = requests.get(
                f"https://api.telegram.org/bot{token}/getUpdates",
                params=params,
                timeout=35,
            )
            response.raise_for_status()
            payload = response.json()

            if not payload.get("ok"):
                print(f"Telegram API error: {payload}")
                time.sleep(5)
                continue

            for update in payload.get("result", []):
                last_update_id = update["update_id"]
                process_telegram_update(token, update)

            time.sleep(1)

        except requests.RequestException as exc:
            print(f"Network error in bot loop: {exc}")
            time.sleep(5)
        except Exception as exc:
            print(f"Error in bot loop: {exc}")
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
    else:
        warmup_startup_caches()
        warmup_deferred_caches()
    start_summary_scheduler(
        token=token,
        broadcast_fn=broadcast_messages,
        refresh_cache_fn=warmup_all_caches,
        public_url=summary_public_url(),
    )
    start_macro_scheduler(token=token, broadcast_fn=broadcast_messages)
    start_etfcheck_scheduler(token=token, broadcast_fn=broadcast_messages)
    start_telegram_bot(token)
