#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created .env from .env.example"
else
  echo ".env already exists"
fi

if [[ ! -d .venv ]]; then
  python3 -m venv .venv
  echo "Created virtual environment in .venv"
fi

source .venv/bin/activate
pip install -r requirements.txt

echo ""
echo "Next step: open .env and replace the placeholder with your Telegram bot token."
echo "Optional: set TELEGRAM_CHAT_ID so the bot sends a usage guide on startup."
echo "  File location: $(pwd)/.env"
echo ""
echo "Then start the bot with:"
echo "  source .venv/bin/activate && python bot.py"
