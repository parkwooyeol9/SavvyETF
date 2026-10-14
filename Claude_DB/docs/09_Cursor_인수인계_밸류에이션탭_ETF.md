# 09. Cursor 인수인계 — 밸류에이션 탭을 ACWI 기반 ETF 집계로 교체 (2026-10-14)

- 작성: 2026-10-14 (Claude) · 받는 쪽: Cursor
- 기준 커밋: `c2949e9` (#139, 국가·업종·테마 + ETF 룩스루 프로토타입 — docs/08 작업분이 이미 main 에 있음). 이 문서는 그 위의 **추가 변경**만 다룬다
- 요청(우열님): 포트폴리오 › 밸류에이션 탭의 엑셀 수기 데이터(savvyDB)를 지우고, ACWI 분석기에 있던 ETF 룩스루를 밸류에이션 탭으로 옮겨 대체
- **Claude 는 파일만 고쳤고 git add/commit/push·R2 업로드는 하지 않았다** (중간에 `git rm` 으로 스테이징된 것은 `git reset` 으로 되돌림 — 지금 스테이징 0)

---

## 0. 무엇이 바뀌었나 (요약)

| 항목 | 전 | 후 |
|---|---|---|
| 밸류에이션 탭 데이터 | savvyDB(엑셀 → `savvydb.savvyetf.chatgpt.site` JSON), 수기 갱신 | `Claude_DB/factor/etf_valuation.py` → 봉인 `etf_valuation.bin` → `/api/etf-valuation` |
| 밸류에이션 탭 화면 | `ValuationTab.tsx` 2,522줄 (업종·스타일/테마 펀더멘털/미국 주식/국가 모델/장기 밸류에이션/ETF 비교 6개 보기) | ACWI 분석기와 같은 `AcwiGroups` 보기를 ETF 전용으로 (분류 6개 칩 · 지표 10개 · 10년 차트 · 표 · 구성종목) |
| ETF 수 | 섹터 28 · 국가 ~50 · 테마 33 (엑셀) | **123** = 보유종목 룩스루 84 + ACWI 근사 39, 제외 10 (사유 화면 표시) |
| ACWI 분석기 › 국가·업종·테마 | 분류에 'ETF' 포함 | 'ETF' 제거 (밸류에이션 탭으로 이동), 지표에 'EPS 리비전 1M' 추가 |
| 공개 범위 | 밸류에이션 탭 공개 | 그대로 공개. **ETF 단위 집계 + 구성종목 이름·비중만** 공개, 종목별 PER·리비전 등은 관리자 로그인 시에만 (`?part=stocks`) |

### 설계 판단 (왜 이렇게 했나)
1. **보유종목 + 근사 혼합**: 보유종목을 스크립트로 받을 수 있는 건 iShares·SPDR 뿐 (Global X·VanEck·Invesco·First Trust·KraneShares 는 차단 확인, docs/07 §1).
   예전 탭의 ETF 를 빠짐없이 덮으려면 나머지는 'ACWI 근사'(같은 성격의 ACWI 종목 묶음)로 채우는 게 현실적. 화면 커버리지 열에 '근사' 배지로 구분
2. **PER = 지수 방식(조화평균)**: Σ시총 ÷ Σ이익. 예전 엑셀 값은 종목 PER 의 가중 산술평균과 일치(검증 §3) — 고PER 종목에 끌려 높게 나와 지수·ETF 운용사 공시와 다름.
   SOXX 보유종목 기준 산술 30.1(엑셀 28.5) vs 지수 방식 19.3. 화면 설명에 명시
3. **테마 근사는 한 종목 8% 상한**: 시총 가중 그대로면 테슬라 하나가 DRIV·LIT 근사를 지배(PER 81~84) → 상한 후 30 내외. 종목 12개 이하 테마는 균등의 1.2배 상한
4. **그룹 PER 150 초과 = 결측**: 흑자·적자가 상쇄되면 Σ이익 ≈ 0 이라 PER 이 수만으로 튐(DRIV 2022-11 약 26,000). groups.py 공통 적용 → ACWI 분석기 테마에도 반영
5. **예전 탭 지표 중 없는 것**: EV/EBITDA·주식위험프리미엄(ERP)·RSI·EPS 조정 1W/2W 는 원자료(월간 추정치)에 없어 제외. 대신 PSR·PEG·리비전 1M/3M·CY26/27 컨센서스 성장·10년 위치/Z 추가

## 1. 바뀐 파일

### Python (`Claude_DB/`)
| 파일 | 상태 | 내용 |
|---|---|---|
| `factor/etf_valuation.py` | **신규** | ETF 123개 조립: `load_mapped()`(보유종목) + `PROXIES`(근사 규칙 38개) + `LOW_COVERAGE_PROXY`(IHAK) + `UNAVAILABLE`, `cap_weights`, 비교선(ACWI 그룹) 계산 → `web/etf_valuation.js`(공개분) · `web/etf_valuation_stocks.js`(관리자) · `out/groups/etf_latest.csv` |
| `factor/etf_lookthrough.py` | 수정 | ETF 17개 추가(EIS·UAE·QAT·KWT·TUR·EPOL·EPHE·ENZL·EIRL·EDEN·ITB·IAI·SLVP / SPDR KRE·KIE·XOP·XTL) → 89개, 분류 '산업·테마'→'테마', Weight 열 없는 파일(IAI)은 Market Value 비율 |
| `factor/groups.py` | 수정 | `_etf_block` 과 ETF dim 제거, 지표 `er1`(EPS 리비전 1M) 추가, `MAX_PE=150` |
| `factor/analyzer.py` | 수정 | 빌드 끝에서 `etf_valuation.build()` 도 실행 |
| `factor/export_webapp.py` | 수정 | `etf_valuation.bin`·`etf_valuation_stocks.bin` 봉인 추가 |
| `tests/test_etf_valuation.py` | **신규** | 비중 상한, 근사 규칙 마스크, 커버리지 부족 시 근사/제외 (3) |
| `tests/test_groups.py` | 수정 | Σ이익 ≈ 0 이면 PER 결측 (+1) |
| `.gitignore` | 수정 | `web/etf_valuation.js`, `web/etf_valuation_stocks.js` |
| `README.md`, `docs/07_…`, `docs/09_…`(이 문서) | 수정/신규 | |

### 웹앱 (`webapp/src/`)
| 파일 | 상태 | 내용 |
|---|---|---|
| `components/ValuationTab.tsx` | **전면 교체** | `/api/etf-valuation?part=public` 로드 → `AcwiGroups` (제목·설명·방법 카드 전달). 관리자면 `?part=stocks` 추가 로드해 구성종목 지표 표시 |
| `app/api/etf-valuation/route.ts` | **신규** | `part=public`(기본, 비로그인, `public, s-maxage=600`) / `part=stocks`(`requireSiteAdmin`, `private, no-store`). 공개분 `meta.source` 는 원자료 파일명 대신 고정 문구 |
| `components/acwi/AcwiGroups.tsx` | 수정 | 재사용 가능하게: props `G, stocks?, onPick?, title?, intro?, notes?, csvPrefix?` (기존 `A` prop 제거). 분류 1개면 분류 칩 숨김, ETF 분류는 칩(개수 표시), ETF 이름 아래 설명, 커버리지 '근사' 배지, 전체 지표 표에 PEG·리비전 1M, 구성종목 지표 열은 지표가 있을 때만, `onPick` 없으면 클릭 없음 |
| `components/AcwiAnalyzerTab.tsx` | 수정 | `AcwiGroups` 에 `stocks={stockMap}` 전달 |
| `lib/acwiAnalyzer.ts` | 수정 | `GroupMetricKey` 에 `er1`, `GroupDim` 에 `cmp`(비교선 전용), `cy.peg`, `etf.method`·`asof: string|null`, `EtfValuation`·`EtfValuationStocks` 타입 |
| `middleware.ts` | 수정 | 레이트리밋 키 `/api/savvydb` → `/api/etf-valuation` |
| `app/globals.css` | 수정 | 예전 탭 전용 `.sdb-*` 규칙 21개 삭제 (다른 파일 사용처 없음 확인) |
| `lib/savvyDb.ts`, `app/api/savvydb/route.ts` | **삭제** | 다른 사용처 없음 (`grep -ri savvydb webapp/src` → 0) |

### 생성물 — 커밋 금지
`Claude_DB/web/etf_valuation.js`(2.1MB) · `web/etf_valuation_stocks.js`(0.4MB) · `web/groups_data.js` · `out/**` · `data/etf_holdings/**` · `.env.local`

## 2. 검토 (Python)

```bash
.venv-sf/bin/python -m unittest discover -s Claude_DB/tests -t .     # 40 OK
.venv-sf/bin/python -m Claude_DB.factor.etf_lookthrough             # 받아 둔 보유종목으로 매칭 (--fetch 는 새로 받기 ~1분)
.venv-sf/bin/python -m Claude_DB.factor.groups                      # ACWI 그룹 (ETF 없음) → n_groups 291
.venv-sf/bin/python -m Claude_DB.factor.etf_valuation               # n_etfs 123 · 보유종목 84 · ACWI 근사 39 · 제외 10
```

재현 기준값 (원자료 ACWI_v3, 보유종목 2026-10-12)
| 항목 | 기대값 |
|---|---|
| 분류별 ETF 수 | 국가 40 · 지역 10 · 섹터(미국) 11 · 섹터(글로벌) 10 · 섹터(일본) 16 · 테마 36 |
| 제외 10 | QTUM·SIXG·MOO(근사 규칙 없음) · ARGT·VNM·PAK(ACWI 미편입) · XME 31%·KRE 8%·XOP 38%·XTL 29%(커버리지) |
| 보유종목 ETF Fwd PER (2026-10) | SPY 19.2 · EWJ 15.7 · EWY 6.0 · SOXX 19.3 · IGV 26.7 · ITA 27.0 |
| 근사 ETF | DRIV 31.6(상한 전 84) · LIT 30.0 · CIBR 33.0(상한 전 68.3) · 1321.T 16.0 · 2644.T 15.1 |
| 그룹 PER 최댓값 | 150 이하 (theme:ev_battery 142.8 등) |
| 공개/관리자 파일 크기 | etf_valuation 2.10MB(봉인 0.70MB) · stocks 0.41MB(0.11MB) |

검토 포인트
1. `etf_valuation.PROXIES` 근사 규칙 38개 — 특히 일본 업종(TOPIX-17 ≠ GICS: 1625 는 실제로 '전기·정밀'인데 예전 탭 이름 '산업재'를 따름), 1343(J-리츠는 ACWI 에 거의 없어 개발사 위주), TAN(태양광 7종목+Sungrow), PAVE(미국 건설·기계·전기장비 산업)
2. `MIN_COVERAGE=40`, `THEME_CAP=8` 값의 적정성 (조정하면 화면 수치가 바뀜)
3. `AcwiGroups` 에서 `dim === "cmp"` 그룹은 표·분류에 안 나오고 비교 점선에만 쓰임
4. 공개 API 는 종목 단위 지표를 내보내지 않음 — `etf_valuation.js` 의 `stocks` 는 이름·국가·테마 분류만 (`etf_valuation.py` 의 `web["stocks"]`)
5. 과거 값은 현재 보유종목·비중 고정(생존 편향) — 화면 '분류 기준 · 계산 방법' 카드에 명시

## 3. 예전 탭 값과의 차이 (참고 · 2026-09 기준 비교)

| ETF | 엑셀(구) PER | 신규 PER | 보유종목 가중 산술평균 |
|---|---|---|---|
| SOXX | 28.5 | 17.8 | 30.1 |
| ITA | 31.1 | 29.6 | 31.9 |
| IAI | 21.5 | 18.1 | 22.8 |
| ARTY | 25.8 | 18.6 | 30.8 |

→ 엑셀은 종목 PER 의 가중 산술평균에 가까움. 신규는 지수 방식(조화평균). ROE·리비전은 엑셀 쪽에 극단값(IGV ROE 191, SKYY 1,363)이 있었음 — 산술평균 영향으로 판단

## 4. 웹앱 검토·로컬 확인

```bash
cd webapp && npm run check:imports && npx tsc --noEmit && npm run build
```
- `next dev` 중 파일을 지운 직후에는 브라우저가 지운 청크·404 를 캐시할 수 있음 → dev 서버 재시작(필요하면 `webapp/.next` 삭제) 후 새로고침
- 로컬 미리보기 (봉인 사본은 `Claude_DB/out/sealed_local/` 에 최신본 있음, 3000 포트가 쓰이고 있으면 3123):
```bash
cd webapp && SEALED_DATA_KEY="$(grep -E '^SEALED_DATA_KEY=' ../Claude_DB/.env.local | tail -1 | cut -d= -f2- | tr -d "\"'")" SEALED_DATA_LOCAL_DIR="$PWD/../Claude_DB/out/sealed_local" CARDNEWS_ADMIN_SECRET=local-preview npx next dev -p 3123
```
- 확인 경로: 포트폴리오 › **밸류에이션** (비로그인·로그인 둘 다), 포트폴리오 › ACWI › 국가·업종·테마 (ETF 분류 없음)

## 5. 업로드 · 커밋 · 배포 순서

**업로드를 먼저** 해야 배포 직후 밸류에이션 탭이 비지 않음 (`etf_valuation.bin` 이 없으면 "아직 업로드되지 않았습니다" 표시).

```bash
.venv-sf/bin/python -m Claude_DB.factor.export_webapp            # etf_valuation 2.10MB(0.70MB) · etf_valuation_stocks 0.41MB(0.11MB) · groups 2.83MB(0.96MB)
.venv-sf/bin/python -m Claude_DB.factor.export_webapp --upload

git checkout -b feat/valuation-tab-etf
git add -A Claude_DB/factor/etf_valuation.py Claude_DB/factor/etf_lookthrough.py Claude_DB/factor/groups.py \
        Claude_DB/factor/analyzer.py Claude_DB/factor/export_webapp.py \
        Claude_DB/tests/test_etf_valuation.py Claude_DB/tests/test_groups.py \
        Claude_DB/.gitignore Claude_DB/README.md Claude_DB/docs/07_ETF_룩스루_프로토타입.md Claude_DB/docs/09_Cursor_인수인계_밸류에이션탭_ETF.md \
        webapp/src/components/ValuationTab.tsx webapp/src/app/api/etf-valuation/route.ts \
        webapp/src/components/acwi/AcwiGroups.tsx webapp/src/components/AcwiAnalyzerTab.tsx \
        webapp/src/lib/acwiAnalyzer.ts webapp/src/middleware.ts webapp/src/app/globals.css \
        webapp/src/lib/savvyDb.ts webapp/src/app/api/savvydb/route.ts
git status --short       # 삭제 2개(D) 포함 20개, data/·out/·web/*.js·.env 없어야 함
git commit -m "밸류에이션 탭: 엑셀(savvyDB) → ACWI 기반 ETF 123개 밸류에이션 (보유종목 룩스루 + ACWI 근사)"
git push -u origin feat/valuation-tab-etf
```
(`git add -A <삭제된 경로>` 로 삭제도 스테이징)

## 6. 배포 후 QA

- [ ] 비로그인 밸류에이션: ETF 분류 칩 6개(국가 40 · 지역 10 · 섹터(미국) 11 · 섹터(글로벌) 10 · 섹터(일본) 16 · 테마 36), 표·차트·구성종목(이름·ETF 비중·테마만)
- [ ] `/api/etf-valuation?part=public` → 200, `cache-control: public, s-maxage=600…`, 응답에 원자료 파일명 없음
- [ ] `/api/etf-valuation?part=stocks` 비로그인 → 401 / 관리자 → 200 + 구성종목 PER·PBR·리비전 열 표시
- [ ] `/api/savvydb` → 404 (삭제)
- [ ] 국가 › EWY 클릭: 비교 점선 '한국', SK하이닉스 23.9% · 삼성전자 23.3%
- [ ] 테마 › DRIV: 커버리지 '근사', Fwd PER 차트에 수천 단위 튐 없음 (2022 하반기 공백 정상)
- [ ] 하단 '분류 기준 · 계산 방법' 카드에 제외 10개와 사유
- [ ] ACWI 분석기 › 국가·업종·테마: 분류 6개(ETF 없음), 지표에 'EPS 리비전 1M'
- [ ] 모바일 375px 가로 스크롤 없음 (Claude 확인), 다크 모드

## 7. 판단 필요 (우열님)

1. **공개 범위**: ETF 단위 집계(Datastream/I/B/E/S 파생)를 공개 탭에 올림 — 예전 탭(블룸버그 기반 엑셀)도 공개였고 종목 단위 지표는 관리자 전용으로 분리했지만, 라이선스 측면 최종 확인 필요
2. **savvyDB 사이트**(`savvydb.savvyetf.chatgpt.site`)는 웹앱에서 더 이상 안 씀 — 사이트 자체를 내릴지
3. 예전 탭의 '미국 주식'(1,480종목)·'ETF 비교'(수익·위험 점수) 보기는 이번 범위(ETF 밸류에이션)에 없어 함께 사라짐. 필요하면 ACWI 스크리너(관리자)로 대체되는지 확인
4. 근사 ETF 를 실제 보유종목으로 바꾸려면 Global X·VanEck 등 다운로드 자동화(인앱 브라우저) 또는 유료 API
