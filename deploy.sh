#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if [[ ! -f .env ]]; then
  echo "Missing .env file. Run: bash setup.sh"
  exit 1
fi

# shellcheck disable=SC1091
source .env

if [[ -z "${TELEGRAM_BOT_TOKEN:-}" || "${TELEGRAM_BOT_TOKEN}" == "your_bot_token_from_botfather" ]]; then
  echo "Set TELEGRAM_BOT_TOKEN in .env before deploying."
  exit 1
fi

if ! command -v fly >/dev/null 2>&1; then
  echo "Installing Fly.io CLI..."
  brew install flyctl
fi

if ! fly auth whoami >/dev/null 2>&1; then
  echo "Log in to Fly.io first:"
  echo "  fly auth login"
  exit 1
fi

if [[ ! -f fly.toml ]]; then
  fly launch --yes --no-deploy --name savvyetf-bot --region sin --copy-config
fi

fly secrets set "TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}"
fly deploy

echo ""
echo "Deployed. Stop any local bot instance to avoid Telegram polling conflicts."
echo "Check status: fly status"
echo "View logs:    fly logs"
