# 33. Cursor 인수인계 — ACWI 원자료 11월 갱신(v4) 홈페이지 반영 (2026-11-04)

- 작성: 2026-11-04 (Claude) · 받는 쪽: Cursor
- 요청(우열님): 다운로드 폴더의 `(신투증) ACWI  퀀트 유니버스.xlsx`(LSEG 새로고침, 11월분)를 홈페이지에 반영
- **Claude 는 로컬 빌드·검증만 했다. git add/commit/push, R2 업로드(`--upload`), Render·Vercel 설정 변경은 하지 않았다.**
- 원자료 사본: `Claude_DB/data/ACWI_v4.xlsx` (52.7MB, md5 `06962b9a0f58bc7a3b3e8338f0b99d89`, `data/` 는 gitignore)
  - SavvyDB `Side_Project/acwi_quant/1_원본데이터/ACWI_퀀트유니버스_v4_2026-11-03_10년시계열.xlsx` 와 같은 파일

---

## 1. 이 파일이 지금까지 쓰인 곳

| 시점 | 파일 | 쓰인 곳 | 문서 |
|---|---|---|---|
| 10/02 | v1·v2 (`data/ACWI_raw.xlsx`, 스냅샷만) | 팩터 스코어보드 | docs/01, 04 |
| 10/06 | v3 (`data/ACWI_v3.xlsx`, 10년 시계열) | ACWI 종목 분석기·10년 백테스트·MSCI 편출입 연동 | docs/03, 05, 06 |
| 10/14 | v3 | 국가·업종·테마 10년 밸류에이션(groups), **밸류에이션 탭 ETF 123개**(공개) | docs/08, 09 |
| 10/23 | v3 산출물(봉인 summary) | ACWI 기술적분석 유니버스 `acwiYahooUniverse.json`(2,247종목), 종목 팩트 `acwiTechFacts.json`(as_of 2026-10-01) | docs/13 |
| 10/30경 | `acwiTechFacts.json` | AI Pick 탭(추세·밸류 팩트) | docs/26 |
| 11/03 | v4 | SavvyDB Allocation 리포트(웹 반영 없음) | — |

**지금 홈페이지는 모두 v3(2026-10-01 기준)이다.** 이번 작업으로 v4(2026-11-02 기준)로 바뀌는 화면은 다음과 같다.

| 화면 | 데이터 | 갱신 방법 |
|---|---|---|
| 포트폴리오 › ACWI(관리자): 종목 분석기·스코어보드·백테스트 | R2 `private/acwi/latest/summary.bin`·`series/*.bin`·`backtest.bin` | §3-1 업로드 |
| 포트폴리오 › ACWI › 국가·업종·테마 | `groups.bin` | §3-1 업로드 |
| 포트폴리오 › **밸류에이션(공개)** | `etf_valuation.bin`(공개 API), `etf_valuation_stocks.bin`(관리자) | §3-1 업로드 |
| ACWI 기술적분석 · Render 06:30 `acwi_px` 일봉 대상 | `webapp/src/data/acwiYahooUniverse.json` | §3-2 재생성 → 커밋 → 배포 |
| ACWI 기술적분석 선택 종목 밸류 · AI Pick 팩트 | `webapp/src/data/acwiTechFacts.json` | §3-3 재생성 → 커밋 → 배포 |

## 2. 파일 점검 결과 (intake + 리포트 작업 때 확인한 것)

`python -m Claude_DB.factor.intake --xlsx Claude_DB/data/ACWI_v4.xlsx --prev Claude_DB/data/ACWI_v3.xlsx` → `out/intake/intake_report.md`

| 항목 | 결과 | 영향 |
|---|---|---|
| 종목 | 2,266개, 분석 대상 2,235 · 제외 31 (섹터 없음 18, 비중 0 13) | v3 와 같은 규모 |
| v3 대비 | 추가 2(UPM 새 ISIN, Strive) · 삭제 5(Kenvue, Warner Bros. Discovery, e&, InPost, UPM 옛 ISIN) | 작음 |
| 요청식 | 주가·시총·추정치 USD, 수익률 변동성 반영 / RI·USD 수익률, MSCI 국가코드 열 **아직 미반영** | v3 와 같음 |
| **월간 시트 날짜** | 매월 1일 → **매월 2일**(2016-10-02 … 2026-11-02) | 엔진은 월 단위로 묶어 **문제없음**(months 2016-11~2026-11, 121개월, 공백 없음) |
| **Wgt(ACWI 비중) 열** | v3 와 **값이 100% 같음**(갱신 안 됨). 주가·시총·추정치는 갱신됨 | 화면의 'ACWI 비중'은 10/1 기준. 그룹·ETF 집계는 시총(MV) 가중이라 영향 없음 |
| MSCI 구성 대조 | Feb26 정기변경 반영 직후 구성(v3 와 같음). 이후 편입 미포함 100, 편출 잔존 142 | 분석기 '미반영 변경'에 그대로 표시됨 |
| 값 상식 이탈 | 14건(`value_flags.csv`) | v3 수준 |

## 3. Claude 가 돌린 로컬 빌드 (재현 기준값)

```bash
.venv-sf/bin/python -m Claude_DB.factor.analyzer --xlsx Claude_DB/data/ACWI_v4.xlsx --as-of 2026-11-02   # 4분 30초 (스코어보드·groups·etf_valuation 포함)
.venv-sf/bin/python -m Claude_DB.factor.backtest --xlsx Claude_DB/data/ACWI_v4.xlsx                     # 2분 20초
.venv-sf/bin/python -m Claude_DB.factor.export_webapp                                                     # 봉인 + 복호화 검증, 업로드 안 함
.venv-sf/bin/python -m unittest discover -s Claude_DB/tests -t .                                          # 40 OK
```

| 항목 | 기대값 (v4) | 참고 (v3) |
|---|---|---|
| as_of · ri_last | 2026-11-02 · 2026-11-02 | 2026-10-01 |
| 앵커 리뷰 | Feb26 | Feb26 |
| 편출 관찰 AUC | 0.920 (상위 100에 54, 200에 96) | 0.920 |
| ETF | 123 = 보유종목 84 + ACWI 근사 39, 제외 10 | 같음 |
| 봉인 크기 | summary 3.03MB(0.92) · groups 2.83MB(0.96) · etf_valuation 2.10MB(0.70) · stocks 0.41MB(0.11) · backtest 2.38MB(0.80) · series 32개 최대 484KB | 비슷 |

밸류에이션 탭 Fwd PER·EPS 리비전 3M 변화(검산용)

| ETF | PER v3 → v4 | 리비전 3M v3 → v4 |
|---|---|---|
| SPY | 19.2 → 18.4 | 10.8 → 10.5 |
| EWJ | 15.7 → 14.0 | 9.9 → 11.1 |
| EWY | 6.0 → 4.7 | 20.5 → 16.7 |
| SOXX | 19.3 → 14.7 | 28.1 → 21.3 |
| XLP | 18.7 → 21.1 | 2.7 → 2.5 |
| XLV | 17.8 → 19.4 | 5.8 → 6.3 |
| DRIV(근사) | 31.6 → 29.1 | 19.1 → 1.0 |

10월 반도체·한국 급락(PER 하락)과 필수소비재·헬스케어 상승(PER 상승)이 반영된 방향이다. DRIV 리비전 급락은 근사 바스켓 상위(테슬라 등) 추정치 하향 — QA 때 구성종목 화면에서 확인.

## 4. Cursor 작업 순서

### 4-1. 봉인 데이터 업로드 (먼저)
```bash
.venv-sf/bin/python -m Claude_DB.factor.export_webapp --upload    # private/acwi/latest/* → R2 (Claude_DB/.env.local 의 PRIVATE_UPLOAD_TOKEN·SEALED_DATA_KEY)
```
- 산출물은 이미 `out/webapp_export/`·`out/sealed_local/` 에 v4 로 만들어져 있다. 다시 빌드할 필요는 없지만, 재현하려면 §3 명령을 그대로 쓰면 된다
- 업로드만으로 ACWI·국가·업종·테마·밸류에이션 탭은 바뀐다(코드 변경 없음). CDN 캐시 `s-maxage=600` 이라 최대 10분

### 4-2. `acwiYahooUniverse.json` 재생성 (구성 +2/−5 반영)
```bash
.venv-sf/bin/python 10_공통/acwi_px.py --write-universe     # out/sealed_local/.../summary.bin 을 읽고 다중 후보 티커는 Yahoo 확인(네트워크)
```
- 기대: `built_from: "acwi summary"`, n ≈ 2,24x (v3 2,247 에서 Kenvue·WBD 등 빠지고 Strive 추가)
- Yahoo 확인은 순차로. 병렬 금지

### 4-3. `acwiTechFacts.json` 재생성 (as_of 2026-10-01 → 2026-11-02)
- 이 파일은 커밋 `6d11a62` 에서 만들어졌고 **저장소에 생성 스크립트가 없다.** 같은 방식(봉인 summary 의 종목 행 → RIC 키)으로 다시 만들고, 이번에 `Claude_DB/scripts/` 에 스크립트로 남겨 달라
- 필드: `pe, pb, dy, roe, pep(PER 3년 백분위), pep10(10년 백분위), r12m, dd52(52주 고점 대비), vol, ts(추세 점수 0~6)` · 상위 키 `as_of`·`n`·`rows`
- 기대: `as_of: "2026-11-02"`, n ≈ 2,24x. 검산: NVDA·AAPL 등 상위 종목의 `r12m`·`dd52` 가 10월 하락을 반영해 v3 값과 달라야 함

### 4-4. 커밋·배포
```bash
git checkout -b data/acwi-v4-2026-11
git add webapp/src/data/acwiYahooUniverse.json webapp/src/data/acwiTechFacts.json Claude_DB/scripts/<4-3 스크립트> \
        "Claude_DB/docs/33_Cursor_인수인계_ACWI원자료_v4_11월갱신.md"
git status --short        # data/·out/·web/*.js·.env 가 없어야 함
git commit -m "data(acwi): refresh universe and tech facts from the November ACWI file (v4, 2026-11-02)"
git push -u origin data/acwi-v4-2026-11
```
- **커밋 금지**: `Claude_DB/data/**`(원자료) · `Claude_DB/out/**` · `Claude_DB/web/*.js` · `.env*`
- 작업 트리의 다른 미커밋 변경(docs 08 수정, docs 11·12·21·29~31, `research/**`)은 이번 작업과 무관 — 건드리지 않음
- 배포 후 다음 날 06:30 Render `acwi_px` 가 새 유니버스로 일봉을 받는지 로그 확인(`n_ok` 가 1 이 아니어야 함, docs/13 §1)

## 5. 배포 후 QA

- [ ] 밸류에이션(비로그인): 상단 기준일 2026-11, ETF 123개, §3 표의 PER 값(SPY 18.4 · EWY 4.7 · SOXX 14.7 · XLP 21.1)
- [ ] `/api/etf-valuation?part=public` 200, 응답에 원자료 파일명 없음 / `?part=stocks` 비로그인 401
- [ ] ACWI(관리자): as_of 2026-11-02, 종목 수 2,266(분석 2,235), Kenvue·Warner Bros. Discovery 검색 안 됨, Strive 검색됨
- [ ] 국가·업종·테마: 10년 차트 마지막 점 2026-11, 2026-10 과 2026-11 사이 공백 없음
- [ ] 백테스트 탭 열림(as_of 갱신)
- [ ] ACWI 기술적분석: 종목 선택 시 밸류 팩트 기준일 2026-11-02
- [ ] AI Pick: `facts_as_of` 2026-11-02

## 6. 우열님 확인 필요 (다음 파일 요청 때)

1. **Wgt 열이 10월 값 그대로** — 다음 파일에서는 비중을 새로고침하거나 기준일을 함께 적어 달라. 이번 화면의 'ACWI 비중'은 10/1 기준
2. **월간 시트 날짜를 1일로** 되돌릴지 (엔진은 2일도 처리하지만, 기준일 표기가 '11-02'처럼 바뀜)
3. 요청식 미반영 2건: `PCH#(X(RI)~U$,…)`(배당 포함 USD 수익률), MSCI 국가코드 열
4. 구성종목이 Feb26 기준 — May26·Aug26 정기변경 반영본을 받으면 분석기 '미반영 변경' 목록이 정리됨
