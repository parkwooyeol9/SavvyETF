# 18. Cursor 인수인계 — 웹 보안 점검: Next 업데이트 · API 브라우저 전용 · 봇 차단 · 복사 방지 (2026-10-27)

- 작성: 2026-10-27 (Claude) · 받는 쪽: Cursor
- 대상 저장소: `/Users/wooyeol/GitHub/SavvyETF` (브랜치 `main`)
- 기준 커밋: `eeb55ab`
- **Claude는 git을 쓰지 않았습니다.** 아래 파일은 작업 트리에 수정·추가만 된 상태입니다. 커밋·푸시·Vercel 배포는 Cursor 몫입니다.
- 이 작업은 `webapp/` 만 건드립니다. 봇(Render)·`Claude_Work`·`Claude_DB` 코드는 그대로입니다.

---

## 1. 배경 (운영 사이트 savvyetf.com 점검 결과)

| 항목 | 점검 당시 | 이번 조치 |
|---|---|---|
| Next.js | 15.5.20 — 치명적 경고 3건(이미지 최적화 원격 코드 실행 등), high 다수 | **15.5.28** |
| 공개 API | `curl`·`python-requests`로 `/api/rebalance`(72KB), `/api/index-monitor`(93KB) 등을 그대로 받음 | **같은 사이트 페이지의 요청만 허용**, 나머지 403 |
| 봇 | `robots.txt`(권고)만 있음, GPTBot·Scrapy도 200 | **스크래퍼·AI 크롤러 UA 403** (검색엔진·링크 미리보기는 허용) |
| 드래그·복사 | 막는 장치 없음 | **선택·복사·잘라내기·드래그·우클릭 차단** (입력칸·관리자는 예외) |
| `X-Powered-By: Next.js` | 노출 | **제거** |
| PHP | 저장소에 `.php` 0개, `/index.php` 등은 Vercel이 403 | 해당 없음 (조치 불필요) |

헤더는 위조할 수 있으므로 이 차단은 일반적인 무단 수집(스크립트·크롤러·드래그 복사)을 막는 수준입니다. 관리자 전용 데이터는 기존처럼 각 라우트의 `requireSiteAdmin`이 지킵니다.

## 2. 바뀐 파일 (커밋 대상)

| 파일 | 상태 | 내용 |
|---|---|---|
| `webapp/src/lib/botGate.ts` | 신규 | `checkAccess(request, pathname, host)` — 엣지 런타임용 차단 판단. 아래 3절 규칙 |
| `webapp/src/middleware.ts` | 수정 | 보안 헤더 설정 직후·요청 횟수 제한 전에 `checkAccess` 호출, 막히면 403 JSON(`Cache-Control: private, no-store`, `X-Robots-Tag: noindex, nofollow`) |
| `webapp/src/app/api/cron/warm-cache/route.ts` | 수정 | 자기 API를 미리 데우는 내부 fetch에 `Authorization: Bearer $CRON_SECRET` 추가 (없으면 새 차단에 걸림) |
| `webapp/src/components/CopyGuard.tsx` | 신규 | 문서 전체에서 `copy`·`cut`·`selectstart`·`dragstart`·`contextmenu` 차단. 입력칸·`[data-allow-copy]`·관리자 세션은 예외, 링크 위 우클릭은 허용 |
| `webapp/src/app/layout.tsx` | 수정 | `<CopyGuard />` 마운트 |
| `webapp/src/app/globals.css` | 수정 | `body { user-select: none }`, `img { -webkit-user-drag: none }`, 예외: `html.copy-ok`(관리자)·input·textarea·contenteditable·`[data-allow-copy]` |
| `webapp/next.config.ts` | 수정 | `poweredByHeader: false` |
| `webapp/package.json`, `package-lock.json` | 수정 | `next` ^15.3.3 → ^15.5.28 (설치 15.5.28), `npm audit fix`(호환 범위 내: sharp·nanoid·source-map-js 등) |

## 3. 차단 규칙 (`botGate.ts`)

순서대로 판단합니다.

1. `/robots.txt` → 항상 허용 (크롤러가 규칙을 읽을 수 있게)
2. 예외 API → 허용: `/api/cron/*`, `/api/ingest`, `/api/private-upload`, `/api/tv/oauth/*`, `/api/briefs/media/*`
   - cron·ingest·private-upload는 자체 비밀키 확인, OAuth 콜백은 TradingView에서 넘어오는 교차 사이트 이동, 브리프 이미지는 `sandbox=""` iframe(출처 없음)에서 불림
3. `/api/*` 에 `Authorization: Bearer $CRON_SECRET` 이 맞으면 허용 (서버 간 자기 호출: warm-cache, us-midterm-refresh)
4. UA가 비었거나 차단 목록에 걸리면 **403** — 페이지·API 모두
   - 차단: GPTBot·ChatGPT-User·ClaudeBot·CCBot·PerplexityBot·Bytespider·Amazonbot·meta-externalagent 등 AI 크롤러, Ahrefs·Semrush·MJ12 등 SEO 수집기, curl·wget·python-requests·aiohttp·httpx·Scrapy·Go·Java·okhttp·axios·node·Postman 등 HTTP 도구, HeadlessChrome·Puppeteer·Playwright·Selenium
   - 허용: Googlebot·Bingbot·Yeti(네이버)·Daum 등 검색엔진, 카카오톡·슬랙·텔레그램 링크 미리보기 (페이지만. API는 5번에서 막힘)
5. `/api/*` GET·HEAD는 같은 사이트 페이지에서 온 요청만 허용
   - `Sec-Fetch-Site` 가 `same-origin`/`same-site` 이면 허용
   - 이 헤더가 없는 구형 브라우저는 `Origin` 또는 `Referer` 호스트가 요청 호스트와 같으면 허용
   - 주소창에 API URL을 직접 치는 경우(`Sec-Fetch-Site: none`)도 403
6. POST·DELETE·PATCH는 기존처럼 각 라우트 인증 + 요청 횟수 제한

엑셀 다운로드는 브라우저가 API 데이터를 받아 파일을 만들거나 같은 사이트 링크로 받으므로 그대로 동작합니다.

## 4. 검증 (Claude가 한 것)

다른 세션의 개발 서버와 겹치지 않도록 webapp 사본을 임시 폴더에서 `npm run build`(성공) → `next start` 로 확인했습니다.

| 요청 | 결과 |
|---|---|
| 페이지, Chrome UA / Googlebot | 200 / 200 |
| 페이지, curl / GPTBot / 빈 UA | 403 / 403 / 403 |
| API, Chrome UA + 헤더 없음 / `Sec-Fetch-Site: cross-site` | 403 / 403 |
| API, `Sec-Fetch-Site: same-origin` / 자기 사이트 Referer | 200 / 200 |
| API, python-requests (same-origin 헤더 위조해도) | 403 |
| API, `node` UA + 맞는 CRON_SECRET / 틀린 값 | 200 / 403 |
| `/api/cron/warm-cache` 맞는 CRON_SECRET (하위 호출 포함) | 200 |
| `POST /api/ingest`, python UA | 차단 안 됨 (라우트 자체 응답) |
| `robots.txt`, curl | 200 |
| `X-Powered-By` | 없음 |
| 브라우저: 홈 화면 API(heatmap·why-etf·briefs) | 모두 200, 403 0건 |
| 브라우저: 본문 copy·우클릭 / 관리자 세션 copy | 차단 / 허용 |

`npx tsc --noEmit` 통과.

**확인 못 한 것:** 운영(Vercel) 실제 배포 후 동작, 모든 탭을 하나씩 열어 보는 것, Safari·모바일 실기기.

## 5. 배포 후 Cursor가 확인할 것

1. Vercel 환경변수 `CRON_SECRET` 이 설정돼 있는지 (cron이 이미 쓰고 있으면 OK). 없으면 warm-cache가 데우는 API들이 403 → 캐시 예열만 실패하고 사이트 동작은 그대로
2. 배포 후 아래가 기대대로인지:
   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" https://savvyetf.com/api/rebalance
   ```
   → 403
   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" https://savvyetf.com/robots.txt
   ```
   → 200
3. 브라우저로 주요 탭(리밸런싱·인덱스 모니터·ETF DB·ESG·AI 시황·북클럽 iframe·리서치 PDF·관리자 금고) 열어 콘솔에 403 없는지
4. Vercel 로그에서 `/api/cron/warm-cache` 응답의 하위 경로 status가 200인지
5. 문제 생기면 `middleware.ts` 의 `checkAccess` 호출 블록만 주석 처리하면 즉시 원복 (복사 방지는 `layout.tsx` 의 `<CopyGuard />` 와 `globals.css` 블록)

## 6. 남은 일 (이번에 안 함)

| 우선 | 항목 | 비고 |
|---|---|---|
| 권장 | Vercel 대시보드 → Firewall: Bot Protection(managed ruleset) 켜기, `/api/*` IP별 요청 제한 규칙 추가 | 코드가 아니라 대시보드 설정. 현재 요청 제한은 서버 인스턴스별 메모리라 분산 수집에 약함 |
| 중간 | `npm audit` 잔여 5건: `postcss`(Next 내장, 빌드 시에만 사용) → Next 16 필요 / `undici`·`@fastify/busboy` → 구버전 `@vercel/blob` 1.x 하위 의존성, 2.x는 메이저 업 | `@vercel/blob` 은 `src/lib/briefs.ts` 의 레거시 경로에서만 사용. R2로 완전 이전했으면 의존성 제거가 가장 깔끔 |
| 중간 | CSP `script-src` 의 `'unsafe-eval'`·`'unsafe-inline'` | 관리자 비밀번호가 `sessionStorage` 에 있어 XSS 시 탈취 위험. nonce 방식 검토 |
| 낮음 | `webapp/supabase/money_flow.sql` 에 RLS 없음 | 현재 미사용(R2). Supabase에 적용할 때 RLS 필수 |
| 낮음 | 관리자 인증 = 고정 비밀번호, 실패 잠금도 인스턴스별 | 비밀번호를 길고 무작위로 유지 |

## 7. 커밋 메시지 제안

```
feat(web): gate public APIs to same-site pages, block scraper/AI crawler UAs, add copy guard

- middleware: botGate.checkAccess — 403 for blocked UAs and cross-origin API GETs;
  cron/ingest/private-upload/tv-oauth/briefs-media exempt, CRON_SECRET bearer for self-calls
- warm-cache sends the cron bearer on its self-fetches
- CopyGuard + user-select:none (inputs, [data-allow-copy], admin session exempt)
- next 15.5.20 → 15.5.28 (critical image-optimizer RCE advisories), npm audit fix
- poweredByHeader: false
```
