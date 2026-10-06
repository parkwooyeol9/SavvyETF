# Index Monitor

SavvyETF의 Index Monitor 기능 작업 폴더입니다. 주요 주가지수(MSCI, S&P, Nasdaq-100, FTSE Russell, 닛케이, 코스피200·코스닥150 등)의 편출입 이력을 **공지(이벤트) 단위로 적재**하고, 방법론·일정과 함께 한 페이지로 보여줍니다.

- 권장 위치: `SavvyETF/Claude_DB/index_monitor/` (ACWI 팩터 작업과 같은 데이터 폴더)
- 현재 상태와 다음 할 일: [`HANDOFF.md`](HANDOFF.md)
- Cursor 작업 규칙: [`.cursor/rules/index-monitor.mdc`](.cursor/rules/index-monitor.mdc)

## 빠른 시작

```bash
cd SavvyETF/Claude_DB/index_monitor
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt

python src/build_dataset.py   # 시드 + MSCI 파싱 결과 → data/out/
python src/build_html.py      # data/out/data.json → web/index_monitor.html
python -m pytest tests/       # MSCI 파서 회귀 테스트
```

`web/index_monitor.html`을 브라우저로 열면 대시보드가 보입니다(단일 파일, 서버 불필요).

## 폴더 구조

```
index_monitor/
├─ README.md / HANDOFF.md / requirements.txt
├─ .cursor/rules/index-monitor.mdc   Cursor용 프로젝트 규칙
├─ data/
│  ├─ seed/seed_changes.csv          수기 큐레이션 이력 (KRX·S&P·Nasdaq·닛케이 등) ← 사람이 고치는 원본
│  ├─ raw/msci/
│  │  ├─ reviews.csv                 MSCI 리뷰 등록부 (파싱 파일 ↔ 발표·반영일)
│  │  ├─ MSCI_Aug26_STPublicList.txt PDF 추출 텍스트
│  │  └─ MSCI_Aug26_ST_parsed.csv    파서 출력
│  └─ out/                           ← 생성물 (직접 수정 금지, 언제든 재생성)
│     ├─ index_changes.csv           통합 변경 이력
│     ├─ index_monitor.db            SQLite (sql/schema.sql)
│     └─ data.json                   대시보드 입력
├─ sql/schema.sql                    테이블 정의 + 스냅샷 diff 쿼리
├─ src/
│  ├─ parse_msci_publiclist.py       MSCI 공개 편출입 PDF/텍스트 → CSV
│  ├─ build_dataset.py               병합·적재
│  └─ build_html.py                  대시보드 빌드
├─ web/
│  ├─ template.html                  대시보드 원본 (방법론 표·일정은 여기 JS 상수에 있음)
│  └─ index_monitor.html             빌드 결과
└─ tests/test_parse_msci.py
```

## MSCI ACWI 시점별 구성종목 (백테스트용)

팩터 분석·백테스트에서 look-ahead/생존편향을 없애기 위해, 각 날짜에 실제 ACWI 구성종목이었던 종목만 쓰도록 편입·편출 구간을 만든다.

```bash
python scripts/fetch_msci_public.py             # (로컬) MSCI 공개 PDF (2013-08~) + 향후 리뷰 일정
python src/pdf_to_psv.py                        # PDF → data/raw/msci/pdf_psv/*.psv (요약표와 자동 대조, 52/52 OK)
python src/validate_msci_psv.py                 # 웹 수집본 대조
python src/msci_pit.py                          # → data/out/acwi_membership_intervals.csv 등
```

```python
import sys; sys.path.insert(0, "src")
from msci_pit import members_asof, membership_matrix
members_asof("2024-06-28")                                     # 그 날 구성종목 (상한)
members_asof("2024-06-28", include_unknown_end=False)          # 확정분만
mask = membership_matrix(pd.date_range("2023-06-30", "2026-09-30", freq="BME"))  # 날짜 × ISIN 0/1
signal = signal.where(mask.reindex_like(signal).fillna(0).astype(bool))       # 비구성 종목 제거
```

| 파일 | 내용 |
|---|---|
| `data/raw/msci/web_psv/*.psv` | 웹 수집 리뷰별 편출입 (T 발표일 / S 국가별 요약 / A 편입 / D 편출). 보정 내역은 `CORRECTIONS.md` |
| `data/raw/msci/pdf_psv/*.psv` | 로컬 PDF 파싱본 (있으면 웹본보다 우선) |
| `data/out/acwi_membership_intervals.csv` | 종목(노드)별 `[start, end)` 구간. start 비어 있음 = 커버리지 이전부터 구성 |
| `data/out/acwi_review_events.csv` | 리뷰 × 종목 이벤트 (발표일·종가반영일·효력일) |
| `data/out/acwi_pit_counts.csv` | 리뷰 전후 재구성 구성종목 수 (`members_after` 상한 / `confirmed_after` 확정) |
| `data/out/acwi_unmatched.csv` | 매칭 실패·앵커 불일치 목록 |
| `data/out/acwi_name_map_todo.csv` | ISIN 없는 과거 종목명 → 식별자 매핑 작업 목록 (`scripts/map_names_refinitiv.py`) |

**날짜 규칙**: MSCI 리뷰는 리뷰 월 마지막 영업일 종가에 반영되고 다음 영업일부터 효력. `start`/`end`는 효력일(장 시작) 기준이며 `end`는 그날부터 비구성(exclusive). 휴일로 어긋나는 날은 `data/raw/msci/review_dates.csv`(tag,announce,close,effective)로 덮어쓸 수 있다.

**앵커**: `Claude_DB/data/ACWI_raw.xlsx` UNIVERSE 시트(Wgt>0). 편출입과 대조해 보니 이 목록은 **2026-02 리뷰 반영 직후 구성**(5월·8월 변경 미반영)이고, 중국 A주 일부가 빠진 ETF 기반 목록으로 보인다. 중국 A주를 포함한 최신 전 종목 파일로 바꾸면 `end_reason=unknown` 노드가 크게 줄어든다. 스크립트가 반영 시점을 자동 판정한다(`acwi_anchor_detection.csv`).

## 데이터 흐름

```
MSCI PDF ──parse_msci_publiclist.py──▶ data/raw/msci/*_parsed.csv ─┐ (reviews.csv로 날짜 연결)
수기 큐레이션 ──────────────────────────▶ data/seed/seed_changes.csv ─┼─▶ build_dataset.py ─▶ data/out/* ─▶ build_html.py ─▶ web/index_monitor.html
                                                                    ┘
```

## 데이터 규칙 (seed_changes.csv 컬럼)

| 컬럼 | 설명 |
|---|---|
| `index_id` | `KOSPI200`, `KOSDAQ150`, `MSCI_KOREA`, `SP500`, `SP100`, `NDX`, `NIKKEI225`, `MSCI_<COUNTRY>` |
| `review` | 이벤트 라벨. 같은 `index_id`+`review` 행이 한 이벤트로 묶임 (예: `2026-06 정기`, `2026-07 Fast Entry`) |
| `announce_date` / `effective_date` | ISO 날짜. **effective = 지수에 처음 반영되는 날(장 시작 기준)**. 모르면 비워둠 (추정 금지) |
| `event_type` | `regular` · `adhoc` · `fast_entry` · `weight` |
| `action` | `ADD` · `DEL` · `WEIGHT` |
| `code` | KRX 6자리 또는 티커. 확인 안 되면 비움 |
| `source_tier` | `official_pdf` > `official_pr` > `primary_news` > `wiki` > `news` > `secondary`(대조 필요) |
| `source_url` | 근거 원문 |

## 주의

- **MSCI 공개 PDF 고지문은 정보로 데이터베이스를 만드는 것을 금지**합니다. 내부 리서치용으로만 쓰고, SavvyETF 홈페이지 등 외부 게시 전에는 MSCI 라이선스를 확인하세요.
  그래서 `src/export_webapp.py` 는 MSCI 외 행만 `webapp/src/data/indexMonitorChanges.json` 에 쓰고, MSCI 행은 AES-GCM 으로 봉인해
  `--upload` 시 R2 `private/index_monitor/msci_rows.bin` 에 올립니다 (웹 Index Monitor 탭에서 관리자에게만 합쳐 보임).
  `cryptography` 가 필요하고 키·관리자 비밀번호는 `Claude_DB/.env.local` (`Claude_DB/README.md` 참고).
- **KRX 정보데이터시스템은 2025-12-27부터 로그인 필수**입니다. pykrx 등은 `KRX_ID`/`KRX_PW` 환경변수가 필요하며, 계정 정보는 `.env`에 두고 커밋하지 마세요.
