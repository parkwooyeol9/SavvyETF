# 37. Cursor 인수인계 — 편입비: Claude 로컬 수집분 R2 즉시 업로드 (DGRO·HDV·VFLO·VYM·XLK)

- 작성: 2026-11-05 (Claude)
- 기준 커밋: `ea1e09a` (브랜치 `feat/krx-option-board` 작업트리)
- 선행: 35(운용사 공식 소스), 36(엑셀 다운로드). 이 문서는 **"지금 수집한 데이터를 내일 스케줄 기다리지 않고 바로 사이트에 올리는 것"**.
- 탭: ETF → 편입비 → 편입비 모니터 (`?tab=etfweights`)

## 왜 아직 사이트에 안 보이나

1. Claude 로컬 `.env`에 `R2_*` 키가 없어, 수집한 스냅샷이 **이 맥의 `data/etf_weights/`에만** 있다 (gitignore 대상 → 커밋으로도 안 감).
2. 업로드해도 기존 규칙이면 **안 바뀌었을 것**: `latest.json`은 "날짜가 같거나 늦으면 교체"였는데, R2에 이미 있는 etfcheck 스냅샷은 가격일을 기준일로 써서 `2026-11-04`로 찍혀 있다.
   → 공식 DGRO 11/03 < etfcheck 11/04 이라 교체 안 됨. VYM 공식(월말 09/30)은 영원히 latest가 못 됨. **사용자가 "DGRO 아직 과거 데이터"라고 본 원인.**

## 바뀐 파일 (이번)

| 파일 | 내용 |
|---|---|
| `03_ETF/etf_weight_monitor.py` | `_basis_rank()` + `should_replace_latest(candidate, current)` 추가. **운용사 공식(`as_of_basis=issuer_file`) > 레거시/기타 > etfcheck**, 같은 등급이면 날짜. `save_snapshot()`(로컬)과 `publish_to_r2()`(원격) 두 곳의 latest 갱신을 이 규칙으로 교체. 레거시 스냅샷(필드 없음)은 `source=="etfcheck_global_pdf_detail"`이면 etfcheck로 판정. Roundhill 등은 기존과 동일(날짜 비교) |
| `03_ETF/etf_weight_push_local.py` (신규) | 로컬 스냅샷 → R2 즉시 업로드. **기본 드라이런**, `--apply`로 실제 쓰기, `--archive-etfcheck`로 해당 티커의 기존 etfcheck 스냅샷을 `etf_weights/{T}/archive_etfcheck/`로 이동(복사 확인 후 삭제). `universe.json`은 원격과 **병합**(Roundhill·iShares 항목 유지, 5종은 `group:"priority"`) |

검증(Claude): 가짜 R2(메모리)로 원격에 etfcheck DGRO 11/02·11/04, VYM 11/04, universe(DRAM·IVV·DGRO)를 넣고 실행 →
드라이런은 아무것도 안 씀 / `--apply --archive-etfcheck` 후 DGRO latest = 공식 11/03, VYM latest = 공식 09/30, DGRO snapshots = `2026-11-03`만, etfcheck 2건은 archive로, universe = DRAM·IVV 유지 + DGRO·VYM priority. 로컬(키 없음) 실행은 "R2 not configured"로 안전 종료.

## 올라갈 데이터 (이 맥 `data/etf_weights/`)

| 티커 | 기준일 | 원천 | 종목 |
|---|---|---|---|
| DGRO | 2026-11-03 | iShares latest-holdings.csv | 398 |
| HDV | 2026-11-03 | iShares latest-holdings.csv | 79 |
| XLK | 2026-11-03 | SSGA holdings-daily xlsx | 79 |
| VYM | 2026-09-30 | Vanguard AdditionalFundData (월말 공시) | 610 |
| VFLO | 2026-11-04 | Victory "All Holdings" CSV (브라우저 다운로드 → import) | 52 |

각 티커에 `snapshots/{날짜}.json`, `latest.json`, `raw/{날짜}.csv`. `universe.json`도 있지만 **이 파일은 올리지 말 것**(5종뿐) — 스크립트가 원격과 병합해서 새로 쓴다.

## 할 일 (순서대로)

**방법 A — 이 맥에서 바로 (권장, VFLO까지 한 번에)**

1. 35·36·37 변경 커밋·배포 (배포는 2번과 독립이지만, 배포 안 하면 내일 08:20 스케줄이 **구 규칙/구 코드**로 돌아 etfcheck로 덮을 수 있음 → 배포를 먼저).
2. 루트 `.env`에 배포 봇과 같은 R2 값 4개 추가: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` (커밋 금지).
3. 드라이런 확인:
   ```bash
   cd 03_ETF && python etf_weight_push_local.py --archive-etfcheck
   ```
   기대: 5종 각각 `snapshots` 1건, `latest: replace remote (… etfcheck …) → local (…)` 또는 원격 latest가 없으면 `replace remote (None, None)`, `archived`에 etfcheck 날짜들, `universe.after ≥ remote_before`.
4. 실제 반영:
   ```bash
   python etf_weight_push_local.py --apply --archive-etfcheck
   ```
5. 10~15분 뒤 사이트 확인 (API 서버 캐시 120s+stale 600s, CDN s-maxage 180 + swr 600). 급하면 Vercel에서 해당 경로 캐시 퍼지.

**방법 B — 배포 서버 셸에서 (이 맥 데이터 없이)**

- `python 03_ETF/etf_weight_official.py` → DGRO·HDV·XLK·VYM을 서버에서 새로 수집해 바로 R2 게시(그 시점 최신 파일). VFLO는 "수동 import" 에러 1줄이 정상.
- VFLO는 이 맥의 `data/etf_weights/VFLO/raw/2026-11-04.csv`(= Victory 공식 CSV)를 서버로 올려 `python 03_ETF/etf_weight_official.py --victory-csv VFLO <경로>`.
- 기존 etfcheck 스냅샷 정리는 방법 A의 `--archive-etfcheck`를 서버에서 실행하거나(서버엔 로컬 스냅샷이 방금 생겼으므로 동작) 생략.

## 완료 기준

- [ ] 셀렉트 맨 위 "우선 관리 (5)": DGRO·HDV·XLK `2026-11-03`, VFLO `2026-11-04`, VYM `2026-09-30`
- [ ] DGRO 헤더 "as of 2026-11-03 (운용사 공식)", Top holdings 1위 **XOM 3.16%** (etfcheck는 AAPL 3.14%였음)
- [ ] XLK 1위 NVDA **15.47%** (etfcheck 13.16%), VFLO 1위 ACN **5.02%**, VYM "(운용사 공식 · 월말 공시)" 1위 AVGO 6.93%
- [ ] Roundhill(DRAM 등)·iShares Top15 항목이 셀렉트에서 사라지지 않음 (universe 병합 확인)
- [ ] 편입비 시계열에 etfcheck 점이 섞이지 않음 (`--archive-etfcheck` 적용 시)
- [ ] 다음 날 08:20 스케줄 후에도 DGRO latest가 etfcheck로 돌아가지 않음 (`should_replace_latest` 배포 확인)

## 롤백

- latest가 잘못되면: R2 `etf_weights/{T}/archive_etfcheck/{날짜}.json`을 `snapshots/`로 다시 복사하고 그 파일을 `latest.json`에 put. 아카이브는 지우지 않으므로 항상 복구 가능.

## 별건 (선택, 이번 범위 아님)

- 스케줄 시각: 08:20 KST = 미 동부 전날 18:20이라 iShares·SSGA의 그날 파일(미 동부 새벽 게시) 이전 → 매일 **2거래일 전** 데이터를 가져감. 우선 관리 공식 수집만 22:00 KST(미 동부 08:00 전후)로 분리하면 매일 1거래일 전 파일. `etf_weight_monitor_scheduler.py`의 `ETF_WEIGHT_SCHEDULE_KST` 또는 별도 슬롯.

## 커밋 범위

커밋할 것: `03_ETF/etf_weight_monitor.py`, `03_ETF/etf_weight_push_local.py`, 이 문서 (+35·36 범위).
**커밋 금지**: `.env`(R2 키), `data/etf_weights/**`, `00_exports/**`, KRX 옵션보드 변경(`04_국내시장/krx_option_*`, `KrxOptionBoardTab.tsx`, `krxOptionBoard.ts`, `globals.css`, `KrxInvestorFlowSection.tsx`, 34번 문서).

권장 커밋 메시지:

```
fix(etf-weights): let issuer-official holdings replace etfcheck snapshots and add a one-shot R2 push for locally collected data
```

---

## ★ 추가 (2026-11-05 14:45) — VFLO 만 아직 사이트에 없다

**확인한 상태** (savvyetf.com `?tab=etfweights`, 14:40)
- XLK 11/03 · VYM 09/30 · DGRO 11/03 · HDV 11/03 은 공식 데이터로 올라와 있다 (`32c589d` Render 일괄 실행으로 반영)
- **VFLO 는 목록에 없다.** 엑셀 버튼(`{티커} 엑셀`)은 배포돼 있다 — 이건 할 일 없음

**왜 VFLO 만 빠졌나**
- `32c589d` 의 Render 일괄 실행(`etf_weight_official.py` 인자 없음)은 서버에서 4종을 새로 받는다. VFLO 는 자동 수집 경로가 없어(Victory 403, etfcheck VFLO 값 불일치) `no automated official feed` 로 끝나는 게 정상이고, 서버에는 로컬 스냅샷도 없으니 `push()` 도 VFLO 를 건너뛴다
- VFLO 원자료(공식 All Holdings CSV)는 **이 맥 `data/etf_weights/VFLO/` 에만** 있다 (`raw/2026-11-04.csv`, `snapshots/2026-11-04.json`, `latest.json` — 52종목). `data/` 는 gitignore 라 커밋·배포로 서버에 가지 않는다
- Render one-off job 은 셸이 없어(`32c589d` 주석) 방법 B(CSV 를 서버로 복사 후 `--victory-csv`)는 사실상 불가

**할 일 — 이 맥에서 VFLO 1종만 (방법 A)**
1. 루트 `.env` 에 배포 봇과 같은 R2 값 4개 (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`) — 커밋 금지. 실행하는 파이썬에 `python-dotenv` 가 있어야 `.env` 를 읽는다(`.venv-sf` 에는 없음 → `pip install python-dotenv` 또는 키를 셸 환경변수로 export)
2. 드라이런 → 실제 반영 (티커 인자로 VFLO 만):
   ```bash
   cd 03_ETF
   python etf_weight_push_local.py VFLO --archive-etfcheck          # 드라이런: snapshots 1건(2026-11-04), latest replace, universe after = before + 1
   python etf_weight_push_local.py VFLO --apply --archive-etfcheck  # 실제 쓰기
   ```
   - `--victory-csv` 대신 이 스크립트를 쓰는 이유: `universe.json` 병합(목록에 VFLO 추가)까지 한 번에 한다. `--victory-csv` 는 스냅샷·latest 만 올리고 목록 병합은 하지 않는다
   - `R2 not configured` 가 나오면 1번(키·dotenv)이 안 된 것
3. 10~15분 뒤 확인(캐시 API 120s+stale 600s, CDN 180+swr 600): 목록에 `VFLO — VictoryShares — 2026-11-04`, 선택 시 52종목, `VFLO 엑셀` 다운로드

**이후 운영**
- VFLO 는 자동 갱신되지 않는다. 우열님이 Victory 상품 페이지에서 All Holdings CSV 를 받아 주면 → `python etf_weight_official.py --victory-csv VFLO <경로>`(로컬 저장) → 위 2번 push 로 반영
- 다음 날 08:20 스케줄이 VFLO 를 etfcheck 로 덮지 않는지 확인(스케줄러는 VFLO 를 건너뛰도록 되어 있음 — `etf_weight_monitor.py` 905행 부근)
