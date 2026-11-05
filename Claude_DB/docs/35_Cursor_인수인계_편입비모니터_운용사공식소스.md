# 35. Cursor 인수인계 — 편입비 모니터: 운용사 공식 소스 전환 (DGRO·HDV·VFLO·VYM·XLK)

- 작성: 2026-11-05 (Claude)
- 기준 커밋: `ea1e09a` (브랜치 `feat/krx-option-board` 위 작업트리 — 옵션보드 미커밋 변경과 **섞지 말 것**)
- 탭: ETF → 편입비 → 편입비 모니터 (`?tab=etfweights`)

## 왜

etfcheck(Morningstar) 편입 데이터에는 **보유 기준일이 없다.** 기존 코드는 `TRADEDATE`(가격일)를
`as_of`로 저장해서 오래된 비중이 "어제 기준"처럼 보였다.

| 확인 (2026-11-05) | etfcheck | 운용사 공식 |
|---|---|---|
| XLK NVDA 보유주식 | 77.3M주 / 13.16% | 87.6M주 / 15.47% (SSGA 11/03) |
| DGRO 1위 | AAPL 3.14% | XOM 3.16% (iShares 11/03) |
| VFLO SNDK | 7.54% (288k주 × $1,037 ≈ AUM의 2.4% → 앞뒤가 안 맞음) | 공식 파일 자동수집 불가 |

## 바뀐 파일

| 파일 | 내용 |
|---|---|
| `03_ETF/etf_weight_official.py` (신규) | 운용사별 공식 파일 수집기 + `OFFICIAL_SOURCES`/`PRIORITY_TICKERS` + `collect_priority()`. CLI: `python etf_weight_official.py [TICKER ...]` |
| `03_ETF/etf_weight_monitor.py` | `build_snapshot(extra=)` 추가 · etfcheck 스냅샷에 `issuer` 인자(전엔 전부 "iShares"로 찍힘), `as_of_basis="etfcheck_price_date"` · iShares Top15 수집이 `_ishares_snapshot_best()`로 공식 CSV 우선 · `collect_all()`에서 `collect_priority()` 실행 후 유니버스에 `group:"priority"` 등록 · `collect_ticker()` 공식 우선 · payload에 `holdings_as_of`/`as_of_basis`/`disclosure` |
| `webapp/src/components/EtfWeightMonitorTab.tsx` | `coverage==="top10"`이면 "Top 10만 (전체 목록 아님)" · 셀렉트에 "우선 관리" optgroup 맨 위 · 헤더 기준일 옆에 "(운용사 공식)", "(운용사 공식 · 월말 공시)", "(etfcheck 가격일 — 실제 보유 기준일 아님)" 표시 |

API 라우트(`webapp/src/app/api/etf-weights/route.ts`)는 JSON을 그대로 통과시켜서 손대지 않았다.

## 소스 (검증 완료)

| 티커 | 소스 | 주기 | 이번 적재 기준일 |
|---|---|---|---|
| DGRO | `https://www.ishares.com/us/products/264623/ishares-core-dividend-growth-etf/latest-holdings.csv` | 일간 T-1 | 2026-11-03 (398종목, Σ100.08%) |
| HDV | `https://www.ishares.com/us/products/239563/ishares-core-high-dividend-etf/latest-holdings.csv` | 일간 T-1 | 2026-11-03 (79종목) |
| XLK | `https://www.ssga.com/us/en/intermediary/library-content/products/fund-data/etfs/us/holdings-daily-us-en-xlk.xlsx` | 일간 T-1 | 2026-11-03 (79행, 현금·선물 포함) |
| VYM | `https://investor.vanguard.com/irr/funds/profile/VYM-AdditionalFundData` → `holdingDetails` | **월말**, 약 1개월 지연 | 2026-09-30 (610종목) |
| VFLO | advisor.vcm.com 상품 페이지 "All Holdings" CSV (브라우저 다운로드) — **수동 import** | 일간 | 2026-11-04 (52행 = 주식 50 + 현금 + ES 선물, Σ100.0%) |

- iShares 구 경로 `1467271812596.ajax?fileType=csv` 는 이제 상품 HTML을 돌려줌 → 죽은 경로. `etf_holdings.py`/`etf_memb_us.py`의 `_fetch_ishares_live`도 같은 영향일 가능성 있음(별건).
- iShares CSV 컬럼이 펀드마다 다름: `Weight (%)`(DGRO/HDV) vs `Market Weight`(IVV). 둘 다 처리. 채권(AGG)은 레이아웃이 달라 etfcheck로 폴백됨.
- `ISHARES_PRODUCTS`(etf_holdings.py) 8종 중 7종이 공식 CSV로 수집됨: EEM·IEMG·IVV·IWM·EFA·SOXX·ACWI.
- VFLO: advisor.vcm.com "All Holdings" CSV는 브라우저에서 `investorapi.vcm.com/search/product/VFLO/AllHoldings`로 생성되는데 일반 HTTP 요청은 403.
  etfcheck VFLO는 자체 모순(공식 1위 ACN 5.02%가 etfcheck엔 없음, SNDK 7.54%는 주식수×가격으로 ≈2.4%)이라 **스케줄러가 VFLO를 게시하지 않음**(`kind: victory_import`, collect_priority errors에 1줄 남는 게 정상).
  갱신: `python 03_ETF/etf_weight_official.py --victory-json VFLO top10.json` 또는 공식 CSV를 받아 `--victory-csv VFLO VictorySharesFreeCashFlowETF_MM_DD_YYYY.csv`(전체 목록, 권장). CSV 컬럼: `Date,Stock Symbol,ETF Name,ISIN,Holding,Security Type,Shares,Market Value,Portfolio %` — 2026-11-05 실제 파일로 검증(Top10이 페이지 Top10과 일치).
  `collect_all()`은 저장 안 된 우선 티커도 latest가 있으면 유니버스에 유지.

## 적재 상태

- 로컬 `data/etf_weights/{DGRO,HDV,VFLO,VYM,XLK}/` 에 snapshots·latest·raw 저장, `universe.json`도 다시 씀 (gitignore 대상).
- **R2에는 아직 안 올라감** — 로컬 `.env`에 `R2_*` 없음. 배포 후 봇이 08:20 KST `collect_all()`을 돌리면 R2 `etf_weights/...`에 올라가고 웹에 보인다.
  급하면 배포 서버에서 `python 03_ETF/etf_weight_official.py` 한 번 실행.

## 검증 명령

```bash
cd 03_ETF && python etf_weight_official.py   # DGRO·HDV·XLK·VYM saved, errors = VFLO 수동 import 안내 1줄
python -c "import path_setup, etf_weight_monitor as m; p=m.weight_monitor_payload('XLK'); print(p['as_of'], p['as_of_basis'])"  # 2026-11-03 issuer_file
cd ../webapp && npx tsc --noEmit -p .
```

## 완료 기준

- 웹 편입비 모니터 셀렉트 맨 위에 "우선 관리 (5)" 그룹, XLK 헤더에 "as of 2026-11-03 (운용사 공식)".
- VYM은 "(운용사 공식 · 월말 공시)", VFLO는 "as of 2026-11-04 (운용사 공식)" 52종목(Top10 import 시에만 "Top 10만" 표시).

## 커밋 범위

커밋할 것: 위 3개 파일 + 이 문서. **커밋 금지**: `data/etf_weights/**`, 같은 작업트리의 KRX 옵션보드 변경(`04_국내시장/krx_option_*`, `KrxOptionBoardTab.tsx`, `krxOptionBoard.ts`, `globals.css`, `KrxInvestorFlowSection.tsx`, 34번 문서).
