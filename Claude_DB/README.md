# Claude_DB · ACWI 팩터 스코어보드

MSCI ACWI 전 종목(2,239개)의 재무 추정치와 6개 팩터(가치·사이즈·배당·성장·모멘텀·퀄리티) 점수를
계산해 DB(SQLite/CSV/JSON)로 저장하고, 한 화면에서 보는 웹 대시보드를 만드는 작업 공간입니다.
SavvyETF 본체(봇·웹앱)와 분리돼 있어서 이 폴더만 고쳐도 기존 배포에 영향이 없습니다.

```
Claude_DB/
├── factor/
│   ├── config.py        엑셀 열 매핑 · 팩터 정의 · 가중치 · 국가/통화 매핑 · 환율 · 통화보정 규칙
│   ├── engine.py        로드 → 정제 → 통화보정 → 디스크립터 → 윈저라이징 → 섹터×지역 Z → 팩터 → 종합
│   │                    + original_scores(): 원본 엑셀 로직을 '전 행 채움'으로 재현 (비교용)
│   ├── build.py         out/ 의 DB·CSV·JSON, web/data.js, 단일파일 대시보드 생성
│   ├── intake.py        새 파일 점검 리포트 (요청식·결측·값 상식·MSCI 구성 대조·이전 파일 비교)
│   ├── timeseries.py    시계열 시트 로더 — Price(Daily_3Y)·Volume(Daily_3Y)·Price_(Monthly_10Y)·EPS·BPS·DPS·SALE
│   │                    (시트 이름 키워드 인식, 잔여행 제거·이상치 점검, 캐시 out/ts_cache_*.pkl)
│   ├── technicals.py    수익률·변동성·MDD·52주·MA·크로스·RSI·MACD·볼린저·베타·추세점수 + 거래량(거래대금·거래량비·OBV)
│   ├── fundamentals_ts.py EPS·매출 리비전·BPS/DPS 성장·배당 삭감·근사 PER/PBR/배당 3년·10년 위치·브레드스
│   ├── backtest.py      10년 팩터 백테스트 (월간, 5분위, PIT 유니버스·대형중형·현재고정 비교) → web/backtest_data.js
│   ├── export_webapp.py 분석기·백테스트 결과 → 웹앱용 봉인 파일 (R2 private/acwi/latest/)
│   ├── index_link.py    MSCI 편출입 연동: 종목별 편입 이력·미반영 변경·이벤트 스터디·편출 관찰 리스트
│   ├── analyzer.py      종목 분석기 빌드 (위 모듈 + 팩터 → web/analyzer_data.js, out/analyzer/)
│   ├── excel_v2.py      원본 엑셀에 수정 산식 시트(FACTOR_v2 등) 추가 → excel/ACWI_factor_v2.xlsx
│   └── xlsx_inject.py   원본 xlsx 패키지를 그대로 두고 시트만 끼워 넣기 (Datastream 메타데이터 보존)
├── data/ACWI_v3.xlsx    입력 (2026-10-06 수령: UNIVERSE + 일간 3년 Price·Volume + 월간 10년 Price·EPS·BPS·DPS·SALE)
├── data/ACWI_raw.xlsx   이전 입력 (2026-10-02, UNIVERSE 만)
│   └── archive/ACWI_raw_2026-09-30_local.xlsx   이전 파일 (현지통화 추정치, 테스트용)
├── excel/ACWI_factor_v2.xlsx   수정 산식 포함 엑셀 (원본 시트는 바이트 그대로)
├── out/
│   ├── acwi_factor.db   SQLite: stocks · sector_stats · excluded · agg_sector · agg_country · factor_defs · meta
│   ├── stocks.csv       종목별 원자료 + 디스크립터 Z + 팩터 점수 + 종합 + 원본로직 점수
│   ├── sector_stats.csv 섹터×지역 그룹별 평균·표준편차·N
│   ├── excluded.csv     제외 종목과 사유
│   ├── summary.json     메타 · 팩터 정의 · 상관 · 섹터/국가 집계
│   ├── acwi_dashboard_standalone.html   data.js 를 인라인한 단일 파일 (메일·공유용)
│   ├── analyzer_standalone.html         종목 분석기 단일 파일
│   └── analyzer/        stocks_full.csv(전 지표) · breadth_*.csv · msci_event_study.csv · msci_pending.csv ·
│                        msci_deletion_watch.csv · ri_anomalies.csv · quality.json
├── web/
│   ├── index.html       팩터 스코어보드 (브라우저로 바로 열림, 서버 불필요)
│   ├── data.js          build 결과 (window.ACWI)
│   ├── analyzer.html    ACWI 종목 분석기 (시장 개요·스크리너·종목 상세·MSCI 편출입·팩터 백테스트·데이터)
│   ├── analyzer_data.js analyzer 결과 (window.ANALYZER, 약 15MB — 10년 월간 시계열 포함)
│   └── backtest_data.js backtest 결과 (window.BACKTEST, 약 2.4MB)
├── docs/
│   ├── 01_팩터검증_리포트.md   원본 엑셀 검증 결과와 수정 내역
│   ├── 02_Cursor_작업목록.md   다음 작업 후보
│   ├── 03_ACWI_종목분석기.md   2026-10-02 시계열 파일 점검·모델 변경·MSCI 연동 결과
│   ├── 04_홈페이지_배포_인수인계.md   Cursor 검토·웹앱(관리자 탭) 배포 인수인계
│   ├── 05_팩터_백테스트.md         2026-10-06 파일 점검 · 10년 백테스트 방법·결과·한계
│   └── 06_Cursor_커밋_인수인계.md  2026-10-06 작업분 검토·빌드·GitHub 커밋·배포 절차
└── tests/test_engine.py, test_analyzer.py
```

## 실행 (저장소 루트에서, `.venv` 활성화)

```bash
# 1) 엑셀 → DB/CSV/JSON/웹 데이터
python -m Claude_DB.factor.build --as-of 2026-09-30
python -m Claude_DB.factor.build --xlsx ~/Downloads/새로받은파일.xlsx --as-of 2026-10-31
python -m Claude_DB.factor.build --neutral sector          # 섹터 중립만 (원본 방식)

# 2) 수정 산식 엑셀 다시 만들기 (원본 = v2 시트가 없는 파일)
python -m Claude_DB.factor.excel_v2 --xlsx Claude_DB/data/ACWI_raw.xlsx --out Claude_DB/excel/ACWI_factor_v2.xlsx

# 3) 종목 분석기 (시계열 시트가 있는 파일) — 스코어보드도 같이 갱신, 약 3~4분
python -m Claude_DB.factor.analyzer --xlsx Claude_DB/data/ACWI_v3.xlsx --as-of 2026-10-01
# 3-1) 10년 팩터 백테스트 (Price_(Monthly_10Y)·EPS·BPS·DPS·SALE 월간 시트 필요) — 약 6~7분
python -m Claude_DB.factor.backtest --xlsx Claude_DB/data/ACWI_v3.xlsx            # --lag 1 = 신호 1개월 지연
python -m Claude_DB.factor.analyzer --xlsx ... --skip-pit     # 편출입 재구성 생략(약 1분)

# 4) 화면
open Claude_DB/web/index.html       # 팩터 스코어보드
open Claude_DB/web/analyzer.html    # 종목 분석기

# 5) SavvyETF 포트폴리오 › ACWI 탭(관리자 전용)에 올리기 — 봉인(AES-GCM) 후 R2 비공개 경로
python -m Claude_DB.factor.export_webapp            # out/webapp_export/ 에 봉인 파일만 만들고 복호화 검증 (backtest.bin 포함)
python -m Claude_DB.factor.export_webapp --upload   # + https://savvyetf.com/api/private-upload 로 업로드
bash Claude_DB/scripts/local_preview.sh             # push 전 로컬 확인: out/sealed_local/ 봉인본으로 웹앱 dev 서버 (docs/06 §3-1)

# 테스트
python -m unittest discover -s Claude_DB/tests -t .
```

필요 패키지: `pandas`, `numpy`, `openpyxl>=3.1` (`excel_v2` 가 3.0 에서 깨짐), 업로드에는 `cryptography`.
업로드에 쓰는 `Claude_DB/.env.local` (gitignore): `SEALED_DATA_KEY` (Vercel 과 같은 값, `python -m Claude_DB.sealed_r2 --new-key` 로 최초 1회 생성)
와 `PRIVATE_UPLOAD_TOKEN` (업로드 전용 토큰, Vercel 프로덕션에 같은 값 — `private/acwi/`·`private/index_monitor/` 서명 URL 발급만 가능.
없으면 `SAVVY_ADMIN_SECRET` 관리자 비밀번호로도 됨). python.org 파이썬이면 `certifi` 도 설치. Index Monitor 의 MSCI 행도 같은 방식 — `index_monitor/src/export_webapp.py --upload`.

## 데이터를 새로 받을 때

1. 엑셀에서 Datastream/Refinitiv 새로고침 후 저장. 열 위치가 바뀌거나 열이 추가돼도 됩니다 —
   엔진이 1~3행 헤더의 요청식(`X~U$`, `EPS1FD12`, `TR.CommonName` …)으로 열을 찾고, 데이터 행 수도 자동으로 셉니다.
2. **점검 먼저**: `python -m Claude_DB.factor.intake --xlsx <파일>` → `out/intake/intake_report.md`
   - 요청식 개선 반영 여부(주가 ~U$, 수익률 변동성, RI·USD 수익률, MSCI 국가코드), 결측률, 값 상식 이탈,
     **MSCI ACWI 편출입 이력과 대조해 이 목록이 어느 정기변경까지 반영됐는지**, 이전 파일 대비 추가·삭제
   - `--build --as-of <기준일>` 을 붙이면 빌드까지 하고 이전 결과와 순위상관·상위 100 유지율을 붙입니다
3. `python -m Claude_DB.factor.build --xlsx <파일> --as-of <기준일>`
3. 엔진은 3행 헤더의 `~U$` 를 보고 데이터 형태를 자동 판별합니다 (`engine.load_raw` → `attrs["usd"]`).
   - **추정치 USD(현재 파일)**: EPS·BPS·DPS·MV 는 그대로 쓰고, 현재가(X, 현지통화)만 `config.FX_PER_USD` 환율과
     호가단위(영국 펜스 등)로 USD 환산 (`engine.to_usd`). 호가단위가 시장 기본과 다른 종목은 P/E 범위로 판별하고,
     거래소와 다른 통화로 호가되는 종목은 `config.PRICE_CCY_OVERRIDE` 에 적습니다.
   - **주가도 X~U$ 로 받으면** 환산·단위 판별이 모두 생략됩니다 (권장).
   - 구버전(현지통화 추정치) 파일은 `engine.fix_currency` 의 보고통화 추정 보정으로 처리합니다.
   - 환율 갱신이 필요하면 `config.FX_PER_USD`, `FX_ASOF` 를 고치세요.

## 모델 요약

| 팩터 | 디스크립터 (방향) |
|---|---|
| 가치 | Fwd E/P(+), Fwd B/P(+), Fwd FCF 수익률(+) |
| 사이즈 | ln(USD 시가총액)(−) — Datastream MV~U$ |
| 배당 | Fwd 배당수익률(+), DPS 추정치 1Y 변화(+) |
| 성장 | EPS 성장 CY27/26(+), 매출 성장 CY27/26(+) |
| 모멘텀 | 12-1M 수익률(+) — 시계열 있으면 RI 총수익의 **국가 중앙값 대비**, + EPS NTM 3M 리비전(+) |
| 퀄리티 | Fwd ROE(+), D/E(−, 금융 제외), 변동성(−) — 시계열 있으면 RI 일간수익률 1Y 연율, 없으면 SD÷주가 |

시계열 시트가 없는 파일은 예전과 똑같이 계산됩니다(`engine.run(..., ts=None)` 로 강제 가능).
최근 10거래일에 ±40% 급변한 종목(스핀오프·분할 미조정 의심)은 밸류·배당 디스크립터를 비웁니다.

윈저라이징 1/99% → 섹터×지역(미국/선진/신흥) 중립 Z, ±3 절단 → 디스크립터 평균 → 그룹 내 재표준화 →
가중합(기본 동일가중) → 전체 Z. 결측 팩터는 0(그룹 평균). 상세는 `docs/01_팩터검증_리포트.md`.

## DB 예시 쿼리

```sql
-- 섹터별 종합 상위 3
SELECT sector_ko, rank, code, name, ROUND(composite,2) z
FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY sector ORDER BY composite DESC) rn FROM stocks)
WHERE rn <= 3 ORDER BY sector_ko, rn;

-- 통화 보정된 종목
SELECT code, name, currency, report_ccy, fx_method, ROUND(pe,1) FROM stocks WHERE fx_fixed = 1;
```

## 주의

- `data/`, `excel/`, `out/`, `web/data.js`, `web/analyzer_data.js` 에는 Datastream/Refinitiv 라이선스 데이터가 들어 있습니다.
  공개 저장소에 올리지 않도록 `.gitignore` 에 넣어 두었습니다 (`web/data.js` 포함). 공개 배포가 필요하면 범위를 따로 정하세요.
