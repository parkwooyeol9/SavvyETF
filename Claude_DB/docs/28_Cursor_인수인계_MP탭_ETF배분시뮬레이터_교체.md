# 28. Cursor 인수인계 — 포트폴리오 › MP 탭을 'ETF 배분 시뮬레이터'로 통째로 교체 (2026-10-30)

- 작성: 2026-10-30 (Claude Code) · 받는 쪽: Cursor (검토·커밋·푸시·배포)
- 대상 저장소: `/Users/wooyeol/GitHub/SavvyETF` (`main`, HEAD `95ac5a7` 기준). **커밋하지 않았다.**
- 요청: SavvyDB `Portfolio/`에서 만든 BM 배분 분석·ETF 배분 시뮬레이터로 포트폴리오 › MP 탭을 통째로 바꾼다.

---

## 0. 바뀐 것 한눈에

| 파일 | 상태 | 내용 |
|---|---|---|
| `webapp/src/components/MpTab.tsx` | 수정 | 하위 화면 4개(MP-글로벌주식·MP-ETF배분·시뮬레이션·시뮬레이션-ETF) 전환 UI를 없애고 `PortfolioSimTab` 하나만 렌더 |
| `webapp/src/components/PortfolioSimTab.tsx` | 신규 | 시뮬레이터 화면 (recharts) |
| `webapp/src/lib/portfolioSim.ts` | 신규 | 계산부 (순수 TS, 서버 호출 없음) |
| `webapp/public/portfolio-sim/data.json` | 신규 | 데이터 2.16MB (gzip 0.71MB). BM 구성·복제 바스켓·look-through·ETF 일별 수정종가 |
| `webapp/src/app/globals.css` | 수정 | 맨 끝에 `.psim-*` 블록 추가, 삭제한 화면 전용 규칙 80개 제거 (1절) |
| `webapp/src/components/lazyTabs.tsx` | 수정 | `SimulateTab`·`UsPortfolioTab` export 제거 |
| `webapp/src/middleware.ts` | 수정 | `HEAVY_PATHS`에서 `/api/simulate`·`/api/us-portfolio`·`/api/mp/*` 6개 제거 |
| 예전 MP 파일 28개 | 삭제 (`git rm`, 스테이징됨) | 1절 목록 |

- `Dashboard.tsx`·`types.ts`는 건드리지 않았다. 탭 id는 그대로 `usportfolio`(라벨 "MP")다. `?tab=simulate` 옛 링크도 `MpTab`으로 와서 시뮬레이터가 열린다(확인함). `types.ts:191`의 `simulate: "시뮬레이션-ETF"` 라벨과 `subNavTab`의 `simulate` 매핑은 옛 링크 호환용으로 남겼다.
- `npx tsc --noEmit`, `npm run check:imports`(398 files), `npm run build` 모두 통과했다(2026-10-30, 삭제 후 재확인).
  - 빌드 전에 tsc를 돌리면 `.next/types`에 남은 옛 라우트 때문에 TS2307이 난다. 빌드 한 번이면 사라진다.
- 삭제 파일은 `git rm`으로 스테이징돼 있다. 나머지 수정·신규 파일은 스테이징하지 않았다.
- 루트의 `Claude_DB/docs/08·11·12·21`, `research/*` 미추적 파일은 내 것이 아니다.

## 1. 예전 MP 화면 삭제 (사용자 결정: 2026-10-30 "Delete them")

삭제한 파일 28개:
- 컴포넌트: `MpAnalysisPanel.tsx`, `MpEtfPanel.tsx`, `MpTrackRecord.tsx`, `UsPortfolioTab.tsx`, `SimulateTab.tsx`, `MpUi.tsx`, `useSharedMpPortfolio.ts`
  - 새 탭이 `MpUi`에서 쓰던 `tooltipStyle`은 `PortfolioSimTab.tsx` 안으로 옮겼다.
- lib: `mpAnalytics.ts`, `mpCore.ts`, `mpEtfAnalytics.ts`, `mpEtfPortfolio.ts`, `mpNews.ts`, `mpPeriods.ts`, `mpPortfolio.ts`, `mpPortfolioStore.ts`, `mpRedact.ts`, `mpTrackRecord.ts`, `mpTrackSnapshot.json`, `countryEtf.ts`, `etfAllocStore.ts`
- API: `/api/mp/{analyze,news,portfolio,track,etf/analyze,etf/news}`, `/api/us-portfolio`, `/api/simulate`

남긴 것 (다른 탭이 씀):
- `lib/simulate.ts`: 메인 탭, why-etf, weightOptSim, heatmap, corridor 등이 쓴다.
- `lib/allocation.ts`, `lib/etfCatalog.ts`(`/api/catalog`·CorridorTab), `lib/usPortfolio.ts`(simulate.ts가 import), `components/EquityChart.tsx`(메인 탭)

삭제 범위를 정한 방법:
- 삭제 파일이 import하던 `@/lib`·`@/components`를 모두 뽑아, 남은 코드에서 import하는 곳이 없는 것만 지웠다.
- 봇(Python)·스크립트·워크플로·`dataCatalog.ts`에서 `/api/mp`·`mpTrackSnapshot`·`us-portfolio` 참조는 없었다.

CSS:
- 삭제 컴포넌트에만 쓰이던 클래스 48개(`us-pf-*`, `mp-*`, `sim-controls`, `etf-chip*`, `method-*`, `bucket-*`, `listing-*` 등)를 골랐다. 남은 .tsx/.ts 어디에도 없는 클래스만 골랐다.
- 그 클래스만으로 된 규칙 80개를 지웠다(14,223 → 13,637줄). 비게 된 `@media (max-width: 800px)` 블록 1개도 지웠다.
- `.main-tab, .sim-tab, .kr-tab` 묶음에서는 `.sim-tab`만 뺐다.

R2 데이터는 지우지 않았다. MP 공유 포트폴리오(`/api/mp/portfolio`가 쓰던 키)와 관리자 MP-ETF배분 저장분이 버킷에 남아 있다. 필요 없으면 콘솔에서 정리한다.

되돌리기: `git checkout 95ac5a7 -- webapp/` 후 새 파일 3개만 다시 얹으면 된다. 다만 이번 변경을 커밋한 뒤라면 `git revert`가 낫다.

## 2. 새 탭 구조

`MpTab` → `PortfolioSimTab`(dynamic import) → 마운트 시 `fetch("/portfolio-sim/data.json")` 한 번 → `makeEngine()`이 일간 수익률을 `Float64Array`로 펼침 → 이후 모든 계산은 브라우저에서 `useMemo`.

화면 순서:
1. 상단 바: BM(MSCI ACWI·S&P500·나스닥100), 기간(1Y·3Y·5Y·10Y·전체), 리밸런싱(월·분기·연·안 함), 통화(달러·원화)
2. BM 구성 분석: ACWI 국가 비중(또는 상위 15종목), 3개 BM 업종 비교, 핵심 관찰 5줄(숫자는 data.json에서 계산), ACWI 국가×업종 히트맵, 상위 10종목
3. 포트폴리오 구성: ① 코어(복제 방식 선택, ETF별 비중 직접 수정) ② 오버레이(국가·업종·테마 ETF 58종, 예시 6개, 배율 0~200%, **목표 TE 맞추기**), 시나리오 저장·공유 링크·CSV
4. 성과·위험: KPI 8개, 누적·낙폭·롤링 1년 초과/TE 차트, 지표표(포트폴리오·코어·BM·차이)
5. 노출·위험 기여: 국가·업종 액티브 비중(look-through), ETF별 TE·변동성 기여, 배율별 TE–초과수익 경로, 상관 행렬
6. 연도별 수익률, 위기 구간 9개(2015 위안화 ~ 2025 관세 반등)
7. 오버레이 후보 스크리너: 후보마다 현재 포트폴리오에 n% 더했을 때 Δ초과수익·ΔTE·Δ변동성·Δ최대낙폭 (정렬, ＋로 추가). `useDeferredValue`로 입력보다 한 박자 늦게 계산
8. 저장한 시나리오 비교(localStorage `savvyetf:psim:scen:v1`), 정의·데이터(접힘)

상태 공유: URL 해시 `#psim=<JSON>`만 바꾼다(`?tab=` 쿼리는 그대로). 다른 탭은 `location.hash`를 쓰지 않는다(검색함). 다른 탭으로 옮겨도 해시가 남는데, 해가 없지만 거슬리면 `MpTab` 언마운트 때 지우면 된다.

기본값: ACWI = 국가 ETF 복제, S&P500 = 업종 SPDR, 나스닥100 = QQQ 단일(업종 복제 TE가 3.6%라서). 첫 화면 오버레이는 예시 '아시아 테크'(EWY 4·EWT 4·EWJ 2).

색: ChartFormat 순서(파랑 → 회색 → 노랑)를 어두운 배경용으로 밝힌 `#7b8fd4 / #9aa4b2 / #e0b23a`. 표의 음수는 괄호, 양수에 `+` 없음(`portfolioSim.ts`의 `f()`). 기존 MP 탭의 `fmtPct`(+ 부호)와 다르니 섞지 말 것.

## 3. 데이터 갱신 — 봇·크론과 무관, 수동

data.json은 SavvyDB에서 만든다. Render 봇이나 Vercel 크론은 이 파일을 건드리지 않는다.

```bash
cd ~/GitHub/SavvyDB/Portfolio/4_코드
python3 build_bm.py          # BM 비중·look-through (1_원본데이터의 SavvyETF 스냅샷 기준)
python3 fetch_prices.py      # Yahoo 일별 수정종가 2011~, 테마 ETF 구성 근사
python3 build_html.py --webapp   # → SavvyETF/webapp/public/portfolio-sim/data.json
```

- BM 구성의 출처는 SavvyETF의 `webapp/src/data/acwiYahooUniverse.json`과 `Claude_DB/data/etf_holdings/mapped/*.csv`(2026-10-12)다. 갱신하려면 이 둘을 SavvyDB `Portfolio/1_원본데이터/`에 다시 복사한 뒤 위 명령을 돌린다.
- 가격 기준일은 2026-10-29 종가다. 화면 상단에 표시된다.
- 자동화하려면 `fetch_prices.py`·`build_html.py --webapp`을 봇 스케줄로 옮기고 R2에 올린 뒤 `/api`로 서빙하는 방식이 맞다. 지금은 정적 파일이라 배포해야 반영된다.

## 4. 검증한 것

- 로컬 `next dev`(포트 3018) `?tab=usportfolio`에서 화면 전체 렌더, 콘솔 오류 없음. `Bot /api/web-briefs unauthorized (401)` 배너는 로컬 env 문제로 이번 작업과 무관하다.
- 같은 상태에서 SavvyDB 단독 HTML과 수치가 일치했다. ACWI·국가 ETF 코어·아시아 테크·5Y·분기: 초과 2.21%p, TE 2.18%, IR 0.94. 나스닥100(업종 SPDR 코어): 초과 1.24%p, TE 4.12%.
- BM 전환, 원화, 목표 TE 맞추기(코어 TE가 목표보다 크면 안내 문구), 시나리오 저장·불러오기, 스크리너 정렬·추가를 확인했다. 1440px 폭(2~3열)과 571px 폭(1열, 가로 스크롤 없음)도 확인했다.
- 계산 시간: 메인 계산 약 70ms, 스크리너 약 40ms(5Y, 노트북 기준).

## 5. 확인·주의할 것

1. **MSCI 파생 데이터 공개**: data.json에 ACWI 국가·업종·상위 종목 비중이 들어 있다. 같은 성격의 `acwiYahooUniverse.json`이 이미 클라이언트 번들에 공개돼 있어 같은 수준으로 판단했지만, 배포 전 사용자 확인을 권한다.
2. **관리자 전용이던 MP-ETF배분**: 예전에는 관리자만 보이던 화면이 있었다. 새 탭은 전부 공개다. 숨길 부분이 필요하면 `useAdminSession()`으로 감싼다.
3. **백테스트 한계**: 코어 비중을 현재(2026-10) BM 구성으로 고정해 과거에 적용한다. 그래서 국가 ETF 코어가 5년간 ACWI를 연 1.49%p 앞선다(복제력이 아니라 미국 비중 소급과 IVV 대형주 효과). 화면 '정의'에 적어 두었다.
4. 상장일이 짧은 ETF(XLC 2018-06, IDEF 2024 등)를 넣으면 분석 구간이 줄고 노란 안내가 뜬다. 정상 동작이다.
5. 정적 파일이 2.16MB다. Vercel이 gzip/brotli로 보내므로 전송은 약 0.7MB다. 더 줄이려면 가격을 주간으로 바꾸거나 2016년부터 자르면 된다(`fetch_prices.py`).

## 6. 커밋 제안

```
feat(mp): replace the MP tab with an ETF allocation simulator (BM replication + overlays)
```
커밋은 둘로 나누는 것을 권한다.
1. `feat(mp): …`: 신규 3개 + `MpTab.tsx` + `globals.css`의 `.psim-*` 추가
2. `chore(mp): remove the old MP views, /api/mp, /api/us-portfolio and /api/simulate`: 삭제 28개 + `lazyTabs.tsx` + `middleware.ts` + `globals.css` 규칙 제거

한 파일(`globals.css`)이 두 커밋에 걸치므로, 나누기 번거로우면 한 커밋도 괜찮다.

참고 문서: SavvyDB `Portfolio/README.md`, `Portfolio/3_문서/01_BM_배분분석.md`.
