# Cursor 작업목록 (Claude_DB)

우선순위 순. 각 항목은 독립적으로 진행할 수 있습니다.

1. **Datastream 요청 통화 통일** — 엑셀 DSGRID 요청에 `~U$` 적용 후 `config.REPORT_CANDIDATES` 를 비워 통화 보정이 0건인지 확인 (`tests/test_engine.py::test_currency_fix_uk` 는 그대로 통과해야 함).
2. **변동성 교체** — U열을 일간 수익률 표준편차로 바꾸고 `engine.descriptors()` 의 `vol` 정의를 `px_sd_1y` 그대로 쓰도록 수정.
3. **SavvyETF 웹앱 편입** — `webapp/` (Next.js) 에 `/acwi-factor` 페이지 추가. `out/summary.json` + `stocks.csv` 를 Supabase/R2 에 올리고 API 로 읽기. 현재 `web/index.html` 의 표·상세·가중치 로직을 React 컴포넌트로 옮기면 됨.
4. **시계열 저장** — `build.py` 에 `--as-of` 별 스냅샷을 `out/history/{date}.parquet` 로 저장 → 팩터 수익률(상위-하위 5분위) 백테스트.
5. **팩터 IC 검증** — 다음 달 수익률과 팩터 점수의 순위상관(IC)을 월별로 쌓아 가중치를 정하는 근거 만들기.
6. **ETF 연결** — SavvyETF 의 ETF 보유종목(`etf_holdings.py`)과 조인해 ETF 단위 팩터 노출(가중평균 Z) 계산.
7. **국가 분류 원천화** — MSCI 국가코드를 Datastream 에서 받아 `config.CODE_COUNTRY_OVERRIDE`·`HK_DM_NAME_HINTS` 제거.
