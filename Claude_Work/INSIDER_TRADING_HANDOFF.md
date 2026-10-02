# 내부자 매매 탭 — Cursor 인수인계 (2026-10-02)

교육 > **월가 구루** > 펀드 매니저 · 자금 흐름 · 13F · **내부자 매매**

미국 상장사 임원·이사·10% 대주주의 SEC Form 4에서 **장내 매수(P)·매도(S)** 만 추려
클러스터 매수, 경영진 매수, 순매수·순매도, 시장 전체 매수/매도 비율을 보여 주는 모니터링 탭.
1차 구현은 Cursor, 리뷰·보완은 Claude. **커밋 전 상태 — 아래 체크리스트를 Cursor에서 한 번 더 확인 후 커밋.**

## 1. 구조

```
Vercel cron */15 ─▶ /api/cron/insider-refresh (CRON_SECRET)
                      └─ runInsiderIngest(70s)            webapp/src/lib/insiderServer.ts
                           ├─ live: EDGAR getcurrent Atom (type=4, 4쪽×100)
                           ├─ backfill: daily-index form.YYYYMMDD.idx (첫 14일, offset 재개)
                           ├─ reconcile: 최근 4일 daily-index 재대조 (Atom 누락분 보충)
                           ├─ 각 공시 .txt → parseForm4 → P/S 만 R2 일자 샤드에 병합
                           └─ buildSummary → Yahoo 현재가·52주 고점(최대 25s) → summary.json
브라우저 ─▶ /api/insider             R2 summary.json (서버 캐시 1분)
        ─▶ /api/insider?ticker=X     EDGAR 실시간: company_tickers → submissions → 최근 Form 4 60건
        ─▶ /api/13f?tickers=A,B,…    13F 추적 기관 보유 여부 (티커 옆 "13F n" 배지)
```

R2 키 (`insider/us/`): `state.json`(진행 상태·seen·pending·done_days) · `summary.json` · `days/{YYYY-MM-DD}.json`

## 2. 파일

| 파일 | 역할 |
|---|---|
| `webapp/src/lib/insiderServer.ts` | SEC 호출(8req/s 페이싱), Form 4 파서, 수집·재대조, 요약 집계, 종목 조회 |
| `webapp/src/lib/insiderTrading.ts` | 공용 타입·라벨·포맷터 |
| `webapp/src/components/InsiderTradingTab.tsx` | 탭 UI |
| `webapp/src/app/api/insider/route.ts` | 요약 / 종목 조회 API |
| `webapp/src/app/api/cron/insider-refresh/route.ts` | 수집 cron |
| `webapp/src/lib/thirteenFServer.ts` · `api/13f/route.ts` | `holdersByTickers()` + `?tickers=` (13F 교차 배지) |
| `webapp/scripts/smoke-insider-parse.ts` | 오프라인 파서·집계 테스트 (네트워크 불필요) |
| `types.ts` · `Dashboard.tsx` · `lazyTabs.tsx` · `middleware.ts` · `vercel.json` · `globals.css` · `dataCatalog.ts` | 탭 배선, 레이트리밋, cron, 스타일, 적재 현황 등록 |

같이 들어간 탭 이름 변경: 상위 `펀드매니저`→**월가 구루**, 하위 `월가 구루`→**펀드 매니저** (`types.ts`, `WallStreetGurusTab.tsx` 제목, `cryptoAssets.ts` 안내문).

## 3. Claude 리뷰에서 고친 것

| 구분 | 문제 | 수정 |
|---|---|---|
| 데이터 누락 | 라이브 수집이 Atom 최신 400항목(공시마다 발행인·보고인 2줄 → 약 200건)뿐. 15분 사이 공시가 몰리면 누락되고 복구 경로가 없음 | 최근 4일을 daily-index로 재대조(`RECONCILE_DAYS`), 완료일은 `done_days`에 기록 |
| 데이터 누락 | SEC는 과호출 시 **403**을 주는데 공시 조회가 403을 "파일 없음"으로 처리, 실패 건도 seen 처리 → 조용히 유실 | 공시 조회는 404만 '없음', 403은 오류 → seen 제외 → 재대조에서 재시도 |
| 타임아웃 | Yahoo 120종목 × 15s 타임아웃 → cron이 maxDuration(120s) 초과 가능 | 가격 단계 상한 25s, 수집 예산 80→70s |
| 파서 | `NYSE: ABC`, `GOOGL, GOOG` 같은 티커, `10b5–1`(en dash) 각주 미인식 | `cleanTicker()`, `PLAN_RE` |
| 조회 표시 | 공시 60건 상한에 걸려도 "1년 이력"으로 표시 | `covered_from`·`truncated`·`failed` 추가, 실제 범위 표시 |
| MVP 보완 | 13F 교차 확인 없음 | 티커 옆 `13F n` 배지(툴팁: 기관명·비중) |
| MVP 보완 | 급락 후 매수 판단 근거 없음 | `52주 고점 대비` 열(−30% 이하 강조) |
| UI | 필터 없음, 차트 색 하드코딩, 투자권유 고지 없음 | 클러스터 "3명 이상만", 최신 매도 "10b5-1 제외"(기본 on), 테마 변수 색, 고지 문구 |
| 운영 | 적재 현황 탭에 미등록 | `dataCatalog.ts`에 `insider_us` 추가 |

## 4. 검증

- `tsc --noEmit` 통과, `scripts/check-import-graph.mjs` 통과
- `smoke-insider-parse.ts` 24개 체크 통과 (분할 체결 병합, 10b5-1 각주·aff10b5One, 경영진 판정, 클러스터·비율·순매수)
- **미검증**: 실제 SEC 수집(작업 환경에서 sec.gov 차단), `next build`(VM에 macOS용 SWC만 있음), 화면 렌더링

## 5. Cursor 체크리스트

1. `cd webapp && npx tsx scripts/smoke-insider-parse.ts` → `all checks passed`
2. `npm run build`
3. `npm run dev` → `/?tab=insider` 화면 확인 (R2 미설정이면 안내 문구만 표시가 정상)
4. 로컬에서 수집 1회: `.env.local`에 R2_*·CRON_SECRET 설정 후
   `curl -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/cron/insider-refresh`
   → `live_new`·`rows_added`·`pending_days` 확인, 몇 번 더 호출하면 백필 진행
5. `/api/insider?ticker=NVDA` (매도·10b5-1 위주), 소형주 1개(매수 확인)
6. Vercel 환경변수 `SEC_EDGAR_USER_AGENT="SavvyETF your@email"` 설정 권장 (SEC 정책: 연락처 포함 UA)
7. 배포 후 하루 지나 적재 현황 탭에서 `insider_us` 갱신 확인

## 6. 커밋

이 기능 변경만 **스테이징**해 두었습니다 (Source Control → Staged Changes).
`globals.css`·`middleware.ts`·`dataCatalog.ts`는 다른 작업(자료실·allowWeekdays)과 섞여 있어 이 기능 부분만 골라 올렸습니다.

```
git diff --cached --stat     # 확인
git commit -m "Add 내부자 매매 tab (SEC Form 4) under 월가 구루; rename 펀드매니저 group to 월가 구루"
git push
```

## 7. 다음 단계 (2단계 후보)

- **ETF 내부자 심리 점수**: ETF 보유종목 내부자 순매수를 비중가중 합산 → 테마·AI·국가 ETF 탭 연결 (SavvyETF 차별화 포인트)
- **국내(DART)**: `elestock`(임원·주요주주 소유보고)로 같은 화면, 국내/미국 토글. `esg_data.py`가 이미 DART 키·`majorstock` 사용 중
- **MP 알림**: `useSharedMpPortfolio` 보유종목에 클러스터 매수·임원 재량 매도 발생 시 표시 / 텔레그램 푸시
- **규칙적 vs 기회적 내부자**: 샤드가 1년 이상 쌓이면 "N년 만의 첫 매수" 필터 (Cohen–Malloy–Pomorski)
- **Form 144**(매도 예정) 수집, 클러스터 기준(현재 2명) 실데이터 보고 조정
- 백필을 14일 → 90일로 늘릴지 (cron 1회 약 500건 처리, 하루 Form 4 약 1,500~3,000건)
