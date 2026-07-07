import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import urlparse

import requests
from dotenv import load_dotenv

from analysis import analyze_crypto, analyze_stock, simulate_portfolio
from news_crawler import format_news_messages
from stock_crawler import (
    format_rankings_message,
    get_ranking_tickers,
    is_cache_ready,
    parse_rank_command,
    warmup_all_caches,
)
from summary_builder import caches_ready, generate_and_save_summary, load_summary_html
from summary_scheduler import start_summary_scheduler

PROJECT_DIR = Path(__file__).resolve().parent
ENV_FILE = PROJECT_DIR / ".env"
KNOWN_CHATS_FILE = PROJECT_DIR / "data" / "known_chats.json"
load_dotenv(ENV_FILE)

STARTUP_TEXT = """SavvyETF Bot is online.

What each command returns:

/port AAPL MSFT GOOGL
→ Portfolio backtest chart + technical chart per stock

/coin BTC
→ Crypto technical analysis chart

/etf 1mo price
→ Top 5 & bottom 5 ETFs by 1-month price return

/etf 1mo vol
→ Top 5 & bottom 5 ETFs by volume (1mo: latest day vs 1mo avg)

/sp 1mo price   (or /sp vol)
→ Same rankings for S&P 500 stocks

/nas 1mo vol
→ Same rankings for NASDAQ 100 stocks

/news
→ Headlines for tickers from your last /etf, /sp, or /nas result

/summary
→ ETF + S&P 500 + NASDAQ brief (price, volume, news)

Auto brief: 06:00 & 22:00 KST

Periods: 1mo | 3mo | 6mo | 12mo
Sort: price (return) | vol (1mo: latest/1mo avg; 3/6/12mo: 5d/period avg)

Type /help for the full command list.
"""

HELP_TEXT = """SavvyETF Bot — Commands

/port TICKER1 TICKER2 ...
  Portfolio backtest + TA chart per ticker.
  Example: /port AAPL MSFT GOOGL

/coin SYMBOL
  Crypto technical analysis chart.
  Example: /coin BTC

/etf PERIOD SORT
  Rank ~1,800 US equity ETFs (top 5 & bottom 5).
  Example: /etf 1mo price | /etf 12mo vol

/sp PERIOD SORT
  Rank S&P 500 stocks (top 5 & bottom 5).
  Example: /sp 1mo price | /sp vol

/nas PERIOD SORT
  Rank NASDAQ 100 stocks (top 5 & bottom 5).
  Example: /nas 1mo vol | /nas 12mo price

  PERIOD: 1mo | 3mo | 6mo | 12mo
  SORT:
    price — price return over period
    vol   — 1mo: latest day / 1mo avg
            3/6/12mo: 5d avg / period avg

  Shorthand (defaults: 1mo price):
    /etf | /etf vol
    /sp  | /sp vol
    /nas | /nas price

/news
  Headlines for the 10 tickers from your last ranking.
  Run /etf, /sp, or /nas first, then /news.

/summary
  Full market brief: ETF + S&P 500 + NASDAQ 100
  (price top/bottom 5, volume top/bottom 5, news).
  Web page: see SUMMARY_PUBLIC_URL or /summary on server.

  Auto-sent at 06:00 & 22:00 KST to subscribed chats.

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
    return chats


def send_text(token: str, chat_id: int, text: str, parse_mode: str | None = None) -> None:
    payload: dict = {"chat_id": chat_id, "text": text}
    if parse_mode:
        payload["parse_mode"] = parse_mode
    requests.post(
        f"https://api.telegram.org/bot{token}/sendMessage",
        json=payload,
        timeout=60,
    )


def _send_message_payload(token: str, chat_id: int, message: str | dict) -> None:
    if isinstance(message, dict):
        send_text(token, chat_id, message["text"], parse_mode=message.get("parse_mode"))
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


def fetch_pending_updates(token: str) -> tuple[list[dict], int | None]:
    response = requests.get(
        f"https://api.telegram.org/bot{token}/getUpdates",
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
        message = update.get("message") or update.get("edited_message")
        if message:
            chat_ids.add(message["chat"]["id"])
    return chat_ids


def process_telegram_update(token: str, update: dict) -> None:
    message = update.get("message") or update.get("edited_message")
    if not message or "text" not in message:
        return

    chat_id = message["chat"]["id"]
    save_known_chat(chat_id)
    maybe_send_deferred_startup_guide(token, chat_id)
    replies = handle_telegram_message(message["text"], chat_id)
    if not isinstance(replies, list):
        replies = [replies]

    for reply in replies:
        send_reply(token, chat_id, reply)


def send_startup_guide_to_chat(token: str, chat_id: int) -> bool:
    if chat_id in _greeted_this_session:
        return False
    try:
        send_text(token, chat_id, STARTUP_TEXT)
        _greeted_this_session.add(chat_id)
        save_known_chat(chat_id)
        print(f"Startup guide sent to chat {chat_id}")
        return True
    except requests.RequestException as exc:
        print(f"Failed to send startup guide to {chat_id}: {exc}")
        return False


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


def handle_telegram_message(message, chat_id: int):
    normalized = message.strip()
    lower = normalized.lower()

    if lower in {"/help", "/start", "help"}:
        return [{"text": HELP_TEXT}]

    if lower.startswith("/summary"):
        try:
            if not caches_ready():
                return [{"text": "Summary is not ready yet. Ranking caches are still loading."}]
            summary = generate_and_save_summary(public_url=summary_public_url())
            return summary["telegram_messages"]
        except Exception as exc:
            return [{"text": f"Error building summary: {exc}"}]

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

    if normalized.startswith("/port"):
        try:
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
            universe, period, sort_by = parse_rank_command(normalized)
            if not is_cache_ready(universe):
                label = {"etf": "ETF", "sp": "S&P 500", "nas": "NASDAQ 100"}[universe]
                return [{"text": f"{label} rankings are still loading. Please try again in a few minutes."}]
            tickers, context_label = get_ranking_tickers(
                universe=universe,
                period=period,
                sort_by=sort_by,
            )
            _last_ranking_by_chat[chat_id] = {
                "tickers": tickers,
                "label": context_label,
            }
            text = format_rankings_message(universe=universe, period=period, sort_by=sort_by)
            return [{"text": text}]
        except ValueError as exc:
            return [{"text": f"Invalid command: {exc}\n\n{HELP_TEXT}"}]
        except Exception as exc:
            return [{"text": f"Error ranking stocks: {exc}"}]

    return [{"text": HELP_TEXT}]


def send_reply(token, chat_id, reply):
    send_text(token, chat_id, reply["text"], parse_mode=reply.get("parse_mode"))

    photo = reply.get("photo")
    if photo is not None:
        photo.seek(0)
        requests.post(
            f"https://api.telegram.org/bot{token}/sendPhoto",
            data={"chat_id": chat_id, "caption": "Analysis Chart"},
            files={"photo": ("chart.png", photo, "image/png")},
            timeout=60,
        )


def start_web_server():
    port = int(os.environ.get("PORT", "8080"))

    class AppHandler(BaseHTTPRequestHandler):
        def do_GET(self):
            path = urlparse(self.path).path
            if path in {"/", "/health"}:
                body = b"ok"
                content_type = "text/plain; charset=utf-8"
            elif path == "/summary":
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


def start_telegram_bot(token: str):
    print("Starting Telegram bot...")
    pending_updates, last_update_id = fetch_pending_updates(token)
    broadcast_startup_guide(token, chat_ids_from_updates(pending_updates))

    for update in pending_updates:
        process_telegram_update(token, update)

    while True:
        try:
            params = {}
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
    start_web_server()
    warmup_all_caches()
    start_summary_scheduler(
        token=token,
        broadcast_fn=broadcast_messages,
        refresh_cache_fn=warmup_all_caches,
        public_url=summary_public_url(),
    )
    start_telegram_bot(token)
