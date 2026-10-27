# 17. Cursor 인수인계 — 리밸런싱 백서 국내 그룹 예상 매일 갱신 (1단계, 2026-10-27)

- 작성: 2026-10-27 (Claude) · 받는 쪽: Cursor
- 대상 저장소: `/Users/wooyeol/GitHub/SavvyETF` (브랜치 `main`)
- 기준 커밋: `b24687b` (16번 반영 커밋)
- **Claude는 git을 쓰지 않았습니다.** 아래 파일은 작업 트리에 수정·추가만 된 상태입니다. 커밋·푸시·배포(Vercel 웹 + Render 봇)는 Cursor 몫입니다.

---

## 1. 무엇이 바뀌나

| | 전 | 후 |
|---|---|---|
| 국내 지수 그룹 11·12월 예상 (MSCI Korea, KOSPI200, KOSDAQ150, KOSPI200 IT, 2차전지, TOP2+, AI전력, K-반도체, 고배당, AI반도체핵심장비, 소부장 = 11개) | 번들 JSON, 10/16 고정 | **봇이 거래일 18:10 리밸런싱 작업 직후 다시 계산 → R2 `rebalance/whitepaper_live.json`**, 웹이 R2 우선으로 읽음 |
| 12월 집중 주간 합산 | 10/16 고정 | 위와 함께 매일 |
| 과거 실측 이력·해외 6개 그룹 예상·방법론 | 고정 | **그대로 고정** (2·4단계 대상) |
| 탭 상단 표시 | 항상 "고정 스냅샷" 경고 | R2 정상: `매일 갱신` 칩 + 마지막 계산 시각 / 4일 넘게 멈춤: `갱신 지연` 경고 / R2 못 읽음: 기존 고정 스냅샷 경고 |

매일 계산의 입력 (운용사 사이트 대량 크롤링 없음):
- 현재 비중: 그룹 대표 ETF의 **당일 운용사 PDF 1건씩**(TIGER 5·KODEX 4·HANARO·PLUS·SOL 각 1 = 11요청, KODEX 4초 간격, `m.samsungfund.com`). 당일 없으면 직전 평일 최대 5일.
  - Koscom ETF CHECK(`getEtfPdfRankListWeight`)는 **상위 10종목만** 줘서 못 씀(확인함), 네이버 PC ETF 페이지 구성자산 표는 현재 파싱 실패.
- 시가총액·종가: 네이버 `m.stock.naver.com/api/stocks/marketValue/{KOSPI|KOSDAQ}` 페이지(보통주), 우선주 등은 네이버 실시간 시세
- 그룹 AUM: 네이버 `finance.naver.com/api/sise/etfItemList.nhn` 1요청
- 20일 평균 거래대금: 네이버 일봉(같은 날 `fetch.py` 가 만든 `Claude_Work/data/adv.json` 재사용, 나머지만 조회)
- 고정 입력: `Claude_Work/data/whitepaper_static.json` — 이벤트·매매일·교체 규칙·적합된 가중 규칙·종목 유동비율/WICS/배당수익률(2,006종목, 10/16 수집)

매매일이 지난 이벤트는 다시 계산하지 않고 **직전 R2 값(매매일 전 마지막 계산)** 을 `frozen` 으로 유지. 그룹 하나가 실패하면 그 그룹만 직전 값(`stale`, 화면 `직전 값` 태그), 나머지는 계속.

## 2. 바뀐 파일 (커밋 대상)

| 파일 | 상태 | 내용 |
|---|---|---|
| `Claude_Work/rebalance/wp_forecast.py` | 신규 | `research/rebalance_whitepaper/forward2.py` 를 날짜 인자·봇 데이터 소스로 옮김. `build(day, prev)`, `run(upload)`, CLI `python -m Claude_Work.rebalance.wp_forecast [--upload]` |
| `Claude_Work/data/whitepaper_static.json` | 신규 (107KB) | 고정 입력. `research/rebalance_whitepaper/export_wp_static.py` 출력 |
| `Claude_Work/.gitignore` | 수정 | `data/whitepaper_live.json`(로컬 계산 결과) 제외 |
| `09_매매/rebalance_scheduler.py` | 수정 | `_run_wp_forecast()` 추가, `run_scheduled_rebalance()` 본 작업 R2 업로드 뒤 호출(같은 heavy-work 구간). 실패해도 본 작업 결과 유지. `WP_FORECAST_ENABLED=false` 로 끌 수 있음. 상태 `last_wp_forecast_ok_at/as_of/error` |
| `01_봇/bot.py` | 수정 | `/health` scheduler 블록에 위 3개 상태 키 추가 |
| `webapp/src/lib/rebalanceWhitepaperLive.ts` | 신규 | `WP_LIVE_R2_KEY`, `mergeLive(base, live)` — 번들 위에 국내 그룹 예상·그룹 fc 이벤트·합산을 덮음(export_webapp.py 와 같은 변환) |
| `webapp/src/app/api/rebalance/whitepaper/route.ts` | 수정 | `force-static` → `force-dynamic` + `withServerCache`(5분) + `cdnCacheHeader("etfSlow")`. R2 → (dev 전용) `../Claude_Work/data/whitepaper_live.json` → 번들 순. 응답에 `whitepaper.live` 메타 |
| `webapp/src/lib/rebalance.ts` | 수정 | `WhitepaperLiveDoc`, `WhitepaperLiveMeta`, `RebalanceWhitepaper.live?`, `AddendumEvent.frozen?/stale?` |
| `webapp/src/components/RebalanceWhitepaper.tsx` | 수정 | 상단 칩·안내문을 `live` 기준으로 분기, `직전 값` 태그, 지난 행 문구를 "매매일 전 마지막 예상(PDF 날짜)"로 |
| `webapp/src/components/RebalanceTab.tsx` | 수정 | 백서 fetch 에 `{ cache: "no-cache" }` — 예전 라우트의 1일 캐시 헤더 때문에 브라우저가 옛 응답을 재사용하는 것 방지 |
| `webapp/src/app/globals.css` | 수정 | `.rb-wp-livenote` |
| `Claude_DB/docs/17_Cursor_인수인계_리밸런싱백서_매일갱신.md` | 신규 | 이 문서 |

`research/rebalance_whitepaper/export_wp_static.py`(신규)는 research 폴더라 커밋 대상 아님(로컬 전용, §6).

## 3. 검증 완료
- `python -m py_compile` (wp_forecast, rebalance_scheduler, export_wp_static) 통과
- `cd webapp && npx tsc --noEmit -p .` 통과, `npm run -s check:imports` → `ok (413 files)`
- **로컬 실계산** (`PYTHONPATH=10_공통:03_ETF:. .venv-sf/bin/python -m Claude_Work.rebalance.wp_forecast`, 10/27 08:46, 116초, 오류 0): 11개 그룹 모두 당일 PDF(20261027)로 계산
  | 그룹 | 10/16 백서 | 10/27 재계산 |
  |---|---|---|
  | MSCI Korea | 회전율 0.55% · 매수 309억 · 편입 고려아연·삼성E&A | 0.62% · 340억 · 같은 2종목 |
  | KOSPI200 | 0.47% · 2,112억 · 8/8 | 0.45% · 2,034억 · 같은 8/8 |
  | KOSDAQ150 | 7.95% · 4,639억 | 7.89% · 4,158억 (후보 일부 교체: 주가 변화) |
  | 고배당주 | 23.32% · 5,268억 | 23.85% · 5,076억 |
  | AI반도체핵심장비(범위) | 1,566억 | 1,331억 (AUM 감소) |
- 오프라인 시뮬레이션: `build(day=2026-12-01, prev=…)` 에서 전 그룹 계산 실패를 가정 → MSCI Korea(11/30) `frozen`, 나머지 `stale` 로 직전 값 유지, 합산 정상
- 로컬 `next dev` `?tab=rebalance`: `/api/rebalance/whitepaper` 의 `live.source = "r2"`(dev 파일 대체), 상단 `매일 갱신` 칩·"마지막 계산 2026-10-27 08:46" 안내, MSCI Korea 행 340억, 런타임 오류 없음. R2 를 못 읽는 경우의 고정 스냅샷 경고문도 표시 확인

## 4. 검증하지 못한 것 / 주의
- **Render 에서의 실제 18:10 실행·R2 업로드** (로컬엔 R2 키 없음). 배포 다음 거래일 18:30 이후 확인:
  - `https://savvyetf-bot.onrender.com/health` → `last_wp_forecast_ok_at` 당일, `last_wp_forecast_error` `null`
  - `https://savvyetf.com/api/rebalance/whitepaper` → `whitepaper.live.source == "r2"`, `live.as_of` 당일
  - 배포 직후엔 본 리밸런싱 R2 가 이미 최신이면 부트스트랩이 돌지 않으므로 **첫 실행은 다음 18:10 슬롯**. 그때까지 웹은 번들(고정 스냅샷 경고)로 보임
- **Render IP 에서 운용사 사이트 응답** — 로컬에선 11요청 모두 정상. KODEX(`m.samsungfund.com`) Cloudflare, SOL 403 가능성 있음 → 실패 그룹은 `직전 값`으로 표시되고 `/health` `last_wp_forecast_error` 에 그룹명이 남음
- 실행 시간: 로컬 116초(대부분 네이버 일봉 ~500종목). 본 리밸런싱 작업과 같은 heavy-work 구간에서 돎
- **유동비율은 10/16 값 고정**(분기 갱신은 2단계). 신규 상장·유동비율 캐시에 없는 종목은 MSCI 커버리지 계산에서 빠짐
- **이벤트 날짜는 이번 주기(11/30~12/15)로 고정.** 2027년 상반기 주기는 `export_wp_static.py` 의 `EVENTS`·`COMBINED_WINDOW` 를 바꾸고 가중 규칙을 다시 적합한 뒤 재출력해야 함. 12/15 이후엔 모든 이벤트가 `frozen` 이 되어 더 바뀌지 않음
- 16번의 `NOT_REFLECTED.NDX`(ANT 안내)는 해외 그룹이라 이번 매일 갱신 대상이 아님 — 그대로 유지
- Vercel CDN 은 배포 시 비워지지만, 예전 라우트(`s-maxage=86400, stale-while-revalidate=604800`)를 받은 브라우저 캐시는 남을 수 있어 탭 fetch 에 `no-cache` 를 넣었음

## 5. 커밋 방법

```bash
cd /Users/wooyeol/GitHub/SavvyETF
cd webapp && npm run build && cd ..   # 로컬 dev 서버를 끄고 실행 (같은 .next 를 쓰면 dev 가 깨짐)
git add Claude_Work/rebalance/wp_forecast.py Claude_Work/data/whitepaper_static.json Claude_Work/.gitignore \
  "09_매매/rebalance_scheduler.py" "01_봇/bot.py" \
  webapp/src/lib/rebalanceWhitepaperLive.ts webapp/src/app/api/rebalance/whitepaper/route.ts \
  webapp/src/lib/rebalance.ts webapp/src/components/RebalanceWhitepaper.tsx webapp/src/components/RebalanceTab.tsx \
  webapp/src/app/globals.css \
  "Claude_DB/docs/17_Cursor_인수인계_리밸런싱백서_매일갱신.md"
git commit -m "feat(rebalance): recompute the whitepaper's domestic group forecasts daily in the 18:10 bot job and serve them from R2"
```

`01_봇/bot.py` 는 3줄 추가뿐인지 `git diff "01_봇/bot.py"` 로 확인. 웹(Vercel)과 봇(Render) 둘 다 배포돼야 함.

이번 범위 밖(건드리지 말 것): `.next/`, 루트 `package-lock.json`, `00_exports/`, `11_받은자료/`, `research/*`, `.claude/`, `Claude_DB/docs/08_…` 수정분, `11_…`·`12_…` 인수인계서.

## 6. 고정 입력 다시 만들기 (로컬)

```bash
cd research/rebalance_whitepaper
python3 forward2.py          # 가중 규칙 재적합 → out/addendum.json (정기변경이 끝난 뒤)
python3 export_wp_static.py  # → Claude_Work/data/whitepaper_static.json
```

## 7. 완료 기준
- 배포 다음 거래일 18:30 이후 `/api/rebalance/whitepaper` 의 `whitepaper.live.source` 가 `"r2"`, `live.as_of` 가 그날
- 탭 상단에 `매일 갱신` 칩, 예상 표 숫자가 날마다 바뀜(예: MSCI Korea 매수 규모)
- `/health` 의 `last_wp_forecast_ok_at` 이 그날

## 8. 다음 단계 (이번에 안 함)
- 2단계: 유동비율 캐시(wisereport) 분기 자동 갱신 → `whitepaper_static.json` 대신 R2
- 3단계: 매매일이 지나면 전후 PDF 비교로 실측 이벤트를 이력에 자동 추가 + 예상 대비 오차 표시
- 4단계: 해외 6개 그룹(`overseas.py`, 미국 시세) 매일 갱신
- 다음 주기 이벤트 날짜를 규칙(KRX 6·12월 둘째 목요일, MSCI 2·5·8·11월 말 영업일)으로 자동 생성
