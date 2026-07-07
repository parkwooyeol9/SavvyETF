import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import requests
from dotenv import load_dotenv

from analysis import analyze_crypto, analyze_stock, simulate_portfolio

PROJECT_DIR = Path(__file__).resolve().parent
ENV_FILE = PROJECT_DIR / ".env"
load_dotenv(ENV_FILE)

HELP_TEXT = (
    "Available commands:\n"
    "/port TICKER1 TICKER2 ... - Simulate stock portfolio\n"
    "/coin SYMBOL - Technical analysis for cryptocurrency"
)


def handle_telegram_message(message):
    if message.startswith("/port"):
        try:
            tickers = message.split()[1:]
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

    if message.startswith("/coin"):
        try:
            parts = message.split()
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
            return [{"text": f"Error analyzing cryptocurrency: {exc}"}]

    return [{"text": HELP_TEXT}]


def send_reply(token, chat_id, reply):
    requests.post(
        f"https://api.telegram.org/bot{token}/sendMessage",
        json={"chat_id": chat_id, "text": reply["text"]},
        timeout=30,
    )

    photo = reply.get("photo")
    if photo is not None:
        photo.seek(0)
        requests.post(
            f"https://api.telegram.org/bot{token}/sendPhoto",
            data={"chat_id": chat_id, "caption": "Analysis Chart"},
            files={"photo": ("chart.png", photo, "image/png")},
            timeout=60,
        )


def start_health_server():
    port = int(os.environ.get("PORT", "8080"))

    class HealthHandler(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"ok")

        def log_message(self, format, *args):
            return

    server = HTTPServer(("0.0.0.0", port), HealthHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    print(f"Health check listening on port {port}")


def start_telegram_bot():
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    placeholder = "your_bot_token_from_botfather"
    if not token or token == placeholder:
        if not ENV_FILE.exists():
            print(f".env file not found at: {ENV_FILE}")
            print("Run:  bash setup.sh")
        else:
            print(f"Edit {ENV_FILE} and set TELEGRAM_BOT_TOKEN to your token from @BotFather.")
        sys.exit(1)

    print("Starting Telegram bot...")
    last_update_id = None

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
                message = update.get("message") or update.get("edited_message")
                if not message or "text" not in message:
                    continue

                chat_id = message["chat"]["id"]
                replies = handle_telegram_message(message["text"])
                if not isinstance(replies, list):
                    replies = [replies]

                for reply in replies:
                    send_reply(token, chat_id, reply)

            time.sleep(1)

        except requests.RequestException as exc:
            print(f"Network error in bot loop: {exc}")
            time.sleep(5)
        except Exception as exc:
            print(f"Error in bot loop: {exc}")
            time.sleep(5)


if __name__ == "__main__":
    start_health_server()
    start_telegram_bot()
