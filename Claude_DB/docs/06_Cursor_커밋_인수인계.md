# 06. Cursor 인수인계 — 2026-10-06 작업분 검토 · 빌드 · GitHub 커밋 · 배포

- 작성: 2026-10-06 (Claude) · 받는 쪽: Cursor
- 범위: 개선 엑셀(10년 시계열·거래량·매출) 반영 + **10년 팩터 백테스트** (Python 엔진 + 로컬 HTML 탭 + 웹앱 React 탭)
- 먼저 읽기: `docs/05_팩터_백테스트.md` (점검·방법·결과) → 이 문서. 이전 배포 구조는 `docs/04` (봉인 R2 업로드는 Cursor 가 만든 `sealed_r2.py` 그대로 사용)
- **Claude 는 맥 작업 트리에 파일만 썼고 git 명령은 실행하지 않았습니다.** 커밋·푸시·배포는 아래 순서로 Cursor 가 진행

---

## 0. 시작 전 (우열님 / Cursor)

1. **원본 엑셀을 `Claude_DB/data/ACWI_v3.xlsx` 로 저장** (채팅 업로드본 `_신투증__ACWI__퀀트_유니버스_1.xlsx`, 52.8MB — 전송 한도 때문에 Claude 가 맥에 못 옮김). gitignore 대상(`data/*.xlsx`)
2. 저장소 루트에서 `.venv` 활성화, `git status` 로 시작 상태 확인 (Cursor 의 10-02 작업분 중 미커밋분이 있으면 먼저 정리)

## 1. 바뀐 파일

### Python (`Claude_DB/`) — 커밋 대상
| 파일 | 상태 | 내용 |
|---|---|---|
| `factor/backtest.py` | **신규** | 10년 팩터 백테스트 엔진 (가격 복원 `price_relative`, 신호 `build_signals`, 중립 Z, 5분위·IC·회전율, PIT 마스크, 3개 유니버스) |
| `factor/timeseries.py` | 수정 | 시트 이름 키워드 인식(`_classify`: Price(Daily_3Y)·Volume·Price_(Monthly_10Y)·SALE), `TimeSeries.vol/ri_m/sal`, 월간 시트 일간 혼입 경고 |
| `factor/technicals.py` | 수정 | `liquidity()` (거래대금·거래량비·거래량 Z·OBV). **볼린저 가드 1e-9 → 1e-6** (Cursor 테스트 `test_bollinger_blank_when_price_flat` 이 이 환경에서 실패해서 완화) |
| `factor/fundamentals_ts.py` | 수정 | 월간 10년 RI 로 근사 PER 계산, 매출 리비전, 3년·10년 위치, EPS 5년 CAGR, 브레드스 열 추가 |
| `factor/engine.py` | 수정 | `hq_country` 열 인식(TR.UltimateParentCountryHQ), run() 에서 거래량 지표 합류 |
| `factor/analyzer.py` | 수정 | 새 KEYS(liq·vr·vz·obv·sv1·sv3·sv12·svd·pep10·pbp10·dyp10·pem10·ec5·hq), 시리즈 rim·sal·bench_m, `write_standalone()` (백테스트 데이터도 인라인) |
| `factor/export_webapp.py` | 수정 | PER_STOCK 에 rim·sal, summary 에 bench_m, **backtest.bin** 추가, 로컬 미리보기용 `out/sealed_local/private/acwi/latest/` 사본 |
| `index_monitor/src/export_webapp.py` | 수정 | MSCI 봉인본을 `out/sealed_local/private/index_monitor/` 에도 사본 |
| `scripts/local_preview.sh` | **신규** | push 전 로컬 확인 (봉인 파일 → `SEALED_DATA_LOCAL_DIR` 로 `npm run dev`) — §3-1 |
| `tests/test_analyzer.py` | 수정 | `TestBacktest` 4개 추가 (가격 복원·완벽 신호·PIT 마스크·시트 분류) → 전체 28개 |
| `web/analyzer.html` | 수정 | **팩터 백테스트 탭**, 상세(10년 월간 차트·매출·거래대금·10Y 위치·본사 국가), 스크리너 열, 데이터 탭 |
| `.gitignore` | 수정 | `web/backtest_data.js`, `.env.local` 추가 |
| `README.md`, `docs/01_팩터검증_리포트.md`(§7 추가), `docs/05_팩터_백테스트.md`, `docs/06_Cursor_커밋_인수인계.md` | 수정/신규 | 문서 |

### 웹앱 (`webapp/src/`) — 커밋 대상
| 파일 | 상태 | 내용 |
|---|---|---|
| `components/acwi/AcwiBacktest.tsx` | **신규** | 백테스트 보기 (유니버스·지역·신호·비용 선택, KPI, 5분위/초과/롱숏 누적, 분위 막대, 12M IC, 신호 비교표, 유니버스 비교, 연도별, 팩터 상관, 커버리지, 방법) |
| `components/AcwiAnalyzerTab.tsx` | 수정 | 보기 "팩터 백테스트" 추가, `?part=backtest` 는 탭을 처음 열 때만 요청 (실패 시 재시도) |
| `components/acwi/AcwiDetail.tsx` | 수정 | 3년 주간 / 10년 월간 전환, 매출 NTM, 거래대금·매출 리비전 KPI, PER/PBR 10Y 위치, 10년 중앙값 기준선, 본사 국가 |
| `components/acwi/AcwiScreener.tsx` | 수정 | 기술적: 거래대금20D·거래량비 / EPS: 매출 Δ3M·PER 10Y위치 |
| `lib/acwiAnalyzer.ts` | 수정 | 새 숫자·문자 키, `AcwiSeries` rim·sal, `series.bench_m`, 백테스트 타입(`AcwiBacktest`, `BtPerf`, …) |
| `app/api/acwi-analyzer/route.ts` | 수정 | `?part=backtest` → `private/acwi/latest/backtest.bin` (requireSiteAdmin · PRIVATE_NO_STORE 그대로) |
| `app/globals.css` | 수정 | `.aa-bt-ctl` 2줄 (`.aa-fill` 바로 아래) |

### 생성물 — **커밋 금지** (맥에는 최신본을 넣어 둠)
`Claude_DB/web/analyzer_data.js`(14.8MB) · `web/backtest_data.js`(2.4MB) · `web/data.js` · `out/**` (analyzer·backtest·intake·standalone·db) · `data/*.xlsx` · `.env.local`.
`index_monitor/data/out/acwi_*` 는 새 파일(v3) 앵커로 재생성됨 — **이 폴더·`data/raw/msci/*psv` 가 이미 git 에 들어가 있는지 확인**(`git ls-files Claude_DB/index_monitor/data`). MSCI 공개 리스트 파생물이라 저장소가 공개면 추적 해제 권장(우열님 결정).

## 2. 검토 (Python)

```bash
python -m unittest discover -s Claude_DB/tests -t .                                   # 28 OK
python -m Claude_DB.factor.intake --xlsx Claude_DB/data/ACWI_v3.xlsx --prev Claude_DB/data/ACWI_raw.xlsx
python -m Claude_DB.factor.analyzer --xlsx Claude_DB/data/ACWI_v3.xlsx --as-of 2026-10-01   # ~3.5분
python -m Claude_DB.factor.backtest --xlsx Claude_DB/data/ACWI_v3.xlsx                      # ~6.5분
open Claude_DB/out/analyzer_standalone.html    # 팩터 백테스트 탭 확인
```

재현 기준값 (2026-10-01 데이터, `out/backtest/summary.csv`, 비용 전, 지역 전체)
| 항목 | 기대값 |
|---|---|
| 로더 | 시트 7개 인식, 월간 Price 잔여행 664 제거, EPS 등 0 |
| 점수 대상 | 2,238 (제외 28) |
| 백테스트 기간 | 2017-10-01 ~ 2026-09-01 신호, 108개월 |
| PIT 종합 롱숏 | 7.75% · 샤프 0.98 · IC t 4.00 |
| 사이즈 롱숏 | static 22.63% / pit 12.67% / pit_large 2.30% |
| 모멘텀 롱숏 (pit_large) | 7.67% · IC t 2.43 |
| PIT 커버리지 | 2017-10 1,380종목 → 2025-10 2,146종목 |
| 가격 복원 검증 | 12M 주가변화 ±2%p 이내 94% (docs/05 §2) |

검토 포인트
1. `backtest.price_relative`: 배당수익률을 t+1 값으로 근사(한 달 시차) — 고배당주 오차 수준 확인
2. `backtest.fx_factor`: EPS→BPS→DPS 순으로 지금 환율 계수. 매출은 USD 열 단위가 시장마다 달라 제외
3. `factor_panels`: 팩터 결측(디스크립터 전부 없음)은 결측 처리 — 라이브 모델은 0. 의도된 차이
4. 조합 점수 가용 조건: 구성 팩터의 절반 이상 있어야 점수
5. `membership_mask`: ISIN 매칭 없는 종목은 PIT 에서 제외(보수적)
6. 성능: 신호 패널 루프에서 `.loc` 대입이 대부분(전체 6~7분). 필요하면 numpy 배열로 바꿔 단축 가능
7. 웹앱 `perf()` (AcwiBacktest.tsx) 는 `backtest.stats` 와 같은 정의 — 비용 0bp 일 때 Q1 CAGR 이 summary.csv `q1_cagr` 와 같아야 함

## 3. 검토·빌드 (웹앱)

Claude 환경은 npm 레지스트리가 막혀 있어 **React/Next 타입 스텁으로만 `tsc` 검사**했습니다(바뀐 파일에서 스텁 관련 외 오류 없음). 실제 빌드는 Cursor 에서:

```bash
cd webapp
npm run check:imports
npx tsc --noEmit
npm run build
npm run dev   # 관리자 로그인 → 포트폴리오 › ACWI › 팩터 백테스트
```

## 3-1. push 전 로컬 확인 (R2·Vercel 없이)

웹앱 `sealedData.ts` 는 `SEALED_DATA_LOCAL_DIR` 이 있으면 R2 대신 그 폴더(버킷과 같은 경로)를 읽습니다. 스크립트가 봉인 파일을 `Claude_DB/out/sealed_local/` 에 만들고 그 경로로 dev 서버를 띄웁니다. 업로드·커밋 없음.

```bash
# 저장소 루트에서
bash Claude_DB/scripts/local_preview.sh             # 봉인 파일 재생성 + 복호화 검증 + npm run dev → http://localhost:3000
bash Claude_DB/scripts/local_preview.sh --build     # 배포와 같은 next build && next start
bash Claude_DB/scripts/local_preview.sh --rebuild   # 엑셀부터 분석기·백테스트 재계산 후 실행 (data/ACWI_v3.xlsx 필요, ~10분)
bash Claude_DB/scripts/local_preview.sh --index     # Index Monitor MSCI 봉인본도 재생성 (indexMonitorChanges.json 이 바뀜 → 커밋 여부 판단)
```
- 키: `Claude_DB/.env.local` 의 `SEALED_DATA_KEY` 를 그대로 씀 → 로컬에서 열리면 업로드 후 Vercel 에서도 열림(같은 키일 때)
- 관리자: `webapp/.env.local` 에 `CARDNEWS_ADMIN_SECRET` 등이 없으면 로컬 전용 비밀번호 `local-preview` 로 실행
- 확인 목록: 포트폴리오 › ACWI 스크리너(새 열) · 종목 상세 3Y/10Y 전환 · **팩터 백테스트**(유니버스 pit/pit_large/static 전환, 비용 0bp 에서 Q1 CAGR = `out/backtest/summary.csv`) · 리밸런싱 › Index Monitor
- 가장 빠른 확인(웹앱 없이): `open Claude_DB/out/analyzer_standalone.html` — 같은 데이터·같은 백테스트 탭
- `out/sealed_local/` 은 `out/` 아래라 gitignore 됨. 커밋하지 않음

## 4. 데이터 업로드 (R2 봉인)

```bash
python -m Claude_DB.factor.export_webapp            # 크기 확인: summary ~3.0MB(봉인 0.9MB) · series 32개 최대 ~490KB · backtest 2.4MB(봉인 0.8MB)
python -m Claude_DB.factor.export_webapp --upload   # Claude_DB/.env.local 의 SEALED_DATA_KEY · PRIVATE_UPLOAD_TOKEN 사용
```
- `out/webapp_export/` 는 업로드 직전에 새로 만든 것만 사용 (Claude 가 임시 키로 만든 검증본은 삭제해 둠)
- summary 응답이 약 3MB(JSON) — Vercel 응답 한도 4.5MB 이내. 이후 종목이 늘면 summary 분할 고려

## 5. GitHub 커밋

```bash
git checkout -b feat/acwi-backtest-10y
git add Claude_DB/factor/backtest.py Claude_DB/factor/timeseries.py Claude_DB/factor/technicals.py \
        Claude_DB/factor/fundamentals_ts.py Claude_DB/factor/engine.py Claude_DB/factor/analyzer.py \
        Claude_DB/factor/export_webapp.py Claude_DB/tests/test_analyzer.py Claude_DB/web/analyzer.html \
        Claude_DB/index_monitor/src/export_webapp.py Claude_DB/scripts/local_preview.sh \
        Claude_DB/.gitignore Claude_DB/README.md Claude_DB/docs/01_팩터검증_리포트.md Claude_DB/docs/05_팩터_백테스트.md Claude_DB/docs/06_Cursor_커밋_인수인계.md \
        webapp/src/components/acwi/AcwiBacktest.tsx webapp/src/components/AcwiAnalyzerTab.tsx \
        webapp/src/components/acwi/AcwiDetail.tsx webapp/src/components/acwi/AcwiScreener.tsx \
        webapp/src/lib/acwiAnalyzer.ts webapp/src/app/api/acwi-analyzer/route.ts webapp/src/app/globals.css
git status --short                      # 아래 '금지' 경로가 스테이징에 없어야 함
git diff --cached --stat
git commit -m "ACWI: 10년 팩터 백테스트(PIT 편출입 반영) + 거래량·매출·10년 시계열 반영"
git push -u origin feat/acwi-backtest-10y   # PR → main 머지 후 Vercel 배포 (stale tree 에서 vercel --prod 금지)
```
스테이징 금지: `Claude_DB/data/`, `Claude_DB/out/`, `Claude_DB/web/*data.js`, `Claude_DB/.env.local`, `webapp/.env*`, `out/webapp_export/`.
`git check-ignore -v Claude_DB/web/backtest_data.js Claude_DB/.env.local` 로 무시 규칙 확인.

## 6. 배포 후 QA

- [ ] 비로그인: `/api/acwi-analyzer?part=backtest` 401, 탭 비노출
- [ ] 관리자: 팩터 백테스트 첫 진입 시에만 요청(네트워크 탭), 헤더 `cache-control: private, no-store`
- [ ] 기본 화면 = PIT · 전체 · 종합(6팩터) · 20bp → KPI 롱숏 약 +6.1%(비용 후), IC t 4.00
- [ ] 유니버스 '현재 구성 고정' + 사이즈 → 롱숏 20%대, '대형·중형' → 2%대 (look-ahead 설명 카드와 일치)
- [ ] 신호 비교표 행 클릭 → 차트·KPI 전환, 연도별 표 2017(3개월)~2026(9개월)
- [ ] 종목 상세 005930.KS: '10년 월간' 전환, PER 10Y 위치 2, 매출 리비전 +18% 내외, 거래대금 약 3.4십억$
- [ ] 다크 모드 · 모바일 390px 가로 스크롤 없음

## 6-1. Cursor 검토·배포 결과 (2026-10-06)

- 재현: `ACWI_v3.xlsx` 로 analyzer·backtest 재실행 → `out/backtest/summary.csv`·`coverage.csv` 가 Claude 산출물과 **바이트 단위 동일**, `summary.json` 은 built_at 만 다름. 점수 2,238 / 제외 28, AUC 0.920(상위 100 적중 54), 108개월, PIT 종합 롱숏 7.75%·샤프 0.98·IC t 4.00, 사이즈 22.63/12.67/2.30, 모멘텀(pit_large) 7.67%·t 2.43. unittest 28 OK
- 업로드: `export_webapp --upload` → R2 `private/acwi/latest/` 34개 (summary 3.05MB→봉인 0.92MB, backtest 2.36MB→0.79MB, series 최대 489KB)
- Index Monitor MSCI 봉인본은 재업로드 안 함 (바뀐 것은 로컬 사본 경로뿐)
- 배포: 웹앱 커밋 `4e10060` (main 직접 푸시 · Vercel success). 이어서 `Claude_DB/` 코드·문서를 처음 커밋 — `.gitignore` 에 `data/`(하위 archive 엑셀 포함)·`index_monitor/data/`(MSCI PDF·psv·iShares CSV·MSCI 행이 든 seed)·생성 `index_monitor/web/index_monitor.html` 을 추가해 원자료·파생물은 제외
- 같이 배포한 엑셀 다운로드(클라이언트에서 생성, 셀 범위를 참조하는 Excel 네이티브 차트 · `webapp/src/lib/xlsxCharts.ts`)
  - 리밸런싱(공개): 상단 + '과거 정기변경 전후 주가' 섹션 버튼 → 평균·종목별 경로, 이벤트 요약·종목별, 매매일정, 정기변경 ETF, 선택일 순매매, 충격종목, ETF별 예상매매 (차트 5)
  - Index Monitor: 지수별·월별 건수, 변경내역, 다가오는 일정 (차트 2). 관리자 화면에서만 MSCI 행 포함
  - ACWI(관리자): 종목 전체·벤치마크·브레드스·MSCI 이벤트/관찰/미반영/리뷰이력 + 백테스트(유니버스 3종 종합 5분위·롱숏 누적, 팩터 롱숏, 월수익률·IC, 연도별, 신호비교, 커버리지, 팩터상관) (시트 24 · 차트 18). 종목 상세에 '종목 엑셀'(주간·월간 시계열, 차트 4)
- QA: 로컬 `next start` + `SEALED_DATA_LOCAL_DIR` 로 백테스트 기본 화면 롱숏 +6.1%(20bp)·IC t 4.00 확인, 엑셀은 Microsoft Excel 에서 차트·`=SERIES()` 수식 인식 확인, 모바일 가로 넘침 없음. 운영: 비로그인 `?part=backtest`·`summary` 401 + `private, no-store`, 공개 Index Monitor 262행·MSCI 0

## 7. 다음 후보

1. 생존 편향 축소: `index_monitor/data/out/acwi_name_map_todo.csv`(편출 종목명) → ISIN 매핑 → 그 종목들의 월간 RI·EPS·BPS·DPS 10년을 Datastream 에서 추가 → `membership_mask` 가 그대로 사용
2. USD 기준 백테스트: 월간 `X(RI)~U$` 10년 시트 추가 시 `ri_m` 대신 사용하는 옵션
3. 퀄리티 정의 재검토 (현재 10년 음수), 팩터 가중 최적화(최근 N년 IC 가중) — 표본 내 과최적화 주의
4. 백테스트 엔진 속도 개선(numpy), 분위 수·시총가중 옵션을 화면에서 선택
