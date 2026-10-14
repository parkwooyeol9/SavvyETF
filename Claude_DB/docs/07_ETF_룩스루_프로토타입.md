# ETF 룩스루 밸류에이션 — 프로토타입 (2026-10-14)

ACWI 유니버스(2,238종목)는 전 세계 대·중형주를 덮고, 종목마다 10년 월간 가격·EPS·BPS·DPS·매출 추정치 시계열이 있다.
그러므로 **ETF 보유종목 × 비중**만 있으면 국가·업종·테마 집계(`factor/groups.py`)와 같은 방식으로 ETF 의 10년 PER·PBR·성장률을 조립할 수 있다.

- 코드: `factor/etf_lookthrough.py` (목록·수집·매칭), `factor/etf_valuation.py` (집계·근사)
- **2026-10-14 이후**: ETF 화면은 ACWI 분석기에서 빠지고 **포트폴리오 › 밸류에이션** 탭으로 옮겨 예전 엑셀 데이터를 대체 → `docs/09`
- 실행: `python -m Claude_DB.factor.etf_lookthrough --fetch` → `python -m Claude_DB.factor.groups` → `export_webapp`
- 데이터: `Claude_DB/data/etf_holdings/` (raw 원본 · mapped 매칭 결과 · `_coverage.csv` · `_unmatched.csv`, gitignore)

## 1. 주요 ETF 조사 · 보유종목 확보 가능 여부

보유종목·비중 파일을 **스크립트로 받을 수 있는지** 운용사별로 확인했다 (2026-10-14, 이 PC 에서 curl/requests).

| 운용사 | 받는 방법 | 결과 |
|---|---|---|
| **iShares** | `ishares.com/us/products/{portfolioId}/x/latest-holdings.csv` (portfolioId 는 상품 스크리너 JSON 에서 티커로 조회). BlackRock `get-fund-document?…&asOfDate=YYYYMMDD&component=holdings` 도 동작 → **과거 보유종목 시점 조회 가능** | ✅ 사용 |
| **SPDR (SSGA)** | `ssga.com/…/holdings-daily-us-en-{ticker}.xlsx` — CUSIP 포함 | ✅ 사용 |
| ARK | `assets.ark-funds.com/…/ARK_INNOVATION_ETF_ARKK_HOLDINGS.csv` | ✅ 가능 (소형 성장주 위주라 커버리지 낮아 제외) |
| iShares 옛 주소 | `…/1467271812596.ajax?fileType=csv` | ❌ 봇 차단(HTML 반환) — `03_ETF/etf_holdings.py`·`index_monitor` 의 ACWI 월말 파일도 실제로는 HTML |
| Global X | 'Download Full CSV' 가 페이지 JS 로 생성, 날짜 붙은 정적 주소는 404 | ❌ (브라우저 자동화 필요) |
| VanEck | 다운로드 주소가 302 리다이렉트 | ❌ |
| Invesco (QQQ) | 다운로드 API 406 | ❌ |
| Vanguard | 포트폴리오 API 가 HTML 반환 | ❌ |

### 이번에 넣은 72개 (iShares 58 · SPDR 14)

| 분류 | ETF |
|---|---|
| 국가 (25) | EWJ 일본 · EWY 한국 · EWT 대만 · MCHI 중국 · FXI 중국 대형 50 · INDA 인도 · EWZ 브라질 · EWU 영국 · EWG 독일 · EWQ 프랑스 · EWL 스위스 · EWC 캐나다 · EWA 호주 · EWW 멕시코 · EWH 홍콩 · EWS 싱가포르 · KSA 사우디 · EZA 남아공 · EIDO 인도네시아 · THD 태국 · EWM 말레이시아 · EWI 이탈리아 · EWP 스페인 · EWN 네덜란드 · EWD 스웨덴 |
| 지역 (10) | SPY · IVV (S&P 500) · ACWI · EFA (EAFE) · EEM · IEMG (신흥 IMI) · EMXC (신흥 ex 중국) · EZU (유로존) · IEUR (유럽 IMI) · AAXJ (아시아 ex 일본) |
| 섹터·미국 (11) | XLK · XLF · XLV · XLE · XLI · XLY · XLP · XLU · XLB · XLRE · XLC |
| 섹터·글로벌 (10) | IXN · IXG · IXJ · IXC · EXI · RXI · KXI · JXI · MXI · IXP |
| 산업·테마 (16) | SOXX 반도체 · IGV 소프트웨어 · ARTY AI·테크 · IHAK 사이버보안 · ITA / XAR / IDEF 방산 · ICLN 클린에너지 · IDRV 자율주행·EV · IBB 바이오 · IHI 의료기기 · RING 금광 · PICK 금속·광산 · XME 금속·광업 · IGF 인프라 · REET 글로벌 리츠 |

### 다음 단계 후보 (보유종목 확보 방법 필요)

| 분류 | ETF | 운용사 | 비고 |
|---|---|---|---|
| 지수 | QQQ (나스닥 100), VOO/VTI/VEA/VWO/VGK | Invesco · Vanguard | 스크립트 차단 → 브라우저 자동화 또는 대체 (IVV·EFA·EEM·IEUR 로 근사) |
| 반도체·AI | SMH | VanEck | SOXX 와 함께 대표 반도체 ETF |
| 원자재·광산 | GDX · GDXJ (금광), URA · URNM (우라늄), COPX (구리), LIT (리튬) | VanEck · Global X · Sprott | 소형 광산주 비중 큼 → 커버리지 낮을 것 |
| 테마 | BOTZ (로봇), SHLD (방산), DTCR (데이터센터), PAVE (미국 인프라), CIBR · GRID (First Trust), NLR (원자력), KWEB (중국 인터넷) | Global X · First Trust · VanEck · KraneShares | |
| 국가 | DXJ (일본 헤지), EPI (인도) | WisdomTree | |
| 한국 상장 | KODEX·TIGER 해외/테마 ETF | 국내 운용사 | KRX PDF(구성종목) 또는 네이버 → 같은 방식 적용 가능 |

## 2. 방법

1. **매칭** (보유종목 → ACWI Datastream 코드): ① SPDR 은 CUSIP → ISIN 으로 정확 매칭 ② 거래소 → RIC 접미사(.T, .KS, .HK…) + 티커 정규화
   (`BRK.B`/`BRKB`→`BRKb.N`, `ERIC B`→`ERICb.ST`, 홍콩 4자리, 태국 NVDR `PTT.R`→`PTT_n.BK`) ③ 유럽·인도처럼 RIC 가 현지 티커와 다른 시장은
   **이름 매칭** — 엄격 규칙(단어 완전 일치, 34자 잘린 법인명만 접두 허용, ADR 꼬리 제거, 숫자 단어 불일치 거부, 여러 회사에 똑같이 맞으면 거부)
   ④ 자동이 안 되는 대형주는 `ALIASES` (LVMH·Michelin·BMW·VW·Airbus·Leonardo·Siemens·Petrobras).
   비중 0.2% 이상 이름 매칭 전부를 눈으로 대조해 오매칭 없음을 확인 (METALLUS→Meta, Honeywell Aerospace→Honeywell, COSCO Ports→COSCO Holdings 같은 초기 오류 제거).
2. **집계**: 종목 패널을 ACWI 비중 대신 비중 1로 만들고, ETF 비중 벡터를 곱한다 → `ETF PER = Σ비중 / Σ(비중 × E/P)` 등 그룹 집계와 같은 식.
   ACWI 에 없는 종목·현금은 빠지고 나머지 비중으로 다시 나눈다.
3. **비교 그룹**: ETF 마다 대응하는 ACWI 집계 그룹(EWJ ↔ 일본, XLK ↔ 미국 IT, SOXX ↔ 반도체 테마 …)을 지정해 화면에서 점선으로 겹쳐 본다.

## 3. 결과 (보유종목 2026-10-12 기준)

- **커버리지** (ETF 주식 비중 중 ACWI 로 덮은 비율): 국가·지역·섹터 ETF 대부분 95~100%. 낮은 것 — 멕시코 84%, 사우디 82%, 인도네시아 66%, 태국 59%,
  테마는 IHAK 32% · XME 31% · XAR 44% · ICLN 54% · IBB 57% (소형주 중심). **태국은 원자료에 태국 종목 월간 EPS 시계열이 없어** ACWI 국가 집계와 함께 값이 비어 있음.
- **검증** — 같은 지수를 따르는 ETF 와 ACWI 집계가 일치:

| ETF | ETF 룩스루 Fwd PER | 대응 ACWI 집계 | 2020-10 ETF / ACWI 집계 |
|---|---|---|---|
| SPY · IVV | 19.2 | 미국 19.2 | 23.1 / 23.2 |
| ACWI | 16.5 | ACWI 16.1 | 20.8 / 20.6 |
| EFA | 14.6 | 선진(미국 외) 14.6 | 17.6 / 17.3 |
| EWJ | 15.7 | 일본 16.0 | 17.2 / 17.8 |
| INDA | 18.6 | 인도 18.5 | 24.4 / 24.3 |

  차이가 나는 곳은 지수 규칙 차이로 설명된다: XLC(14.5) vs 미국 커뮤니케이션(18.4) — XLC 는 알파벳·메타 비중 상한, SOXX(19.3) vs 반도체 테마(13.2) —
  SOXX 는 미국 상장만이라 PER 낮은 삼성전자·SK하이닉스가 빠짐, FXI(8.7) vs 중국(10.2) — 홍콩상장 대형 50 (은행 비중 큼).

## 4. 한계 · 다음 작업

- 과거 값은 **현재 보유종목·비중을 고정**하고 되돌린 것 (실제 ETF 의 과거 구성과 다름, 생존 편향). → iShares API 의 `asOfDate` 로 연 1회~분기 보유종목을 받아
  시점별 비중으로 바꾸면 해결 가능 (SPDR 은 과거 파일 없음).
- 커버리지는 ACWI 유니버스(대·중형주) 한계. 소형주 테마 ETF 는 MSCI ACWI IMI 수준 원자료가 있어야 함.
- Global X·VanEck·Invesco·Vanguard 는 브라우저 자동화(인앱 브라우저로 다운로드 링크 생성) 또는 유료 API(FMP 등)가 필요.
- 운영: 보유종목은 매일 바뀌므로 `--fetch` 를 주 1회 정도 돌리면 충분 (밸류에이션 시계열 자체는 ACWI 원자료 갱신 주기를 따름).
