# 08. Cursor 인수인계 — 국가·업종·테마 밸류에이션 + ETF 룩스루 (2026-10-14)

- 작성: 2026-10-14 (Claude) · 받는 쪽: Cursor
- 범위: ① ACWI 전 종목 국가·업종·테마 분류 → 그룹별 10년 PER·PBR·PSR·배당·ROE·성장률 합산 ② 주요 ETF 72개 보유종목 × ACWI 시계열 룩스루(프로토타입)
  ③ 웹앱 포트폴리오 › ACWI 에 **'국가·업종·테마'** 보기 추가 (관리자 전용, 기존 봉인 R2 구조 그대로)
- 먼저 읽기: `README.md` 의 '국가·업종·테마 밸류에이션' 절 → `docs/07_ETF_룩스루_프로토타입.md` (ETF 조사·수집 경로·검증) → 이 문서
- **Claude 는 맥 작업 트리에 파일만 썼고 git 명령(add·commit·push)과 R2 업로드는 하지 않았습니다.** 작업 트리 기준 커밋 `ac78d59` (main 최신, 겹치는 파일 없음)

---

## 0. 시작 전

1. 저장소 루트, `git status` 로 아래 §1 목록과 같은지 확인 (`.next/`·`exports/`·루트 `package-lock.json`·`11_받은자료/` 는 이번 작업과 무관한 기존 미추적 파일 — 건드리지 않음)
2. 파이썬은 **`.venv-sf/bin/python`** 사용 권장. 이번에 `.venv-sf` 에 `cryptography`(봉인)·`openpyxl>=3.1`(SPDR xlsx·engine 테스트) 를 설치함.
   기본 `python3`(anaconda 3.8) 는 `export_webapp.py` 의 `str.removeprefix` 에서 실패 → `local_preview.sh` 를 쓸 때는 `PYTHON=.venv-sf/bin/python` 지정
3. 원자료는 `Claude_DB/data/ACWI_v3.xlsx` (= `11_받은자료/(신투증) ACWI  퀀트 유니버스.xlsx`, md5 동일). 시계열 캐시 `out/ts_cache_1fc178c3f81d.pkl` 이 있어 재계산이 빠름

## 1. 바뀐 파일

### Python (`Claude_DB/`) — 커밋 대상
| 파일 | 상태 | 내용 |
|---|---|---|
| `factor/themes.py` | **신규** | GICS 산업 73개 → 산업그룹 25개·한글명 매핑 `INDUSTRY`, 투자 테마 33개 `THEMES` (코드 직접 지정 + 산업 규칙 + 제외, 다중 분류), `theme_members()` |
| `factor/groups.py` | **신규** | 분류(`classify`) → 그룹 정의(지역 6 · 국가 48 · 섹터 11×범위 10 · 산업그룹 25 · 산업 73 · 테마 33) → 종목×월 패널(`_stock_panels`) → 합산(`aggregate`, `snapshot_cy`) → `web/groups_data.js`·`out/groups/*.csv`. ETF 블록(`_etf_block`)도 여기서 합산 |
| `factor/etf_lookthrough.py` | **신규** | ETF 목록 72개(`ETFS`), iShares·SPDR 보유종목 수집(`fetch`), 표준화(`read_holdings`), ACWI 코드 매칭(`Universe.match`), 결과 `data/etf_holdings/mapped/` |
| `factor/analyzer.py` | 수정 | 빌드 끝에서 `groups.build()` 자동 호출 (월간 10년 시트 있을 때), 도움말 |
| `factor/export_webapp.py` | 수정 | `web/groups_data.js` 가 있으면 **`groups.bin`** 봉인 추가, 크기 출력 루프 |
| `tests/test_groups.py` | **신규** | 지수식 PER·YoY 성장·PBR(자본잠식 제외)·배당, 비중 확대 상한, 단절 제거, 테마·산업 매핑 (4) |
| `tests/test_etf_lookthrough.py` | **신규** | CUSIP→ISIN, 티커/이름/별칭 매칭 규칙, 오매칭 거부, ETF 가중 합산 = 지수식 (4) |
| `.gitignore` | 수정 | `web/groups_data.js` 추가 (Datastream 파생) |
| `README.md` | 수정 | 모듈 표·실행법·'국가·업종·테마 밸류에이션' 절 |
| `docs/07_ETF_룩스루_프로토타입.md`, `docs/08_…`(이 문서) | **신규** | |

### 웹앱 (`webapp/src/`) — 커밋 대상
| 파일 | 상태 | 내용 |
|---|---|---|
| `components/acwi/AcwiGroups.tsx` | **신규** | 분류(지역·국가·섹터·산업그룹·산업·테마·ETF) / 범위·ETF 분류 / 지표 9개 / 기간 / 수준·ACWI 대비 전환, 비교 차트(최대 8개), 표 2종(선택 지표 10년 비교 · 전체 지표), CSV 저장, 선택 그룹 KPI·미니차트 6개·구성 종목(ETF 는 ETF 비중·커버리지·비교 그룹 점선) |
| `components/AcwiAnalyzerTab.tsx` | 수정 | 보기 `groups`('국가·업종·테마') 추가. `?part=groups` 는 처음 열 때만 요청, 실패 시 재시도 |
| `lib/acwiAnalyzer.ts` | 수정 | 타입 `GroupMetricKey`·`GroupDim`·`AcwiGroup`(etf·wts 선택 필드)·`AcwiGroupSeries`·`AcwiGroups` |
| `app/api/acwi-analyzer/route.ts` | 수정 | `?part=groups` → `private/acwi/latest/groups.bin` (`requireSiteAdmin` · `PRIVATE_NO_STORE` 그대로, public 분기는 변경 없음) |
| `app/globals.css` | 수정 | `.aa-gctl`·`.aa-dot`·`.aa-selchips`·`.aa-spark`·`.aa-themes` (ACWI 백테스트 CSS 바로 아래) |

### 생성물·원자료 — **커밋 금지**
`Claude_DB/web/groups_data.js`(3.3MB) · `Claude_DB/out/**`(`out/groups/` CSV 3종, `out/sealed_local/`) · `Claude_DB/data/etf_holdings/**`(운용사 보유종목 원본·매칭·`ishares_screener.json`) · `Claude_DB/.env.local`.
확인: `git check-ignore -v Claude_DB/web/groups_data.js Claude_DB/data/etf_holdings/raw Claude_DB/out/groups/latest.csv` 가 모두 무시 규칙을 출력해야 함.

## 2. 검토 (Python)

```bash
.venv-sf/bin/python -m unittest discover -s Claude_DB/tests -t .          # 36 OK (engine 12 · analyzer 16 · groups 4 · etf 4)
.venv-sf/bin/python -m Claude_DB.factor.etf_lookthrough                    # 받아 둔 보유종목으로 매칭만 (~5초). --fetch 는 네트워크로 새로 받기 (~1분)
.venv-sf/bin/python -m Claude_DB.factor.groups                             # out/stocks.csv + 시계열 캐시 (~5초)
```

재현 기준값 (원자료 ACWI_v3, 보유종목 2026-10-12)
| 항목 | 기대값 |
|---|---|
| 분류 종목 / 그룹 수 | 2,238 / 363 (지역 6 · 국가 48 · 섹터 106 · 산업그룹 25 · 산업 73 · 테마 33 · ETF 72) |
| 품질 | drift_capped 13 · 단절 EPS 62 / BPS 76 / DPS 44 / 매출 27 · theme_missing_codes 없음 · 테마 없는 종목 69.8% |
| ACWI Fwd PER | 2020-10 **20.6** · 2022-10 **14.0** · 2026-10 16.05 |
| 미국 Fwd PER | 2020-10 23.2 · 2022-10 16.4 |
| 유럽 선진 2016-10 | 15.5 (BMPS 비중 상한 전에는 18.1 이었음) |
| 한국 CY 성장 | EPS CY26 +312% · CY27 +36% / 매출 +45% · +21% |
| ETF | SPY 19.2 (미국 집계 19.2) · 2020-10 23.1 (23.2) · EWY 6.0 (한국 5.2), EWY 커버리지 99.9% |
| 커버리지 낮은 ETF | THD 59%(값 없음, 아래 §6-2) · IHAK 32% · XME 31% · XAR 44% · ICLN 54% · IBB 57% |

검토 포인트 (코드 위치)
1. **합산식** `groups.aggregate`: PER = ΣW/ΣE (적자 포함), PBR·ROE 는 B>0 종목만, YoY 성장은 t·t-12 모두 있는 종목 묶음. M 이 0/1(ACWI 그룹, P 는 ACWI 비중)이든 ETF 비중(P 는 비중 1)이든 같은 식 — 표본 수는 `Mb=(M>0)` 로 셈
2. **과거 비중** `_stock_panels`: W = 현재 ACWI 비중 × P_t/P_now (RI 에서 현재 배당수익률로 배당 재투자분 제거, `fundamentals_ts` 와 같은 근사). 증자·감자 종목은 시장 중앙값 대비 `DRIFT_CAP=15` 배 초과분을 W·E·B·D·S 같은 비율로 축소 (종목 자체 배수 보존)
3. **단절 제거** `clean_breaks`: 월간 |log 변화| > log10(EPS·DPS) / log4(BPS·매출) 이면 그 이전 버림 — 기준이 너무 엄격/느슨한지 `info["*_breaks"]` 로 확인
4. **CY 성장** `_stock_panels` 끝: 연도 추정치를 같은 열의 NTM 블렌드(`f26`=남은 CY26 개월 비중, 12월 결산 가정)에 맞춰 척도화 — 한국 매출처럼 월간 시트와 단위가 다른 경우 대비. 태국은 연도 매출 원자료가 없어 결측
5. **화면 결측 규칙** `AcwiGroups.tsx` `MIN_COV=60`: 현재 비중의 60% 미만만 데이터가 있는 달은 비움 (중국 2016~2019 가 이 영향 — MCHI 등 상장 늦은 종목)
6. **테마 사전** `themes.py`: 이름을 보고 손으로 고른 코드 목록 — 정기변경 후 `theme_missing_codes` 로 점검. 정의를 바꾸면 화면 수치가 바뀌므로 의견 있으면 여기서 수정
7. **ETF 매칭** `etf_lookthrough.Universe.match`: ISIN(SPDR CUSIP) → 거래소 접미사+티커 → 이름(엄격) → `ALIASES`. 비중 0.2% 이상 이름 매칭은 Claude 가 전수 대조(오매칭 0). 이름 규칙을 느슨하게 바꾸면 METALLUS→Meta 같은 오류가 재발하니 `tests/test_etf_lookthrough.py::test_rejects_lookalikes` 유지
8. **성능**: groups 5초, 매칭 4초 (이름 후보를 앞 2글자로 가지치기). 봉인 groups.bin 1.09MB — summary(0.92MB)와 별도라 첫 화면 로딩 영향 없음

## 3. 검토·빌드 (웹앱)

```bash
cd webapp
npm run check:imports
npx tsc --noEmit          # Claude 환경에서 통과 확인
npm run build
```

## 3-1. push 전 로컬 확인

봉인 사본은 `Claude_DB/out/sealed_local/private/acwi/latest/` 에 최신본(groups.bin 포함)이 이미 있음.

```bash
# 저장소 루트에서 — 봉인 재생성 + dev (포트 3000)
PYTHON=.venv-sf/bin/python bash Claude_DB/scripts/local_preview.sh
```
- 맥에 이미 3000 포트 next-server 가 떠 있으면 충돌 → Claude 는 아래처럼 **3123 포트**로 띄워 확인함 (관리자 비밀번호 `local-preview`, 로컬 전용)
```bash
cd webapp && SEALED_DATA_KEY="$(grep -E '^SEALED_DATA_KEY=' ../Claude_DB/.env.local | tail -1 | cut -d= -f2- | tr -d "\"'")" SEALED_DATA_LOCAL_DIR="$PWD/../Claude_DB/out/sealed_local" CARDNEWS_ADMIN_SECRET=local-preview npx next dev -p 3123
```
- 확인 경로: 관리자 로그인 → 포트폴리오 › ACWI › **국가·업종·테마**

## 4. 데이터 업로드 (R2 봉인)

```bash
.venv-sf/bin/python -m Claude_DB.factor.export_webapp            # groups 3.33MB (봉인 1.09MB) · summary 3.05MB (0.92MB) · backtest 2.36MB (0.79MB)
.venv-sf/bin/python -m Claude_DB.factor.export_webapp --upload   # private/acwi/latest/ 에 groups.bin 추가 (나머지는 내용 동일 재업로드)
```
- **배포 순서**: 웹앱을 먼저 배포해도 groups.bin 이 없으면 보기에 "그룹 집계가 아직 업로드되지 않았습니다" 만 뜨고 다른 보기는 정상. 반대로 업로드 먼저 해도 기존 화면 영향 없음

## 5. GitHub 커밋

```bash
git checkout -b feat/acwi-groups-etf-lookthrough
git add Claude_DB/factor/themes.py Claude_DB/factor/groups.py Claude_DB/factor/etf_lookthrough.py \
        Claude_DB/factor/analyzer.py Claude_DB/factor/export_webapp.py \
        Claude_DB/tests/test_groups.py Claude_DB/tests/test_etf_lookthrough.py \
        Claude_DB/.gitignore Claude_DB/README.md \
        Claude_DB/docs/07_ETF_룩스루_프로토타입.md Claude_DB/docs/08_Cursor_커밋_인수인계_국가업종테마_ETF.md \
        webapp/src/components/acwi/AcwiGroups.tsx webapp/src/components/AcwiAnalyzerTab.tsx \
        webapp/src/lib/acwiAnalyzer.ts webapp/src/app/api/acwi-analyzer/route.ts webapp/src/app/globals.css
git status --short          # 스테이징에 data/ · out/ · web/*data.js · .env* 가 없어야 함
git diff --cached --stat    # 16개 파일
git commit -m "ACWI: 국가·업종·테마별 10년 밸류에이션 합산 + ETF 72개 룩스루(프로토타입)"
git push -u origin feat/acwi-groups-etf-lookthrough   # PR → main 머지 후 Vercel 배포
```

## 6. 배포 후 QA

- [ ] 비로그인: `/api/acwi-analyzer?part=groups` → 401, `?part=public` 응답에 그룹 데이터 없음
- [ ] 관리자: '국가·업종·테마' 첫 진입 때만 `part=groups` 요청, 헤더 `cache-control: private, no-store`
- [ ] 섹터 · ACWI · Fwd PER 10년: 표 정렬 = ACWI 비중순, IT 현재 17.1 · 10년 평균 20.8
- [ ] 지역 › ACWI 차트에서 2020-10 ≈ 20.6, 2022-10 ≈ 14.0 (툴팁)
- [ ] 국가 › '전체 지표 한눈에' 한국: PER 5.2 · EPS CY27 +35.8% · 매출 CY27 +21.0%
- [ ] ETF › 국가 › EWY 클릭: ETF 비중 SK하이닉스 23.9% · 삼성전자 23.3%, 미니차트에 '비교: 한국' 빨간 점선
- [ ] ETF › 지역 › SPY PER 19.2, 커버리지 99%
- [ ] 수준 ↔ ACWI 대비 전환 (배수는 비율·ACWI=1 기준선, % 지표는 %p 차이)
- [ ] CSV 저장 파일이 엑셀에서 한글 깨짐 없이 열림 (BOM 포함)
- [ ] 다크 모드 · 모바일 375px 가로 스크롤 없음 (Claude 확인함)

## 6-1. 판단이 필요한 것 (우열님)

1. **공개 범위**: groups·ETF 집계는 Datastream/I/B/E/S 파생이라 관리자 전용으로만 연결함. ETF 룩스루를 공개 화면(`AcwiPublic`)에 넣을지는 라이선스 확인 후 결정
2. **테마 정의 33개** (`themes.py`) — 투자 관점에서 넣고 뺄 종목 검토
3. **ETF 확장**: Global X·VanEck·Invesco·Vanguard 는 스크립트 다운로드가 막힘 (docs/07 §1). 인앱 브라우저 자동화 vs 유료 API(FMP 등) 선택
4. **ETF 과거 구성 반영**: iShares `asOfDate` API 로 분기별 보유종목을 받아 시점별 비중 적용 (현재는 오늘 비중 고정)

## 6-2. 알려진 문제 (이번 범위 밖)

- **태국**: 원자료에 태국 종목 월간 EPS 시계열이 없어 국가 태국·THD 값이 비어 있음 → 다음 Datastream 요청 때 `_n.BK` 코드 시계열 점검
- **기존 iShares 수집 코드 고장**: `03_ETF/etf_holdings.py`·`etf_memb_us.py` 가 쓰는 `…/1467271812596.ajax?fileType=csv` 는 지금 봇 차단 HTML 을 돌려줌. `Claude_DB/index_monitor/data/raw/ishares_acwi/ACWI_holdings_*.csv` 161개도 실제 내용은 HTML.
  새 경로 `ishares.com/us/products/{portfolioId}/x/latest-holdings.csv` (또는 BlackRock `get-fund-document?…&asOfDate=`) 로 바꾸면 됨 — `etf_lookthrough.ishares_ids()`·`fetch()` 참고
- `webapp` dev 실행 시 `@next/swc-darwin-arm64` 미설치·lockfile 2개 경고는 기존부터 있던 것 (동작 영향 없음)
