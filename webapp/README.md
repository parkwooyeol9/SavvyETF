# SavvyETF dashboard (Vercel)

Tabs:

| Tab | Contents |
|-----|----------|
| **메인** | ETF/S&P/Nasdaq 히트맵 + “왜 ETF인가” 실데이터 비교 차트 |
| **교육** | 한국 투자자 세금·계좌·환율 + 원/달러 차트 |
| 국내시황 | `summary_kor`, `summary_kor_intra`, `summary_nxt` |
| 미국시황 | `summary`, `summary_pre`, `reddit` |
| ETF시황 | `etf_sector`, `etf_us_new`, `etfcheck`, `etf_memb` |
| ESG시황 | `esg_accident`, `esg_overview` |

시황 탭은 Render Telegram 봇이 **Cloudflare R2**(권장) 또는 `/api/ingest`로 푸시합니다.
메인 히트맵·시뮬레이션·why-ETF는 Vercel이 Yahoo Finance로 직접 계산합니다.

## 1. Deploy to Vercel

```bash
cd webapp
npm install
npx vercel          # first deploy → note the *.vercel.app URL
npx vercel --prod
```

Prefer project name `savvyetf` → `https://savvyetf.vercel.app`.

## 2. Environment (Vercel)

| Name | Value |
|------|--------|
| `WEB_INGEST_SECRET` | long random string (same as Render) |
| `R2_ACCOUNT_ID` | Cloudflare account id |
| `R2_ACCESS_KEY_ID` | R2 API token access key |
| `R2_SECRET_ACCESS_KEY` | R2 API token secret |
| `R2_BUCKET_NAME` | e.g. `savvyetf-briefs` |
| `R2_PUBLIC_BASE_URL` | optional `https://pub-….r2.dev` (else media proxy) |
| `RENDER_BOT_URL` | `https://savvyetf-bot.onrender.com` (optional) |
| `BLOB_READ_WRITE_TOKEN` | **optional legacy** — not required if R2 is set |

### R2 setup (≈ $0 / month for this app)

1. Cloudflare dashboard → R2 → Create bucket `savvyetf-briefs`
2. Manage R2 API Tokens → Create token (Object Read & Write on that bucket)
3. Optional: bucket Settings → Public access → R2.dev subdomain → copy into `R2_PUBLIC_BASE_URL`
4. Put the same `R2_*` vars on **both** Vercel and Render

Image keys are stable (`briefs/images/{tab}/{slot}/{id}.png`); each publish overwrites and **GCs orphan versioned PNGs** under that slot.

## 3. Point the bot at the dashboard (Render)

| Name | Value |
|------|--------|
| `WEB_PUBLISH_URL` | `https://savvyetf.vercel.app/api/ingest` |
| `WEB_INGEST_SECRET` | same secret as Vercel |
| `R2_*` | same as Vercel (bot writes R2 directly too) |

Do **not** need Vercel Pro for this — Hobby + R2 free tier is enough under ~$10/mo budget.

## API

- `POST /api/ingest` — bot snapshot ingest (writes R2 when configured)
- `GET /api/briefs` — all brief tabs (`source`: `r2` \| `blob` \| `render` \| …)
- `GET /api/briefs/media/briefs/...` — private-bucket PNG proxy
- `GET /api/heatmap?universe=etf\|sp\|nas` — proxy to Render heatmap
- `POST /api/simulate` — `{ tickers, weights?, start_date?, initial_capital?, benchmark? }`
- `GET /api/why-etf` — preset diversification / allocation charts
- `GET /api/catalog` — ETF picker list

### Render bot (source for heatmap)

- `GET /api/web/heatmap`
- `GET /api/web/heatmap.png`
- `POST /api/web/simulate`
- `GET /api/web/why-etf`
- `GET /api/web/catalog`
