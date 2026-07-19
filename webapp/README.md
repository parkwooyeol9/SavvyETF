# SavvyETF dashboard (Vercel)

Tabs:

| Tab | Contents |
|-----|----------|
| **메인** | ETF/S&P/Nasdaq 히트맵 + “왜 ETF인가” 실데이터 비교 차트 |
| **배분 시뮬레이션** | 시작일·ETF·비중 선택 → 누적성과·배분효과·기여도 |
| 국내시황 | `summary_kor`, `summary_kor_intra`, `summary_nxt` |
| 미국시황 | `summary`, `summary_pre`, `reddit` |
| ETF시황 | `etf_sector`, `etfcheck` |
| ESG시황 | `esg_accident`, `esg_overview` |

시황 탭은 Render Telegram 봇이 `/api/ingest`로 푸시합니다. 메인 히트맵은 봇의 `/api/web/heatmap`을 프록시합니다. 시뮬레이션·why-ETF 차트는 Vercel이 Yahoo Finance로 직접 계산합니다.

## 1. Deploy to Vercel

```bash
cd webapp
npm install
npx vercel          # first deploy → note the *.vercel.app URL
npx vercel --prod
```

Prefer project name `savvyetf` → `https://savvyetf.vercel.app`.

## 2. Environment

| Name | Value |
|------|--------|
| `WEB_INGEST_SECRET` | long random string (same as Render) |
| `BLOB_READ_WRITE_TOKEN` | from Vercel Blob store |
| `RENDER_BOT_URL` | `https://savvyetf-bot.onrender.com` (optional; default) |

## 3. Point the bot at the dashboard (Render)

| Name | Value |
|------|--------|
| `WEB_PUBLISH_URL` | `https://savvyetf.vercel.app/api/ingest` |
| `WEB_INGEST_SECRET` | same secret as Vercel |

## API

- `POST /api/ingest` — bot snapshot ingest
- `GET /api/briefs` — all brief tabs
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
