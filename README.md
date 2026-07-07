# SavvyETF Telegram Bot

24/7 Telegram bot for stock portfolio simulation and crypto/stock technical analysis. Converted from the original Colab notebook (`tech_bot_coin+stock.ipynb`).

## Commands

| Command | Example | Description |
|---------|---------|-------------|
| `/port` | `/port AAPL MSFT GOOGL` | Portfolio backtest + per-ticker charts |
| `/coin` | `/coin BTC` | Crypto technical analysis chart |

## Why Colab stops working

Google Colab disconnects when idle, and any process tied to your PC stops when the machine sleeps or is off. This project runs as a **long-lived worker** on a cloud host instead.

## Quick start (local)

```bash
cd /Users/wooyeol/GitHub/SavvyETF
bash setup.sh
```

`setup.sh` creates `.env`, sets up `.venv`, and installs dependencies.

**Note:** `.env` is a hidden file (starts with `.`) and is gitignored, so it may not show in Finder or the file tree until you enable hidden files. In Cursor, open it directly: **File → Open** → `/Users/wooyeol/GitHub/SavvyETF/.env`

Edit `.env` and replace the placeholder with your token from [@BotFather](https://t.me/BotFather):

```
TELEGRAM_BOT_TOKEN=123456789:ABCdef...
```

Then start the bot:

```bash
source .venv/bin/activate
python bot.py
```

## Deploy 24/7 (recommended options)

### Option A: Render (easiest)

1. Push this repo to GitHub.
2. Go to [render.com](https://render.com) → **New** → **Blueprint** (or **Background Worker**).
3. Connect the repo. Render reads `render.yaml` and creates a **worker** service.
4. Set environment variable `TELEGRAM_BOT_TOKEN` in the Render dashboard.
5. Deploy. The worker runs continuously (Render workers require a paid plan; see free options below).

### Option B: Railway

1. Push to GitHub.
2. [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub**.
3. Add variable `TELEGRAM_BOT_TOKEN`.
4. Set start command: `python bot.py` (or use the Dockerfile).
5. Deploy.

### Option C: Fly.io (good free-tier VM)

```bash
fly launch --no-deploy
fly secrets set TELEGRAM_BOT_TOKEN=your_token
fly deploy
```

Use `fly.toml` with `app` process running `python bot.py` and `min_machines_running = 1`.

### Option D: Any VPS (Oracle Cloud free tier, DigitalOcean, etc.)

```bash
git clone <your-repo>
cd SavvyETF
docker build -t savvyetf-bot .
docker run -d --restart unless-stopped -e TELEGRAM_BOT_TOKEN=your_token savvyetf-bot
```

`--restart unless-stopped` keeps the bot running after reboots.

## Security

- **Do not commit your bot token.** Use `.env` locally and platform secrets in production.
- Your token appeared in the Colab notebook. In [@BotFather](https://t.me/BotFather), run `/revoke` and put the new token in `.env` / cloud secrets only.

## Project layout

```
SavvyETF/
├── bot.py              # Telegram polling loop
├── analysis.py         # Charts & indicators
├── requirements.txt
├── Dockerfile
├── render.yaml         # Render worker blueprint
└── tech_bot_coin+stock.ipynb  # Original Colab notebook
```
