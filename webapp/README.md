# SavvyETF dashboard (Vercel)

4-tab read-only market brief dashboard:

| Tab | Slots (from Telegram bot) |
|-----|---------------------------|
| 국내시황 | `summary_kor`, `summary_kor_intra`, `summary_nxt` |
| 미국시황 | `summary`, `summary_pre`, `reddit` |
| ETF시황 | `etf_sector`, `etfcheck` |
| ESG시황 | `esg_accident`, `esg_overview` |

The Render Telegram bot POSTs snapshots to `/api/ingest` after each brief. The page polls `/api/briefs` every 60s.

## 1. Deploy to Vercel

```bash
cd webapp
npm install
npx vercel          # first deploy → note the *.vercel.app URL
npx vercel --prod
```

Prefer project name `savvyetf` so the URL is `https://savvyetf.vercel.app` (if taken, Vercel will suggest another).

## 2. Create Vercel Blob store

1. Vercel Dashboard → Project → **Storage** → Create **Blob**
2. Connect the store to this project (adds `BLOB_READ_WRITE_TOKEN`)
3. Redeploy so the token is available to serverless functions

## 3. Set ingest secret (Vercel)

In Project → Settings → Environment Variables:

| Name | Value |
|------|--------|
| `WEB_INGEST_SECRET` | long random string (same as Render) |
| `BLOB_READ_WRITE_TOKEN` | (auto from Blob store) |

Redeploy after adding env vars.

## 4. Point the bot at the dashboard (Render)

In Render → `savvyetf-bot` → Environment:

| Name | Value |
|------|--------|
| `WEB_PUBLISH_URL` | `https://<your-project>.vercel.app/api/ingest` |
| `WEB_INGEST_SECRET` | same secret as Vercel |

After the next scheduled or manual `/summary`, `/summary_kor`, `/etf_sector`, `/etfcheck`, `/esg …`, the matching tab updates without redeploying Vercel.

## 5. Custom domain (SavvyETF.com)

Vercel does **not** include a free `SavvyETF.com` — free URLs are `*.vercel.app`.

To attach a custom domain later:

1. Vercel → Project → **Domains** → Add `savvyetf.com` (and `www`)
2. Buy the domain in Vercel Domains **or** point an external registrar’s DNS to the records Vercel shows
3. Wait for TLS to provision — no code changes required

## Local dev

```bash
cd webapp
cp .env.example .env.local   # optional
npm run dev
```

Without Blob/token, the UI still loads with empty tabs (`configured: false`).

## API

- `POST /api/ingest` — `Authorization: Bearer $WEB_INGEST_SECRET`  
  Body: `{ tab, slot, generated_at, title, html?, sections?, meta? }`
- `GET /api/briefs` — all tabs
- `GET /api/briefs/[tab]` — one of `kr|us|etf|esg`
