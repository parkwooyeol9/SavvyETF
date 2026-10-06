# HANDOFF — Index Monitor (2026-10-02 기준)

Claude에서 진행한 조사·프로토타입을 Cursor에서 이어가기 위한 문서입니다. 위에서부터 순서대로 하면 됩니다.

## 지금까지 된 것

- 12개 지수 방법론 요약 (`web/template.html`의 `M` 배열)
- 편출입 시드 이력: 이벤트 39건 · 변경 263행 (2025-12 ~ 2026-09)
  - 한국: 코스피200 2025-12·2026-06, 코스닥150 2026-06, MSCI Korea 2026-05·08
  - 미국: S&P 500·100 2026-09, S&P 500 2026-06(편입만), Nasdaq-100 2025-12 ~ 2026-09
  - 일본: 닛케이225 2026-04·10 / MSCI 2026-08 Standard 23개국 전체
- MSCI 공개 리스트 파서 + 회귀 테스트 (국가별 수가 MSCI 요약표와 일치, 합계 55/92)
- SQLite 스키마(`sql/schema.sql`)와 적재 스크립트, 단일 HTML 대시보드
- 다가오는 일정 (`web/template.html`의 `CAL` 배열): Russell Rank Day 10-30 → MSCI 11월 리뷰 11-11 → KRX 운영위원회 11월 하순(예상) → 코스피200 반영 12-11(예상) → 미국 분기 리밸런싱 12-18

## 알려진 빈칸 (데이터 품질)

| 항목 | 상태 | 해결 방법 |
|---|---|---|
| 닛케이225 2026-10 | 2차 출처(note.com) | 닛케이 공식 릴리스(indexes.nikkei.co.jp/nkave/newsroom)로 대조 후 `source_tier` 갱신 |
| S&P 500 2026-06 | 편입(MRVL·FLEX)만, 편출 없음 | S&P DJI 6월 분기 보도자료로 보강 |
| Nasdaq-100 2026-09 | 비중 변경(SpaceX)만, 종목 교체 여부 미확인 | Nasdaq 9-11 보도자료 확인 |
| 코스닥150 2026-06 편입 7종목 | 코드 없음 | KRX 종목코드로 채움 |
| 코스피200 2025-12, MSCI Korea 2026-05 | 발표일 비어 있음 | 원문 날짜 확인 후 입력 (추정 금지) |
| MSCI 종목명 → ISIN | 한국 5종목만 매핑 (`build_dataset.py`의 `KO_NAME`) | `security_map` 테이블로 이관, Datastream/ETF 보유종목으로 매칭 |
| EURO STOXX 50, TOPIX | 방법론만, 이력 없음 | 우선순위 낮음 |

## MSCI ACWI 편출입·시점별 구성 (2026-10-02 갱신)

- **커버리지 완성: 2013-08 ~ 2026-08, 53회 리뷰 전부** (2006~2013-05 는 MSCI가 보도자료만 내서 종목 단위 복원 불가)
  - 52회: 로컬에서 받은 PDF → `src/pdf_to_psv.py` → `data/raw/msci/pdf_psv/` — **52/52 국가별 개수가 MSCI 요약표와 일치**
  - 2026-05 1회: PDF 다운로드 실패 → 웹 수집본(`web_psv/MSCI_May26_ST.psv`, 요약표 일치) 사용
  - 웹 수집본 14회와 PDF 파싱본은 **1행 빼고 완전 일치** (Aug23 INDIA `CUMMINS INDIA KIRLOSKAR` → PDF 원문 표기 깨짐, `NAME_FIXES` 로 `CUMMINS INDIA` 보정)
  - 파서는 텍스트 공백이 아니라 **단어 x좌표**로 편입/편출 열을 나눈다(긴 이름은 열 간격이 2칸뿐이라 공백 분리가 깨졌음). `Deletions` 헤더의 x0 가 경계
- 재구성 결과 (`data/out/acwi_pit_counts.csv`): 리뷰별 `members_after`(상한) / `confirmed_after`(확정)
  - 확정 = 앵커 종목 + 정기리뷰 편출로 끝이 확인된 종목. 상한 = 여기에 **편입 기록은 있으나 이후 정기리뷰 편출도 없고 앵커에도 없는 640개**(`end_reason=unknown`)를 더한 값
  - unknown 640개 구성: 중국 A주 약 380개(ETF 기반 앵커에서 빠짐 → 실제로는 아직 구성일 가능성 큼), 미국 약 80개(리뷰 사이 인수·상폐: Aspen Tech, Catalent, Westar 등), 기타 국가 인수·개명
  - 예시: 2013-09 2,474/2,471 · 2018-06(중국 A 편입 351) 2,942/2,680 · 2019-12 3,241/2,862 · 2023-03 3,266/2,732 · 2026-09 2,834/2,194. 공식 ACWI 종목 수는 두 값 사이
- 백테스트 사용: `members_asof(date, include_unknown_end=True|False)`, `membership_matrix(dates)` (ISIN 있는 노드만). unknown 노드는 대부분 ISIN이 없어 매핑 전까지 마스크에 안 들어감
- **iShares 월말 보유종목은 실패**: 159개 파일이 전부 웹페이지(HTML, 1.4MB)로, iShares 가 스크립트 요청을 막음. 맥의 `data/raw/ishares_acwi/` 는 지워도 됨. 이제 스크립트는 HTML 응답을 저장하지 않음
- `ir_dates.csv` 는 **향후 8회 일정만** 담음 (다음: 2026-11-11 발표 / 2026-12-01 효력, 2027-02-09 / 03-01, 2027-05-10 / **05-28**). 과거 리뷰는 "리뷰월 마지막 영업일 종가 → 다음 영업일 효력" 규칙으로 계산하며 휴일 예외는 `review_dates.csv` 로 덮어쓴다
- 2026-10-02 오후: 새 ACWI 파일(`Claude_DB/data/ACWI_new.xlsx`, 종목은 같음)을 앵커로 재생성. **이름 정규화 수정** — `SNAP A`(Snap Inc, May26 편출)가 Snap-On 에 매칭되던 문제('ON' 이 브라질 주식 표기로 지워짐). 하이픈 한쪽이 2글자 이하면 붙여 씀(SNAPON). 이 이력을 쓰는 종목 분석기: `Claude_DB/web/analyzer.html` (`python -m Claude_DB.factor.analyzer`)
- 남은 한계와 대응
  1. **앵커 교체가 가장 효과 큼**: 지금 앵커(`ACWI_raw.xlsx`, 2,240개, 2026-02 직후)에는 중국 A주가 빠져 있음. 새 ACWI 전 종목 파일(중국 A 포함)이 들어오면 unknown 의 상당수가 확정으로 바뀜 → 새 파일 받으면 `ANCHOR_XLSX` 만 바꿔 재실행
  2. 리뷰 사이 기업 이벤트(인수·상폐·IPO 조기편입)는 공개 리스트에 없음 → Datastream 과거 시점 구성종목 리스트로 보정
  3. 과거 편출 종목은 이름만 있음 → `acwi_name_map_todo.csv` 를 ISIN 매핑 → `data/raw/msci/name_map.csv`
  4. 이름 매칭은 국가 풀 + 중국 A/H 구분 + 퍼지 점수(+접두 일치 규칙: FERGUSON ↔ FERGUSON ENTERPRISES). 0.80~0.88 은 `weak_*_match` 플래그

## 다음 작업 (우선순위 순)

0. **ACWI 이력** — 53회 완료. 새 리뷰(2026-11)부터는 `python scripts/fetch_msci_public.py` → `python src/pdf_to_psv.py` → `python src/msci_pit.py`. 다음은 앵커 교체(새 ACWI 전 종목 파일)와 name_map 채우기.

1. **빈칸 메우기** — 위 표. 전부 `data/seed/seed_changes.csv` 수정 후 `build_dataset.py` 재실행.
2. **MSCI 11월 리뷰 대비 (11-11 발표, 한국시간 11-12 새벽)**
   - `MSCI_Nov26_STPublicList.pdf` 받아 `python src/parse_msci_publiclist.py <pdf> data/raw/msci/MSCI_Nov26_ST_parsed.csv`
   - `data/raw/msci/reviews.csv`에 한 줄 추가 → 테스트에 그 리뷰의 요약표 수치 추가
   - PDF는 `pdfplumber`의 `layout=True` 추출을 씀. 열 분리가 깨지면 `parse()`의 정규식(공백 3칸 이상 분리, 20칸 이상 들여쓰기 = 편출만)을 조정
3. **공지 수집기 (P1)** — `src/collectors/`에 소스별 모듈. 공통 출력은 seed와 같은 컬럼의 CSV(`data/raw/<source>/`)로 맞추고 `build_dataset.py`가 합치게 할 것.
   - S&P DJI 보도자료: 표(Effective Date · Index · Action · Company · Ticker · GICS)라 파싱 쉬움
   - Nasdaq-100: Wikipedia 변경표(2007~)로 백필 → 이후는 ir.nasdaq.com 보도자료
   - FTSE Russell: 공지 페이지 + XLSX 첨부. Russell 12월 예비 리스트 11-13 공개
   - KRX: 로그인 필요. 보도자료 PDF 수기 입력이 당장은 가장 안정적
4. **스냅샷 백필 (P2)** — `constituent_snapshot` 채우기
   - Datastream 과거 시점 구성종목 리스트 (계정에서 제공 범위 먼저 확인)
   - ETF 보유종목: EWY/IEMG(MSCI), KODEX 200(코스피200), QQQ(NDX) 일별
   - `sql/schema.sql` 하단의 diff 쿼리로 공지 누락·실제 반영일 검증
5. **이벤트 스터디 (P3)** — 발표일/반영일 전후 초과수익·거래대금·추정 패시브 수급. `Claude_Work`의 ETF 리밸런싱 분석과 연결해 주보·월보에 활용.
6. **대시보드 고도화** — 방법론(`M`)·일정(`CAL`)을 JSON으로 분리(`data/meta/`), 지수별 상세 페이지, 다가오는 일정 D-day 표시.

## 결정 사항 / 원칙

- 이력은 **공지 기준**으로 쌓고, 실제 반영은 스냅샷으로 사후 검증한다 (두 층 분리).
- 원문 표기는 `security_name_raw`에 그대로 보존, 매핑은 별도 테이블.
- 모든 행에 `source_tier`와 `source_url`. 날짜·코드를 모르면 비워두고 추정하지 않는다.
- `data/out/`, `web/index_monitor.html`은 생성물. 직접 고치지 말고 원본(seed, template)을 고친다.
- 외부 게시 전 MSCI 라이선스 확인. KRX 계정 정보는 `.env`(커밋 금지).

## 참고 출처

MSCI Index Review 페이지(msci.com/index-review), S&P U.S. Indices Methodology, Nasdaq-100 2026 방법론 FAQ(indexes.nasdaqomx.com/docs/2026_NDX_Changes_FAQ.pdf), LSEG Russell Reconstitution, 日経平均プロフィル, KRX 정보데이터시스템. 행 단위 출처는 `source_url` 컬럼 참고. 조사 요약은 Claude 프로젝트 "ETF분석"의 `Index_Monitor_조사.md`에도 있습니다.
