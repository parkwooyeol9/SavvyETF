# 22. Cursor 인수인계 — ETF DB 기준일·미국 종수·수급 화면 캐시 (2026-10-29)

- 작성: 2026-10-29 (Claude Code) · 받는 쪽: Cursor
- 저장소: `/Users/wooyeol/GitHub/SavvyETF` (`main`), 커밋 안 함. 커밋·푸시는 Cursor가 한다.
- 출발점: 21번 진단 문서(`21_Cursor_인수인계_ETF_DB_수급_진단.md`). 이번 작업은 그 진단에 대한 수정이다.
- 사용자 결정: ETF Flow 탭(`?tab=etfflow`)은 손대지 않는다(별도 용도). ETF CHECK 수급은 무료 데이터라 공개 화면에 나가도 된다.

---

## 1. 바뀐 것 요약

| # | 화면 | 전 | 후 |
|---|---|---|---|
| 1 | DB 탭 상단 「기준」 | `2026-10-28 15:38 (파일 저장 시각)` 한 줄 | 「기준일」 칸에 **순자산·분류 날짜**와 **수익률 날짜**를 두 줄로 따로 표시 |
| 2 | DB 탭 미국 종수 | 4,335종 | **5,054종** (유형 미수집 ETF 719종 포함, 표에 「분류 추정」 태그) |
| 3 | ETF 시황 「ETF 수급」 | 캐시가 비면 클릭이 ETF CHECK 6회를 기다림(약 17초) | R2에 마지막 결과를 두고 바로 응답, 30분 넘으면 응답 뒤에 갱신 |
| 4 | DB 「한국 실시간 수급 보기」 | 캐시가 비면 네이버 목록 + 기초지수 최대 220개를 기다림(약 18초) | 같은 방식. 장중 3분·장외 1시간마다 응답 뒤에 갱신 |

---

## 2. 파일별 변경

### 2.1 `03_ETF/etf_universe.py` (스냅샷 빌더)

- `ETF_NAME_RE` 추가. `load_refinitiv()`에서 펀드유형이 비어 있으면(`Unable to collect…`, `NULL`) **Refinitiv 이름 또는 Datastream 이름(`name2`)에 ETF·ETN·ETP, 또는 코인·금속 Trust가 있을 때만** 남긴다. 펀드유형 칸에 다른 문자열이 있거나 이름이 ETF가 아니면 지금처럼 버린다. 제외 사유 이름은 `펀드유형 없음·이름도 ETF 아님(BDC·스팩·회사 등)`이다.
- 남긴 행에는 `nf: 1`이 붙는다. 자산군·지역은 종목명으로만 추정한다(`asset_of(None, …)`는 이름 키워드를 보고, 없으면 주식).
- Refinitiv 이름이 ETN 발행사(`Jpmorgan Chase Financial Company LLC`)인 경우는 Datastream 이름을 쓴다. Datastream 약칭(대문자)이라 운용사를 알 수 없으면 `iss`는 비운다(`STE.STR.` 접두는 SPDR로 본다).
- `JSON_KEYS`에 `nf`를 추가했다. `notes_for()`에 「유형 미수집 포함」 줄이 추가되고, 엑셀 「기준·주석」 시트에도 같은 줄이 들어간다.

다시 돌린 결과 (`python 03_ETF/etf_universe.py --markets us eu jp hk`, 2026-10-28 원본 기준):

| 시장 | 전 | 후 | 이름으로 포함 | 남은 제외 |
|---|---:|---:|---:|---|
| 미국 | 4,335 | **5,054** | 719 (순자산 $4.7B, 전체의 약 0.03%) | 유형 없음·ETF 아님 252, 상장폐지 154, OTC 50 |
| 유럽 | 1,613 | 1,618 | 5 | 2 |
| 일본 | 421 | 430 | 9 (ETN) | 3 |
| 홍콩 | 221 | 221 | 0 | 9 |

한국·중국은 다시 돌리지 않았다(해당 없음).

- 갱신 파일: `webapp/src/data/etfUniverse/{us,eu,jp,hk,index}.json`. 홍콩은 제외 사유 이름만 바뀌었다.
- 엑셀 `00_exports/etf_universe/ETF_Universe_{미국,유럽,일본,홍콩}_20261029.xlsx`도 새로 생겼다. 00_exports는 원래 커밋 대상이 아니면 그대로 두면 된다.

남은 252건은 BDC(Main Street, Blue Owl, Golub), 스팩, 일반 회사다. 원본 시트 1행 C열에 `Paused at 15:28:57`이 찍혀 있다. Refinitiv 애드인이 멈춘 채 저장된 것으로 보이고, 969건이 한꺼번에 수집 실패한 원인일 가능성이 크다. SavvyDB에서 다시 받으면 `nf` 행이 정식 분류로 바뀐다. 코드는 그대로 두면 된다.

### 2.2 `webapp/src/lib/etfUniverse.ts`

- `EtfUniverseRow.nf` 타입을 추가했다.
- `asOfDay()`를 추가했다. `"2026-10-28 15:38 (파일 저장 시각)"`·`"2026-10-28 15:21:34"`를 `"2026-10-28"`로 바꾼다.

### 2.3 `webapp/src/components/EtfUniverseTab.tsx` + `globals.css`

- 「기준」 칸을 「기준일」 칸으로 바꾸고 `<dl class="etfu-asof">` 두 줄로 나눴다.
  - 순자산·분류: `asOfDay(file.as_of)`. 툴팁에 원래 문자열(Refinitiv 스냅샷 · 파일 저장 시각 등)이 나온다.
  - 수익률: 야간 작업이 덮었으면 `{returns_as_of} 종가`, 아니면 `{스냅샷 날짜} 스냅샷`. 툴팁으로 둘을 구분한다.
- 표 종목명 옆에 `nf` 행이면 「분류 추정」 태그를 단다(`etfu-tag`).
- CSS: `.etfu-asof`를 grid로 바꾸고 `dt`·`dd` 스타일을 추가했다. 375px 폭에서 가로 넘침이 없는 것을 확인했다.

### 2.4 새 파일 `webapp/src/lib/r2Snapshot.ts`

`withR2Snapshot({ key, freshMs, build })`는 마지막 성공 결과를 R2 `{ saved_at, data }`로 보관한다.

- **fresh**: R2 사본을 반환한다.
- **stale**: R2 사본을 바로 반환하고, `after()`(next/server)로 응답 뒤에 `build()`를 실행해 다시 저장한다. `after()`를 요청 밖에서 부르면 예외가 나는데, 이 경우(`withServerCache`의 백그라운드 갱신 안) 일반 promise로 대신 돈다. 같은 인스턴스 안에서는 `rebuilding` Set으로 중복 갱신을 막는다.
- **없음**: 처음 한 번만 그 요청이 `build()`를 기다린다.
- R2가 설정되지 않은 환경(로컬)에서는 매번 `build()`만 하고, 저장은 건너뛴다.

`withServerCache`의 메모리 캐시는 바깥에 그대로 둔다. 따뜻한 인스턴스는 메모리에서 바로 응답한다.

### 2.5 `webapp/src/app/api/etf-supply/route.ts`

- `withR2Snapshot` key `etf_supply/latest.json`, fresh 30분. ETF CHECK 순유입 보드는 하루 단위라 30분 묵은 사본으로 충분하다.
- 서버 캐시 키를 `etf-supply:v5`에서 `v6`으로 바꿨다.

### 2.6 `webapp/src/components/EtfSupplyPanel.tsx`

- 자동 새로고침 주기를 5분에서 **30분**으로 바꿨다.
- 새로고침이 실패하면 화면의 표를 지우지 않고 「갱신 실패 — 직전 결과를 표시합니다」 한 줄만 띄운다.
- 부제는 `기간 순유입 Top10 · ETF CHECK(일별 집계) · 조회 {시각}`이다.
- 보드별 「기준일」 표시는 넣지 않았다. ETF CHECK 응답의 `date`는 데이터 날짜가 아니라 조회 시각이다(미국 보드 `2026. 10. 29. 09:21`, 한국 보드 `null`). 나중에 날짜를 보이려면 응답 원문에서 다른 필드를 찾아야 한다.

### 2.7 `webapp/src/app/api/etf-db/route.ts` (한국 실시간 수급)

- 기존 빌드 로직(네이버 목록, 18:20 오버레이, 기초지수 보강, AUM 이력 복원)은 그대로이고, `withR2Snapshot`으로 감싸며 들여쓰기만 바뀌었다.
- key는 `etf_db_live/eq.json` / `etf_db_live/all.json`이다.
- `liveFreshMs()`는 평일 08:50–16:00 KST에 3분, 그 밖에는 60분이다. 공휴일은 평일로 취급하는데, 장외라도 3분마다 갱신될 뿐이라 문제없다.
- 18:20 수급 반영 뒤 장외 첫 화면은 최대 1시간 전 사본일 수 있다. 바로 반영해야 하면 봇 18:20 작업 끝에서 이 키를 지우거나, `liveFreshMs`의 장외 값을 줄이면 된다.
- payload 크기는 `equity=1` 기준 약 235KB다. R2 저장에 무리 없다.

---

## 3. 확인한 것 / 못 한 것

확인함 (로컬 `next dev -p 3017`, R2 없음):

- `npx tsc --noEmit` 통과. eslint는 저장소에 flat config가 없어 돌리지 못했다.
- `/api/etf-universe?market=us` → `count 5054`, `cols`에 `nf` 있음. index에서도 `us:5054`.
- DB 탭 미국: 상단 「기준일」 두 줄(`2026-10-28` / `2026-10-28 스냅샷`). `Osprey` 검색 시 `OBTC Osprey Bitcoin Trust`에 「분류 추정」 태그. 모바일 375px에서 넘침 없음.
- `/api/etf-supply` 200, 보드 20행. R2가 없어 live 경로였고 13.9초가 걸렸다.
- `/api/etf-db?equity=1` 200, 862행, 2.5초(live).

못 함:

- **R2가 있는 경로(stale → `after()` 갱신)는 로컬에서 돌려 보지 못했다.** 로컬에 R2 키가 없다. 배포 뒤 아래 순서로 확인할 것.
  1. `/api/etf-supply`를 처음 열면 느리다(사본 생성). 그 뒤 R2에 `etf_supply/latest.json`이 생기는지 본다.
  2. 다른 인스턴스, 또는 3분 뒤 첫 요청이 수백 ms 안에 오는지 본다.
  3. 30분 뒤 요청에서 Vercel 로그에 `r2 snapshot rebuild failed`가 없고, `saved_at`이 바뀌는지 본다.
- 브라우저에 이전 `/api/etf-universe` 응답이 캐시돼 있으면, 시장 탭 버튼의 종수가 잠깐 4,335로 남을 수 있다(로컬에서 한 번 봄). 배포하면 CDN이 새 응답을 준다.

---

## 4. 수익률 야간 작업(`etf_universe_px`) — 코드 수정 없음, 확인 필요

- 2026-10-29 09:13 health: `last_etf_universe_px_slot`·`ok_at`·`as_of`·`error`가 모두 null이고, `attempt_at` 키는 없다. 스케줄러 heartbeat는 살아 있다.
- 슬롯 키만 R2(`scheduler_slots`)에 남는다. `ok_at`·`attempt_at`·`error`는 봇 로컬 디스크의 `scheduler_state.json`이라 Render 재배포 때 지워진다. 실제로 다른 작업(ai_pulse·acwi_px·rebalance)도 `ok_at`이 null이다. 그래서 health만으로는 원인을 알 수 없다.
- 그래도 px 슬롯이 R2에 없다는 것은 **10/28 20:10–20:50 사이에 한 번도 성공하지 못했다**는 뜻이다. 커밋 `61cae9a`는 10/28 17:05 KST다.
- 로컬 확인: `--self-test`가 통과했고, 목록 8,580종을 읽었으며, 야후 5d 요청(069500.KS·VOO·SWDA.L·2800.HK)이 정상이었다. 코드 자체는 돈다.
- Cursor가 볼 것: Render 로그에서 10/28 20:10 이후 `etf_universe_px` 줄을 찾아 원인을 가른다.
  - `skipped: heavy work still busy`: 무거운 작업과 겹쳤다.
  - `failed: …`: 작업 중 예외가 났다.
  - 아무 줄도 없다: 그 시각에 배포가 안 됐거나 재시작됐다.
- 첫 실행은 8,580종(+ 이번에 추가된 미국 719종)을 2년치로 받는다. 25분 마감에 걸리면 받은 만큼만 저장하고 다음 날 이어받으니 그대로 두면 된다.
- 오늘(10/29) 20:10 뒤 health의 `last_etf_universe_px_slot`이 `2026-10-29-20-10`이 되면 정상이다. 그러면 DB 탭 「수익률」 줄이 `YYYY-MM-DD 종가`로 바뀐다.

---

## 5. 커밋 제안

한 커밋이어도 되고, 둘로 나눠도 된다.

1. `fix(etf-universe): keep US/EU/JP ETFs whose Refinitiv fund type failed to collect, split the as-of line`
   - `03_ETF/etf_universe.py`, `webapp/src/data/etfUniverse/*.json`, `webapp/src/lib/etfUniverse.ts`, `webapp/src/components/EtfUniverseTab.tsx`, `webapp/src/app/globals.css`
2. `perf(etf-supply, etf-db): serve the last good payload from R2 and rebuild after the response`
   - `webapp/src/lib/r2Snapshot.ts`(새 파일), `webapp/src/app/api/etf-supply/route.ts`, `webapp/src/components/EtfSupplyPanel.tsx`, `webapp/src/app/api/etf-db/route.ts`

이번 작업과 무관한 변경(`08_…md` 수정, `11`·`12`·`21` 문서, `research/*`)은 이 커밋에 섞지 말 것.
