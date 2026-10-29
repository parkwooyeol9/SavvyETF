# 25. Cursor 인수인계 — 봇 메모리 초과(Render) · 20:10 ETF 수익률 작업 (2026-10-29)

- 작성: 2026-10-29 (Claude Code) · 받는 쪽: Cursor (커밋·푸시·배포)
- 대상 저장소: `/Users/wooyeol/GitHub/SavvyETF` (`main`)
- 계기: Render 메일 "Web Service savvyetf-bot exceeded its memory limit" (자동 재시작)
- 고친 파일: `03_ETF/etf_universe_px.py`, `03_ETF/etf_universe_px_scheduler.py`. 다른 파일은 건드리지 않았다.
- Render 로그는 보지 못했다. 원인은 코드 분석과 로컬 실측으로 판단했다.

---

## 1. 원인

`61cae9a`(10/28)에서 추가한 평일 20:10 KST 작업 `etf_universe_px`.

- 종가 저장소(`data/etf_universe_px/closes.json.gz`, R2 `etf_universe_px/closes.json.gz`)를 통째로 `json.loads`해서 약 9,341종 × 280일 = 약 260만 개의 `[날짜, 종가]` 리스트로 올렸다.
- 저장할 때도 `json.dumps`로 전체 문자열을 한 번에 만들었다.
- 첫 실행(2y 백필)은 종목당 약 500봉을 `found` 딕셔너리에 전부 들고 있다가 한꺼번에 병합했다.
- 실측(같은 크기 합성 데이터): 저장 시 최대 메모리 약 509MB, 불러올 때 약 687MB. Render `starter`는 512MB.
- 문서 21의 10/29 07:50 health에서도 `last_etf_universe_px_slot` · `ok_at`이 비어 있었다. 첫 실행이 끝까지 가지 못한 것과 맞는다.

재시작이 반복될 수 있는 구조도 있었다. 실패하면 슬롯을 완료로 남기지 않고, 재시작 뒤 catch-up 창(40분) 안에서 60초마다 다시 돌았다.

## 2. 수정

`etf_universe_px.py`

- 종목별 종가를 `Bars`(공유·intern된 날짜 문자열 리스트 + `array('d')`)로 보관한다.
- `_parse_closes`: gzip 텍스트 스트림을 1MB씩 읽으며 종목 하나씩 `raw_decode`한다. 전체 텍스트를 한 번에 메모리에 올리지 않는다.
- `save_closes`: 종목 하나씩 gzip에 바로 쓴다(임시 파일 → `replace`). 업로드는 완성된 파일 바이트(약 15MB)를 올린다.
- `_fetch_into`: 받은 배치를 바로 병합하고 280봉으로 자른다. 2y 응답을 모아 두지 않는다.
- 저장 파일 형식은 그대로다(`{"v":1,"bars":{sym:[[day,close],...]}}`). 기존 R2·로컬 파일을 그대로 읽는다.

`etf_universe_px_scheduler.py`

- 슬롯당 최대 2회만 시도한다(`MAX_ATTEMPTS_PER_SLOT`).
- 시도하기 전에 `last_etf_universe_px_try_slot = "<slot>#<n>"`을 기록한다. 키가 `last_*_slot` 형태라 R2 `scheduler/slots.json`에 미러링되고, 재시작 때 `hydrate_all_durable_slots`로 복원된다. 메모리 초과로 죽은 시도도 1회로 센다.
- 2회를 다 쓰면 그 슬롯을 완료 처리하고 다음 평일로 넘어간다.

## 3. 검증 (로컬, R2 스텁 · 네트워크 없음)

- `python 03_ETF/etf_universe_px.py --self-test` 통과(병합·파싱 테스트 추가).
- 9,341종 × 280봉 저장소, 2,000종 2y 병합 포함:

| 단계 | 이전 | 이후 |
|---|---:|---:|
| 불러오기 증가분 | 약 650MB | 약 70MB (RSS 31 → 107MB) |
| 병합 + 저장 | 약 480MB | 추가 증가 거의 없음 (108MB) |

- 저장 → 다시 불러오기 왕복 결과 일치.
- 실제 야후 호출과 Render 위 실행은 아직 하지 않았다.

## 4. Cursor가 할 일

1. 두 파일 커밋 → 푸시 → Render 배포.
2. 배포 후 첫 20:10 KST 실행 뒤 `https://savvyetf-bot.onrender.com/health`에서 `last_etf_universe_px_ok_at` · `last_etf_universe_px_as_of`가 채워졌는지 확인.
3. Render 로그에서 `heavy work begin: scheduled-etf-universe-px` 전후 메모리 줄(`MEMORY_DEBUG=true`)과 재시작이 없는지 확인.
4. 다시 메모리를 넘기면 임시로 Render 환경변수 `ETF_UNIVERSE_PX_SCHEDULE_ENABLED=false`.
