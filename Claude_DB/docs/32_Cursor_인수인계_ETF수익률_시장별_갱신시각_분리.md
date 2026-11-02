# 32. Cursor 인수인계 — ETF·DB 수익률: 한·일·중 16:10 / 미국·유럽·홍콩 아침 07:40 (2026-11-03)

- 작성: 2026-11-03 (Claude Code) · 받는 쪽: Cursor (커밋·푸시·배포)
- 대상 저장소: `/Users/wooyeol/GitHub/SavvyETF` (`main`)
- 계기: "ETF - DB 탭 수익률이 며칠 전에 멈췄다"는 점검 요청

---

## 1. 점검 결과 (11/03 08시)

갱신은 멈추지 않았다.

- 봇 health: `last_etf_universe_px_ok_at` 11/02 20:12, 오류 없음.
- 사이트 `/api/etf-universe`: 한국·일본·홍콩·중국은 `returns_as_of` 11/02, 미국·유럽은 10/30.

멈춘 것처럼 보인 이유:

1. 20:10 KST에는 미국·유럽 당일 장이 아직 열려 있다. 그래서 20:10 작업은 미국·유럽의 **전날** 종가만 다시 올렸다. 월요일 밤에는 금요일 종가가 올라가, 주말을 끼면 사흘 전에 멈춘 것처럼 보였다.
2. 6M·샤프·MDD·순자산·거래대금은 번들 스냅샷(10/28) 값이다. 매일 바뀌는 열이 아니다. 이번 작업에서는 바꾸지 않았다.

## 2. 수정 — 시장 그룹별로 마감 뒤 한 번씩만

| 그룹 | 시장 | 시각 (KST) | 요일 |
|---|---|---|---|
| asia | kr, jp, cn | **16:10** (기존 20:10) | 월–금 |
| west | us, eu, hk | **07:40** (신규) | 화–토 (각 세션 다음 날 아침) |

### 시각을 고른 근거 (평일 오후 봇 스케줄 점검)

| KST | 작업 | heavy-work 잠금 |
|---|---|---|
| 15:30 | 한국·일본 마감 | |
| 15:40 | summary_kor (catch-up 45분) | 사용 |
| 16:00 | 상하이·선전 마감 (15:00 CST) | |
| **16:10** | **etf_universe_px asia (약 3분)** | 사용 |
| 16:20 | etfcheck (잠금 대기 최대 360초) | 사용 |
| 16:25 | nlp_history | 미사용 |
| 16:40 | summary_nxt | 사용 |
| 17:00 | 홍콩 마감 (16:00 HKT, 종가 동시호가 16:10까지) | |
| 17:15 · 17:25 · 17:50 · 18:10 · 18:20 | kosdaq100 · kospi200_panel · kosdaq_active · rebalance · etfdb | 사용 |

- 16:00–16:20은 비어 있다. 16:10이면 중국 마감 10분 뒤이고, 약 3분 작업이 16:20 etfcheck 전에 끝난다.
- 홍콩은 17:00 KST에 마감한다. 17:15–18:20 국내 작업 사이에 끼우지 않고 다음 날 07:40 그룹으로 보냈다. 홍콩 수익률은 저녁에는 전날 종가로 보이고, 아침에 당일 종가로 바뀐다.
- 미국·유럽은 20:10에 중복으로 돌리지 않는다. 07:40은 07:00 미국 시황 다음이고 09:00 국내 장 시작 전이다.
- Vercel cron(10·15·20분 주기 등)은 웹 쪽이라 봇 잠금과 겹치지 않는다.

### 마감 시각 버그 수정 (`close_pending`)

- 일본: 15:00 → **15:30** JST. 도쿄증권거래소는 2024-11-05부터 15:30에 마감한다.
- 중국: 16:00 → **15:00** CST. 이전 값대로면 16:10 KST(15:10 CST)에도 장중으로 보고 당일 봉을 버렸다.
- 홍콩: 16:00 → **16:10** HKT (종가 동시호가 포함).

### 바뀐 파일

- `03_ETF/etf_universe_px.py`
  - `MARKET_GROUPS = {"asia": ("kr", "jp", "cn"), "west": ("us", "eu", "hk")}`
  - `close_pending`: 일본·중국·홍콩 마감 시각 수정(위 표). self-test에 16:10 KST 판정 테스트 추가.
  - `build_payload(..., markets=...)`: 해당 시장만 받아서 계산한다.
  - `_slim(payload, previous)`: 이번에 돌린 시장으로 이전 `latest.json`의 해당 시장만 덮어쓴다. 다른 그룹 시장은 그대로 둔다. 최상위 `as_of`는 전체 시장 중 최신 날짜로 다시 계산한다.
  - `publish`: R2 `etf_universe_px/latest.json`을 읽어서 병합한 뒤 올린다. `save_local_latest`도 로컬 파일과 병합한다.
  - `--markets`에 `choices` 추가. self-test에 병합 테스트 추가.
- `03_ETF/etf_universe_px_scheduler.py`: 그룹 두 개를 한 스레드에서 돈다. 슬롯·시도 횟수(최대 2회)·오류는 그룹마다 따로 기록한다.
  - asia는 기존 상태 키(`last_etf_universe_px_*`)를 그대로 쓴다.
  - west는 `last_etf_universe_px_west_*` 키를 새로 쓴다. `last_etf_universe_px_west_slot`·`_west_try_slot`은 `_slot`으로 끝나므로 R2에 미러링된다.
  - 환경변수 `ETF_UNIVERSE_PX_WEST_SCHEDULE_KST`(기본 `07:40`)를 추가했다. 기존 `ETF_UNIVERSE_PX_SCHEDULE_KST`는 asia 시각이고 기본값을 `16:10`으로 바꿨다. **Render에 이 변수가 `20:10`으로 설정돼 있으면 지우거나 `16:10`으로 바꿀 것.**
- `01_봇/bot.py`: health에 west 키 4개와 `schedule.etf_universe_px_west_kst`, note 문구 추가.
- `webapp/src/components/EtfUniverseTab.tsx`: 상단 설명과 수익률 기준일 툴팁을 시장별 갱신 시각으로 바꿨다(미국·유럽·홍콩 "화–토 07:40", 한국·일본·중국 "평일 16:10").
- 주석·문구만 바꾼 파일: `EtfMoversPanel.tsx`, `apiCache.ts`, `api/etf-universe/route.ts`, `etfUniverseServer.ts`, `api/ai-pick/route.ts`.

## 3. 검증 (로컬)

- `python 03_ETF/etf_universe_px.py --self-test` 통과.
- `py_compile`(bot.py·작업·스케줄러)와 `webapp` `tsc --noEmit` 통과.
- 스케줄러 시뮬레이션(상태·작업 스텁, 11/02 월–11/08 일): asia(kr·jp·cn)는 월–금 16:10, west(us·eu·hk)는 화–토 07:40에 돌았다. 일요일·월요일 아침 west와 토·일 asia는 건너뛰었다. 수요일 아침에 일부러 한 번 실패시키자 다음 폴링(07:41)에 다시 시도해 성공했다.
- 실제 야후 호출(시장별 5종, 임시 폴더, 기준 시각 11/03 07:40 KST, 그룹 변경 전 구성): 두 그룹을 차례로 저장한 뒤 `latest.json`에 6개 시장이 모두 남았다. 저장소의 `data/`는 건드리지 않았다.
- 16:10 시점에 야후 중국(.SS/.SZ) 일봉에 당일 종가가 들어와 있는지는 실제로 보지 못했다(점검 시각이 오전).
- Render 위에서는 아직 돌려 보지 않았다.

## 4. Cursor가 할 일

1. 위 파일 커밋 → 푸시 → Render 배포.
2. 배포 당일 16:10 KST 뒤 health의 `last_etf_universe_px_ok_at`이 16:1x, `last_etf_universe_px_as_of`가 당일인지 본다. 사이트 중국 탭 "수익률" 기준일이 당일 종가인지도 본다(야후 지연으로 전날이면 asia 시각을 16:15로 미룬다. 16:20 etfcheck 전에 끝나는지 같이 확인).
3. 다음 날 07:40 KST 뒤 `https://savvyetf-bot.onrender.com/health`에서 다음을 확인한다.
   - `last_etf_universe_px_west_ok_at`이 그날 07:4x로 채워졌는가.
   - `last_etf_universe_px_west_as_of`가 전날(미국 세션) 날짜인가.
4. 사이트 ETF·DB 미국·홍콩 탭의 "수익률" 기준일이 전날 종가로 나오는지 확인한다. 한국 탭은 16:10 작업 뒤 당일 종가가 그대로 나와야 한다.
5. 배포 직후 첫 asia 실행 때는 R2 `latest.json`의 미국·유럽 행이 유지되는지 같이 본다. asia 실행은 이제 미국·유럽·홍콩을 다시 쓰지 않는다. `latest.json`이 없으면 부분 발행이 그 그룹만 남긴다. 운영 파일은 이미 있으므로 첫 실행은 병합이다.

## 5. Cursor 검토 (2026-11-03)

- 스케줄 분리, 마감 시각, `latest.json` 병합, health 키, 화면 문구는 인수인계와 같다.
- `get_json`은 일시 오류에서 예외를 던진다. 읽기 실패가 다른 시장을 지우고 저장으로 이어지지 않는다.
- 코드 기본값은 16:10이지만 `render.yaml`과 `.env.example`이 `20:10`이었다. Render는 이 값을 환경변수로 넣으므로 그대로 두면 asia가 저녁에 남는다. 배포 커밋에서 `16:10`과 `ETF_UNIVERSE_PX_WEST_SCHEDULE_KST=07:40`으로 바꿨다.
- 오늘(11/03) 07:40 캐치업(40분, 08:20까지)은 배포 시각을 넘겼다. 미국·유럽·홍콩 첫 실행은 11/04 07:40이다. 한국·일본·중국은 오늘 16:10이다.
