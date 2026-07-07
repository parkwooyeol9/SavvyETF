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

## Deploy 24/7 on Render

Your code is on GitHub at [parkwooyeol9/SavvyETF](https://github.com/parkwooyeol9/SavvyETF). Render will run it as a **Background Worker** so the bot stays online without your PC.

### Step-by-step

1. **Stop the local bot** if it is running (`Ctrl+C` in the terminal). Only one instance can use the same Telegram token.

2. Go to [dashboard.render.com](https://dashboard.render.com) and sign in (use **GitHub** to connect your account).

3. Click **New +** → **Blueprint**.

4. Connect the repository **`parkwooyeol9/SavvyETF`**.

5. Render will read `render.yaml` and show a **Background Worker** named `savvyetf-bot`.

6. When prompted, set the secret environment variable:
   - **Key:** `TELEGRAM_BOT_TOKEN`
   - **Value:** your bot token from [@BotFather](https://t.me/BotFather)

7. Click **Apply**. Render builds the Docker image and starts the worker.

8. Open the service → **Logs**. You should see:
   ```
   Health check listening on port 8080
   Starting Telegram bot...
   ```

9. Test in Telegram: send `/coin BTC` or `/port AAPL MSFT`.

### Notes

- Render **Background Workers** need a **Starter** plan (about $7/month) to run 24/7. Free web services sleep; workers do not have a free always-on tier.
- To redeploy after code changes: push to `main` on GitHub → Render auto-deploys if enabled (on by default).
- Manage the token only in the Render dashboard (**Environment** tab), never in git.

### Manual setup (without Blueprint)

If you prefer not to use the blueprint:

1. **New +** → **Background Worker**
2. Connect `parkwooyeol9/SavvyETF`
3. Runtime: **Docker**
4. Add env var `TELEGRAM_BOT_TOKEN`
5. Create Worker

## Other hosting options

### Railway

1. [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub**
2. Select `parkwooyeol9/SavvyETF`
3. Add `TELEGRAM_BOT_TOKEN`
4. Deploy

### Any VPS (Oracle Cloud free tier, DigitalOcean, etc.)

```bash
git clone https://github.com/parkwooyeol9/SavvyETF.git
cd SavvyETF
docker build -t savvyetf-bot .
docker run -d --restart unless-stopped -e TELEGRAM_BOT_TOKEN=your_token savvyetf-bot
```

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
