# 34. Cursor 인수인계 — KRX 옵션 모니터 탭 (수집기 + 홈페이지 + 엑셀 + 투자자별 수급) (2026-11-05)

- 작성: 2026-11-05 (Claude) · 받는 쪽: Cursor
- 요청(우열님): 지수옵션 수급을 한눈에 보는 보드. KRX Open API 로 확보 가능한 데이터로 수집기를 만들고, 홈페이지 탭(기존 양식과 통일)과 엑셀 다운로드까지 붙여 달라
- **Claude 는 로컬 수집·빌드·화면 검증만 했다. git add/commit/push, R2 업로드(`--publish`), Render·Vercel 환경변수 변경은 하지 않았다.**

---

## ★ 지금 할 일 (2026-11-05 14:30 기준 — 이 절만 보면 된다)

**현재 상태 (git 으로 확인한 것)**
- 브랜치 `feat/krx-option-board` 가 이미 있고 체크아웃돼 있다. 원격 `origin/feat/krx-option-board` = `origin/main` = `32c589d` (푸시·병합 완료)
- 이미 커밋된 것: `4dc80c4`(탭 1차분) · `ea1e09a`(투자자별 수급 1차) — §2·§5-2·§8-3 의 `git checkout -b`·전체 `git add` 목록은 **다시 할 필요 없다**
- 남은 것: 아래 **5개 파일의 미커밋 수정**(만기일 분리 지표 §8-1b, 현물 수급 추가) 하나뿐이다
- 이 브랜치에 `etf-weights` 커밋 3개(2bcd0a2·d1dd5d7·32c589d)가 섞여 있다 — 이미 main 에 들어갔으니 되돌리지 말고, **다음 작업부터 작업별 브랜치**를 쓴다

**1) 커밋·푸시 (5개 파일만)**
```bash
git add 04_국내시장/krx_option_investor.py 04_국내시장/krx_option_board_excel.py \
        webapp/src/components/KrxInvestorFlowSection.tsx webapp/src/lib/krxOptionBoard.ts \
        "Claude_DB/docs/34_Cursor_인수인계_KRX_옵션보드_탭.md"
git status --short        # 위 5개 외 staged 가 없어야 함 (docs 08·11·12·21·29~31, research/** 는 무관 — 건드리지 않음)
git commit -m "fix(krx-option-board): split weekly-expiry call rolls from option direction and add KOSPI cash flows by investor"
git push origin feat/krx-option-board
```
- `00_exports/**`·`.env*` 는 커밋 금지 (gitignore 되어 있음)
- main 반영은 지금까지와 같은 방식(이 브랜치 → main)

**2) 첫 게시 — R2 키가 있는 곳에서만**
- 로컬 `.env` 에는 `R2_*` 가 없고 `.venv-sf` 에는 python-dotenv 가 없다 → 로컬 `--publish` 는 투자자 원자료를 R2 에 못 올린다
- 그래서 둘 중 하나:
  - A. 로컬 `.env` 에 R2_* 추가 + `.venv-sf/bin/pip install python-dotenv` 후 `.venv-sf/bin/python 04_국내시장/krx_option_board.py --publish`
  - B. `00_exports/krx_option_board/investor/browser_{daily,detail,cash}_*.txt` 3개를 Render 셸의 같은 경로로 복사한 뒤 Render 에서 `--publish`
- 확인 로그: `investor: R2 sync ok (124 days)` + `web push {'ok': True ...}`
- Render 에 `KRX_AUTH_KEY` 가 없으면 09:10 스케줄러가 꺼진다(§5-1)

**3) 하지 말 것**
- 투자자 데이터 로그인·쿠키 작업(§8-4)은 우열님 브라우저 로그인이 필요하다 — Cursor 가 우회 시도하지 않는다
- Claude 가 같은 폴더에서 파일을 고치는 중이면 기다린다(이번 지연의 주원인: 커밋 직후 같은 파일이 다시 바뀜). 현재 Claude 쪽 수정은 끝났다

---

## 0. 먼저 알아둘 것 — 수급 주체 데이터는 Open API 에 없다

- KRX Open API(32종)에는 **투자자별(외국인·개인·기관) 데이터가 없다.** 파생 투자자별 거래실적은 정보데이터시스템(data.krx.co.kr) 메뉴 `MDC0201050302` 에만 있다
- data.krx 는 이제 `getJsonData` 까지 로그인이 필요하다(비로그인 시 `LOGOUT`). `04_국내시장/krx_sector_midterm.py` 의 `KRX_ID`/`KRX_PW` 로그인은 `CD003` 으로 실패했다 → 수급 주체는 **우열님이 브라우저로 로그인한 세션으로 6개월치를 받아 적재**했다(§8). 이후 갱신은 `KRX_COOKIE` 경로
- 그래서 이 탭은 **변동성·프리미엄·포지셔닝**(옵션 트레이더 관점) 보드다. 레버리지/인버스 ETF 설정·환매를 개인 방향성의 대리 지표로 넣었다

## 1. 데이터 소스 (KRX Open API, `.env` 의 `KRX_AUTH_KEY`)

2026-11-05 에 아래 8개 모두 승인·응답 확인. 나머지 API 는 401.

| API | 쓰는 곳 |
|---|---|
| `idx/kospi_dd_trd` | 코스피 200 종가 → RV20 |
| `idx/drvprod_dd_trd` | VKOSPI, 옵션 전략지수(커버드콜·양매도·풋매도·프로텍티브풋·콘도르) |
| `drv/opt_bydd_trd` | 코스피200 옵션 월물·위클리(목/월) 체인 → OI 벽, Max Pain, GEX, 스큐, P/C |
| `drv/fut_bydd_trd` | 코스피200 선물 최근월(주간) → 베이시스, 미결제약정 |
| `etp/etf_bydd_trd` | 코스피200·코스닥150 레버리지/인버스 ETF → Δ상장좌수 × NAV |
| `sto/stk_bydd_trd` | 주식옵션 기초자산 종가 |
| `drv/eqsop_bydd_trd` · `drv/eqkop_bydd_trd` | 주식옵션 체인(거래대금 상위 기초자산) |

- KRX Open API 는 **전 영업일 데이터를 D+1 오전**에 게시한다(11/05 10:20 에 11/05분은 빈 응답)
- 옵션·선물 응답에는 `(야간)` 행이 섞여 있다 → 정규장(`(정규)`/`(주간)`)만 쓴다

## 2. 이번에 만든 파일

| 파일 | 내용 |
|---|---|
| `04_국내시장/krx_option_board.py` | 수집 + 지표 계산 + `--publish`(웹 수신 API 우선, 없으면 R2). ETF Flow 주간(`03_ETF/etf_flow_weekly.py`)과 같은 구조 |
| `04_국내시장/krx_option_board_excel.py` | 엑셀 작성. 셀 서식·막대 차트 헬퍼는 `03_ETF/etf_flow_weekly_excel.py` 것을 import(ChartFormat 팔레트 그대로) |
| `04_국내시장/krx_option_board_scheduler.py` | 매일 09:10 KST 실행, `as_of` 가 R2 최신과 같으면 게시 생략 |
| `01_봇/bot.py` | 스케줄러 import·시작 1줄씩 + `/status` 상태 필드 5개 |
| `render.yaml`, `.env.example` | `KRX_AUTH_KEY`(sync:false), `KRX_OPTION_BOARD_SCHEDULE_ENABLED`, `KRX_OPTION_BOARD_SCHEDULE_KST` |
| `webapp/src/lib/krxOptionBoard.ts` | 타입 + R2 로더(로컬 dev 는 `00_exports/krx_option_board/` 최신 파일) |
| `webapp/src/app/api/krx-option-board/route.ts` | GET(캐시 5분) + POST 수신(`WEB_INGEST_SECRET`) — `etf-flow-weekly` 라우트 복제 |
| `webapp/src/app/api/krx-option-board/excel/route.ts` | 엑셀 다운로드 (`KRX 옵션모니터_YYMMDD.xlsx`) |
| `webapp/src/components/KrxOptionBoardTab.tsx` | 탭 화면 |
| `webapp/src/lib/types.ts`, `components/lazyTabs.tsx`, `components/Dashboard.tsx` | 탭 id `optboard` 등록 — **포트폴리오 › 파생상품 › 옵션 모니터**(첫 번째 탭). URL 별칭 `option-board`·`option-monitor`·`options`·`옵션`·`옵션모니터` |
| `webapp/src/middleware.ts` | rate limit 2줄 |
| `webapp/src/app/globals.css` | `.optboard-*` 3개 규칙(ETF Flow 블록 바로 아래) |

화면 양식: 머리(제목·기준일·작성시각 + 엑셀 다운로드·새로고침) = ETF Flow 주간, KPI 카드 = 감마 탭(`macro-snap-card`), 표 = `kr-table etfflow-table`, 차트 = 감마 탭 recharts 색(격자 `#243049`, 상승 녹·하락 적·현물 하늘색).

## 3. 화면·엑셀 구성

| # | 탭 섹션 | 엑셀 |
|---|---|---|
| 1 | 핵심 지표 9칸 (코스피200·VKOSPI(백분위)·RV20·VRP·ATM IV/스큐·P/C·베이시스·풋/콜 벽·GEX) | 정리 §1 |
| 2 | VKOSPI vs RV20, VRP 막대 | `변동성` 시트 + 꺾은선 2개 |
| 3 | 근월물 행사가별 OI(콜/풋)·GEX | `근월물 체인` 시트 + 막대 2개 |
| 4 | 만기별 구조(월물·위클리) + ATM IV 기간구조 | 정리 §2 + 꺾은선 |
| 5 | P/C 비율 시계열, 선물 베이시스·미결제 | `PC 비율`·`선물` 시트 |
| 6 | 옵션 전략지수 1D/1M/3M, 코스피200 대비 초과 | 정리 §3 + 가로 막대 |
| 7 | 레버리지·인버스 ETF 순설정(5일·20일·일별 누적막대) + ETF 15개 | 정리 §4, `레버리지·인버스 ETF`, `ETF 일별 설정` |
| 8 | 주식옵션 거래대금 상위 20 (P/C·ATM IV·스큐) | 정리 §5 |

계산 방법은 payload `method` 에 들어 있고 탭 하단·엑셀 정리 시트 하단에 그대로 표시된다(RV20, 패리티 역산, 스큐 정의, GEX 가정, ETF 추정식).

## 4. Claude 가 돌린 로컬 실행 (재현 기준값)

```bash
.venv-sf/bin/python 04_국내시장/krx_option_board.py      # 첫 실행 ≈ 10분 (130영업일 캐시), 이후 하루치만
cd webapp && npx tsc --noEmit -p .                       # 통과
```

기준일 2026-11-04 기대값 (검산용)

| 지표 | 값 | 지표 | 값 |
|---|---|---|---|
| 코스피 200 | 889.25 (+0.40%) | VKOSPI | 56.04 (6개월 백분위 43%) |
| RV20 | 59.68% | VRP | −3.64%p |
| 근월(2611) ATM IV / 스큐 | 54.0% / +1.5 | P/C OI · 거래량 | 1.06 · 0.80 |
| 선물 베이시스 | +0.60pt | 풋 벽 / 콜 벽 / Max Pain | 750 / 1,000 / 950 |
| GEX(45일 내) | +638억/1% | 만기 수 | 13 (월물 11 + 위클리 2, OI 500 미만 제외) |
| 외국인 5일 선물 / 옵션 방향 | +5,490계약 / +474.6억 | 기관 5일 선물 / 옵션 방향 | −4,503계약 / −501.5억 |

산출물: `00_exports/krx_option_board/krx_option_board_261104.json`, `KRX 옵션모니터_261104.xlsx`, `cache/YYYYMMDD.json`(일별 요약), `investor/`(투자자 원자료) — 모두 gitignore 대상.

## 5. Cursor 작업 순서

### 5-1. 환경변수 (커밋 전)
- **Render(savvyetf-bot)**: `KRX_AUTH_KEY` 추가 (로컬 `.env` 값). 없으면 스케줄러가 스스로 꺼진다(`krx_option_board scheduler disabled` 로그)
- Vercel: 새 변수 없음. 기존 `WEB_INGEST_SECRET`·R2 설정을 그대로 쓴다

### 5-2. 커밋·배포 — ✅ 완료(`4dc80c4`), 기록용. 지금 할 일은 맨 위 ★ 절
```bash
git checkout -b feat/krx-option-board
git add 04_국내시장/krx_option_board.py 04_국내시장/krx_option_board_excel.py 04_국내시장/krx_option_board_scheduler.py \
        01_봇/bot.py render.yaml .env.example \
        webapp/src/lib/krxOptionBoard.ts webapp/src/app/api/krx-option-board \
        webapp/src/components/KrxOptionBoardTab.tsx webapp/src/lib/types.ts webapp/src/components/lazyTabs.tsx \
        webapp/src/components/Dashboard.tsx webapp/src/middleware.ts webapp/src/app/globals.css \
        "Claude_DB/docs/34_Cursor_인수인계_KRX_옵션보드_탭.md"
git status --short        # 00_exports/·.env 가 없어야 함
git commit -m "feat(krx-option-board): add the KOSPI 200 option board tab with a daily KRX Open API collector and Excel download"
git push -u origin feat/krx-option-board
```
- **커밋 금지**: `00_exports/**`(산출물·캐시) · `.env*`(예시 파일 제외)
- 작업 트리의 다른 미커밋 변경(docs 08 수정, docs 11·12·21·29~31, `research/**`)은 이번 작업과 무관 — 건드리지 않음

### 5-3. 첫 게시 — ★ 절 2) 로 대체
배포가 끝난 뒤 로컬에서 한 번 올린다(캐시가 이미 있어 1분 안쪽).
```bash
.venv-sf/bin/python 04_국내시장/krx_option_board.py --publish   # WEB_INGEST_SECRET 있으면 /api/krx-option-board POST, 없으면 R2 직접
```
- 기대 응답: `web push {'ok': True, 'key': 'krx_option_board/latest.json', 'xlsx': True, 'day': '<as_of>' ...}`
- 이후는 Render 스케줄러가 매일 09:10 KST 에 갱신. Render 디스크가 비면(재배포) 첫 실행에서 130영업일을 다시 받는다(10~20분, 그 시간 동안 다른 작업과 겹쳐도 네트워크 대기만)

## 6. 배포 후 QA

- [ ] 포트폴리오 › 파생상품의 **첫 번째 탭**이 **옵션 모니터**, `?tab=optboard` 로 직접 열림
- [ ] 머리에 기준일·작성시각, KPI 9칸 값이 §4 표와 같음
- [ ] 3개월/6개월 칩으로 시계열 차트 기간이 바뀜
- [ ] **엑셀 다운로드** → `KRX 옵션모니터_YYMMDD.xlsx`, 시트 9개(§8-5), 차트가 엑셀에서 열림
- [ ] `/api/krx-option-board` 브라우저 200, curl(브라우저 아님) 403 — botGate 규칙과 같음
- [ ] 다음 날 09:10 이후 Render `/status` 의 `last_krx_option_board_as_of` 가 전 영업일로 바뀜
- [ ] 모바일 폭(≤900px)에서 차트·표가 한 줄로 쌓임

## 7. 한계·다음 단계 (우열님 확인)

1. **수급 주체 갱신은 로그인 세션이 필요** — §8-4 참고. 쿠키가 없으면 마지막 적재분(기준일 표시)으로 남는다
2. 위클리 만기일은 n번째 목/월요일 근사(휴장일 미반영). 휴장 주에는 D-값이 1~2일 어긋날 수 있다
3. GEX 는 "딜러 콜 롱·풋 숏" 관례 가정이다. 실제 포지션이 아니라는 문구를 탭·엑셀에 넣어 두었다(감마 탭과 같은 관례)
4. 주식옵션 코스닥 기초가격은 `ksq_bydd_trd` 미신청이라 풋콜 패리티로 역산한다

---

## 8. 추가분 — 투자자별 수급 (4dc80c4 이후, 2차 커밋)

### 8-1. 데이터
- 원천: 정보데이터시스템 [15007] 파생상품 › 투자자별 거래실적 (`MDC0201050302`, 로그인 필요)
  - 일별추이 `MDCSTAT13102` (inqTpCd=2): 열 **A07 기관 합계 · A08 기타법인 · A09 개인 · A12 외국인 합계** (합 = 0 으로 검산)
  - 기간합계 `MDCSTAT13101` (inqTpCd=1): 금융투자·투신·연기금 등·보험·은행·기타금융 세부
  - 상품 `isuCd`: `KR___OPK2I`(옵션 월물) · `KR___OPWKI`(위클리 목) · `KR___OPWKM`(위클리 월) · `KR___FUK2I`(선물), `isuOpt` C/P/ALL, `prtType` AMT/QTY, `prtCheck=SUN`, `aggBasTpCd=0`(정규)
- 현물: 정보데이터시스템 [12008] 주식 투자자별 거래실적 일별추이 `MDCSTAT02202` (inqTpCd=2, trdVolVal=2, askBid=3, **mktId=STK**, etf/etn/elw 빼고 = 주식만) — 열 **TRDVAL1 기관 · 2 기타법인 · 3 개인 · 4 외국인**
- 2026-11-05 우열님 로그인 세션에서 받은 원자료(**2026-05-04 ~ 11-04, 124영업일**):
  - `00_exports/krx_option_board/investor/browser_cash_260504_261104.txt` — 코스피 현물 투자자별 순매수대금(억)
  - `00_exports/krx_option_board/investor/browser_daily_260504_261104.txt` — 일별 콜/풋/선물 × 대금·계약 × 4개 투자자
  - `00_exports/krx_option_board/investor/browser_detail_261104.txt` — 1·5·20일 기간합계(기관 세부)
  - `00_exports/` 는 gitignore → **커밋되지 않는다. R2 로 올려야 Render 가 읽는다(§8-3)**

### 8-1b. 지표 수정 (우열님 지적 반영, 같은 날 오후)
- 처음 넣은 '옵션 방향 = 콜 대금 − 풋 대금'이 **"외국인이 콜을 산다"는 잘못된 해석**을 만들었다
  - 외국인 콜 순매수대금 6개월 +21,732억 중 **월·목(위클리 만기일) +22,142억, 그 외 −410억**. 만기일마다 기관(20일 세부상 투신)이 같은 금액을 판다 → 코스피200 위클리 커버드콜 ETF(순자산 약 11.5조)의 롤 매도를 외국계가 받는 구조로 판단. 만기일 외국인 콜 계약당 프리미엄 ≈ 32~36pt = VKOSPI 55% 7일물 ATM 이론가(≈33pt)
- 그래서 `expiry_days()`(월·목, 휴장이면 다음 영업일 — 124일 중 52일)로 나눠
  - **비만기일 옵션 방향**(`dir_*`, 만기일은 null)만 방향 판단에 쓰고
  - **만기일 콜**(`roll_*`)은 따로 표·막대 차트로 보여 준다
- 현물 열 `cash_*`, 현물+선물 누적 노출 `expo_*`(= 현물 누적 + 선물 누적 계약 × 코스피200 × 25만원), 현물 상관 `cash_same/next` 추가
- 해석 문구에서 "상방 베팅" 표현 제거. 수정 후 외국인 20일: 현물 −212,370억 · 선물 +6,689계약 · **비만기일 옵션 −667억(풋 우위)** · 만기일 콜 +2,317억

### 8-2. 바뀐·새 파일
| 파일 | 내용 |
|---|---|
| `04_국내시장/krx_option_investor.py` (새) | 원자료 로드(로컬 txt/json + R2: `investor/{daily,detail,cash}.json`), `expiry_days()`, `load_cash()`, `update_from_cookie()`(KRX_COOKIE 있으면 최근 15영업일 파생·현물 갱신), `sync_to_r2()`, 분석 `investor_section()` |
| `04_국내시장/krx_option_board.py` | payload `investor` 추가, summary 에 `inv_as_of·frgn_fut_5d·frgn_dir_5d·indiv_dir_5d`, `--publish` 때 `sync_to_r2()`, 원자료 없으면 직전 게시본 투자자 섹션 유지, 엑셀 제목 `KRX 옵션모니터_YYMMDD`, 미결제 500 미만 만기 제외 |
| `04_국내시장/krx_option_board_excel.py` | 시트 2개 추가 — `투자자별 수급`(1·5·20일 표, 지수 동행성, 기관 세부, 해석), `투자자별 일별`(일별·누적 + 꺾은선 2개) |
| `webapp/src/components/KrxInvestorFlowSection.tsx` (새) | 탭 섹션 2 — 해석, 1/5/20일 칩 표(현물·선물·콜/풋 계약·비만기일 옵션 방향·만기일 콜), 현물+선물 누적 노출·비만기일 옵션 방향 누적(코스피200 오른쪽 축, 기간 시작일 0 기준), 만기일 콜 막대(외국인 vs 기관), 상관표, 기관 세부 |
| `webapp/src/components/KrxOptionBoardTab.tsx` | 섹션 2 삽입, 이후 섹션 번호 3~9 |
| `webapp/src/lib/krxOptionBoard.ts` | `InvestorSection` 타입, 엑셀 파일명 `KRX 옵션모니터_` |
| `webapp/src/app/globals.css` | `.optboard-reads` 등 3규칙 (파일 끝) |

분석 정의(탭·엑셀 하단에 같은 문구):
- 정의는 §8-1b. 지수 동행성(124일, 당일): 현물 — 외국인 +0.54 · 기관 +0.52 · 개인 −0.68 / 선물 — 외국인 −0.42 · 기타법인 +0.45. 익일 상관은 모두 |0.1| 이하(비만기일 옵션의 기타법인 +0.23 하나만 예외)

### 8-3. 커밋·게시 — ✅ 1차 완료(`ea1e09a`), 기록용. 남은 커밋·게시는 맨 위 ★ 절
```bash
git checkout feat/krx-option-board
git add 04_국내시장/krx_option_investor.py 04_국내시장/krx_option_board.py 04_국내시장/krx_option_board_excel.py \
        webapp/src/components/KrxInvestorFlowSection.tsx webapp/src/components/KrxOptionBoardTab.tsx \
        webapp/src/lib/krxOptionBoard.ts webapp/src/app/globals.css \
        "Claude_DB/docs/34_Cursor_인수인계_KRX_옵션보드_탭.md"
git status --short        # 00_exports/ 가 없어야 함
git commit -m "feat(krx-option-board): add investor-type option and futures flows from the KRX data system"
git push
```
- 게시: **R2 자격(R2_*)이 있는 환경**에서 `--publish` 를 돌려야 투자자 원자료가 `krx_option_board/investor/{daily,detail}.json` 으로 올라간다. 로컬 `.env` 에는 R2_* 가 없고 `.venv-sf` 에 python-dotenv 도 없다(로그 `[suppressed] r2_briefs._ensure_dotenv`)
  - 방법 A: 로컬에 R2_* 를 넣고 `.venv-sf/bin/pip install python-dotenv` 후 `--publish`
  - 방법 B: `00_exports/krx_option_board/investor/*.txt` 3개를 Render 셸로 복사해 같은 경로에 두고 `--publish`
- 기대 로그: `investor: R2 sync ok (124 days)` (daily·detail·cash 3개 키) + `web push {'ok': True ...}`
- R2 동기화가 안 된 상태로 Render 스케줄러가 돌면, 직전 게시본의 투자자 섹션을 그대로 유지한다(사라지지 않음, 기준일 고정)

### 8-4. 이후 갱신 (로그인 세션 필요)
- `KRX_COOKIE` = 브라우저로 data.krx.co.kr 로그인 → 개발자도구 Network 의 `getJsonData.cmd` 요청 헤더 `Cookie` 전체. 몇 시간이면 만료
- 쿠키를 넣고 `--publish` 하면 `update_from_cookie()` 가 최근 15영업일 + 기간합계를 다시 받아 합치고 R2 에 올린다. 만료면 `KRX_COOKIE 만료` 로그만 남기고 나머지는 정상 게시
- Render 에 장기 보관은 의미 없음(만료). **주 1회 정도 로컬에서 쿠키로 갱신하는 운영**을 권장. 자동화하려면 KRX 로그인 방식(CD003 실패 원인) 조사가 먼저
- `update_from_cookie()` 는 브라우저에서 확인한 요청 파라미터 그대로지만 **requests + 쿠키로는 아직 실행해 보지 않았다** — 첫 실행 때 `investor: cookie update N days` 로그 확인

### 8-5. 추가 QA
- [ ] 섹션 2 머리: `기준일 2026-11-04 · 적재 2026-05-04~ (124영업일)`
- [ ] 5일 누적 표: 외국인 현물 −52,949억 · 선물 +5,490 · 비만기일 옵션 −275.1 · 만기일 콜 +700.8 / 기관 +26,061억 · −4,503 · +205.4 / 개인 +8,745억 · −954 · +87.3
- [ ] 만기일 콜 막대 차트에서 외국인(금색)과 기관(보라)이 거의 대칭
- [ ] 1/5/20일 칩 전환, 3개월/6개월 칩에 누적선이 0 에서 다시 시작
- [ ] 엑셀 시트 9개: 정리 · 투자자별 수급 · 투자자별 일별 · 근월물 체인 · 변동성 · PC 비율 · 선물 · 레버리지·인버스 ETF · ETF 일별 설정
