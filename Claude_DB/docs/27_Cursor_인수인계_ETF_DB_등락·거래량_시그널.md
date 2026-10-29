# 27. Cursor 인수인계 — ETF·DB 첫 화면 '등락·거래량 시그널' + 20:10 거래량 저장 + 국가 ETF 탭 정리 (2026-10-29)

- 작성: 2026-10-29 (Claude Code) · 받는 쪽: Cursor (커밋·푸시·배포)
- 대상 저장소: `/Users/wooyeol/GitHub/SavvyETF` (`main`, HEAD `d374c72` 기준)
- 요청: 숨겨 둔 '국가 ETF' 탭을 프로토타입으로 삼아 ETF·DB 탭 첫 화면을 새로 만든다. 탭을 열 때 무거운 수집을 하지 않고, 6개 권역(한국·미국·유럽·일본·홍콩·중국) ETF DB를 기반으로 권역마다 거래량이 늘거나 크게 등락한 ETF를 보여 준다.

---

## 0. 먼저 볼 것 — 같은 시간에 다른 쪽에서 편집이 있었다

- 16:20:00에 `03_ETF/etf_universe_px.py`와 `webapp/src/lib/etfUniverse.ts`의 미커밋 변경(내 것)이 HEAD 상태로 되돌아갔다. 다시 적용했고, 지금 작업 트리에는 내 변경이 들어 있다.
- `webapp/src/components/Dashboard.tsx`와 `webapp/src/lib/types.ts`에는 **내가 하지 않은 변경**이 섞여 있다.
  - `graph` 탭을 `unlocked ? <GraphTab /> : null`로 바꿈
  - `HIDDEN_NAV_TABS`에서 `"graph"` 제거
  - 커밋할 때 이 둘을 따로 나눌지 판단해 달라. 내 변경은 `countryetf` 관련 줄뿐이다.

## 1. 국가 ETF 탭 — 남아 있던 데이터 작업과 정리 결과

조사:
- 탭은 `HIDDEN_NAV_TABS`로 메뉴에서만 숨겨져 있었다. 컴포넌트와 `/api/country-etf`는 살아 있어서 `?tab=countryetf`로 열 수 있었다.
- 탭을 열 때마다 미국 상장 국가·브로드 ETF 25종을 실시간으로 수집했다. 이것이 무거웠던 원인이다.
  - Yahoo: fc.yahoo.com 쿠키 → getcrumb → quoteSummary
  - iShares: 상품 페이지 HTML을 긁어 편입종목·업종비를 읽음
  - 수집 결과를 R2 `country_etf/<티커>/latest.json`과 `snapshots/`에 저장
- 크론(warm-cache 포함)이나 봇에서 이 작업을 부르는 곳은 없었다.

정리:
- 삭제: `webapp/src/components/CountryEtfTab.tsx`, `webapp/src/app/api/country-etf/route.ts`, `globals.css`의 `.country-etf-*` 블록, `middleware.ts`의 `/api/country-etf` 레이트리밋
- `Dashboard.tsx`·`lazyTabs.tsx`: `CountryEtfTab` 제거
- `types.ts`: nav 목록과 `HIDDEN_NAV_TABS`에서 `countryetf` 제거. `canonicalShellTab`이 `countryetf`를 `etfdb`로 바꾸므로 옛 링크는 새 첫 화면으로 열린다(확인함).
- `lib/countryEtf.ts`: MP 탭이 쓰는 것만 남겼다(783줄 → 216줄).
  - 남긴 것: `fetchIsharesBreakdown`, `countryLabelKo`, `loadPrevSnap`, 국가·GICS 이름표
  - 지운 것: Yahoo crumb·topHoldings 수집, `collectCountryEtf*`, `saveSnap`, `COUNTRY_ETF_UNIVERSE`
- `mpEtfAnalytics.ts`: ACWI 국가비중의 3순위 대체값으로 R2 `country_etf/ACWI/latest.json`을 계속 읽는다. 1순위는 iShares 실시간, 2순위가 이 스냅샷, 3순위가 정적값이다. 이 스냅샷은 이제 새로 쓰이지 않고, 출처 표기만 "저장된 ACWI 국가비중 스냅샷"으로 바꿨다.
- `dataCatalog.ts`: `country_etf` 항목의 `viewTab`을 빼고 설명을 "종료·MP 대체값 용도"로 고쳤다. R2 데이터는 지우지 않았다.

## 2. 20:10 작업에 거래량 저장 (`03_ETF/etf_universe_px.py`)

Yahoo chart 응답에 이미 들어 있던 `volume`을 버리지 않고 종가 옆에 저장한다. **Yahoo 요청 수는 늘지 않는다.**

- `fetch_bars`: `[day, close, volume|None]`을 반환한다.
- `Bars`: `vol` 배열(`array('d')`)을 추가했다. 거래량이 없는 날은 NaN이다.
- 종가 저장소 형식 `{"v":2,"bars":{sym:[[day,close,volume|null],...]}}`
  - 기존 v1 파일(거래량 없음)도 그대로 읽는다.
  - `merge_bars`는 새 봉에 거래량이 없으면 기존 거래량을 유지한다.
- 신호 `volume_signals`(일 수는 모두 거래일 기준):
  - `r1d`: 마지막 거래일 수익률(%)
  - `vr1`: 마지막 1일 거래량 ÷ 직전 20일 평균. 직전 20일은 최근 5일을 뺀 그 앞 20일이다.
  - `vr5`: 최근 5일 평균 ÷ 같은 직전 20일 평균
  - 기준 20일 중 거래량이 15일 미만이거나 평균이 0이면 비율을 비운다. 매일 0주가 찍히는 저유동 상품을 거르기 위해서다.
- R2 `etf_universe_px/latest.json`
  - 시장별 행을 `[t, r1w, r1m, r3m, r1y, r1d, vr1, vr5]`로 늘렸다(**뒤에 덧붙임**).
  - 시장마다 `cols`를 함께 싣는다.
  - 앞 5칸 위치는 그대로라서 옛 웹 코드도 깨지지 않는다.
- 첫 실행 보충
  - 이미 종가가 252일 이상 있지만 최근 25일 거래량이 15일 미만인 종목은 그날 `5d` 대신 `3mo`로 한 번 받는다(`n_vol_backfill`).
  - 요청 수는 같고 응답만 조금 크다.
  - 25분 마감에 걸리면 남은 종목은 다음 날 이어서 받는다.
- 로컬 실행(`python 03_ETF/etf_universe_px.py`)은 `data/etf_universe_px/latest.json`(gitignore)도 남긴다. 웹 dev 서버는 R2가 설정되지 않았을 때 이 파일을 읽는다. 스케줄러(봇) 경로는 바뀌지 않았다.

검증:
- `--self-test` 통과. 거래량 비율, v1·v2 파싱, 병합, 저유동 처리 테스트를 추가했다.
- 메모리 실측(합성 데이터 9,341종 × 280일, 거래량 포함, Python 3.10, macOS ru_maxrss)
  - 불러오기 최대 약 119MB, 불러오기+저장 약 123MB, 불러오기+신호 계산 약 125MB
  - Render starter 512MB 안이다.
  - gzip 저장소는 합성 기준 약 24MB다(실제 거래량은 자릿수가 고르지 않아 더 작을 것으로 보지만 실측하지 않음).
- 실제 Yahoo 소량 실행(시장별 6종목, 120종목)
  - 6개 시장 모두 `r1d`·`vr1`·`vr5`가 채워졌다.
  - v1 저장소에서 시작하면 첫날 `n_vol_backfill=34`, 다음 날 `n_bump=34`로 넘어가는 것을 확인했다.
- **운영에서 확인할 것**: 배포 후 첫 20:10 실행 로그의 `n_vol_backfill`(약 9,000 예상)과 실행 시간, Render 메모리 그래프.

## 3. 웹 — ETF·DB 첫 화면 '등락·거래량 시그널'

- `webapp/src/lib/etfUniverseServer.ts`
  - 오버레이가 `px.cols`를 보고 `r1d`, `vr1`, `vr5`도 덮어쓴다. `cols`가 없는 옛 파일은 앞 5칸만 읽는다.
  - dev 전용 로컬 파일 대체(`../data/etf_universe_px/latest.json`)를 추가했다.
- `webapp/src/lib/etfUniverse.ts`: `EtfUniverseRow`에 `r1d`, `vr1`, `vr5`를 추가했다.
- `webapp/src/components/EtfMoversPanel.tsx` (신규)
  - 이미 받은 시장 파일만 클라이언트에서 계산한다. 새 API나 외부 호출은 없다.
  - 기간 1D/1W/1M/3M 중 데이터가 있는 것만 보여 준다. 거래량 기준은 당일(2배↑)과 5일 평균(1.5배↑) 중에서 고른다.
  - 자산군 칩이 있고, 레버리지·인버스는 기본 제외(체크하면 포함)다. 순자산 하한은 한국 50억원, 그 밖 $20M다.
  - 요약: 상승·하락 종목 수, 중앙값, 거래 급증 종목 수, 기준일
  - 목록: 상승 상위 10, 하락 상위 10, 거래 급증 10
  - 거래량 이력이 25일 쌓이기 전에는 세 번째 칸에 스냅샷 회전율(일평균 거래대금 ÷ 순자산)을 보여 준다. 거래대금과 순자산 단위가 같은 시장에서만 계산하고, 일본은 거래대금이 ¥M이라 계산하지 않는다.
  - 표: 투자지역, 업종, 전략·테마별 √순자산 가중 등락, 순자산, 거래 급증 수, 가장 크게 움직인 ETF. 국가 ETF 탭의 지역 칩을 대신하는 부분이다.
  - 이상치 제외: 레버리지가 아닌 ETF가 1D ±30%, 1W ±40%, 1M ±60%, 3M ±100%를 넘으면 시세 오류로 보고 뺀다. 단기자금은 기준의 1/5다. 제외한 수는 화면에 표시한다.
    - 실제 사례: 유럽 BNKE 1D −98.7%, 홍콩 위안화 MMF 1D −14.9%
- `webapp/src/components/EtfUniverseTab.tsx`
  - 시장 탭 아래에 `등락·거래량 시그널`(기본) / `전체 분류표` 전환을 넣었다.
  - 한국·미국 '실시간 수급 보기' 버튼은 그대로다.
- `globals.css`: `/* ETF·DB 등락·거래량 시그널 */` 블록(`.etfmv-*`, `.etfu-views`)을 추가했다.

검증(로컬 `next dev -p 3017`, R2 키 없음):
- 시장별 상위 120종목만 20:10 작업으로 받아 로컬 `latest.json`을 만들고 확인했다. 확인 뒤 부분 종가 저장소와 `latest.json`은 지웠다. 부분 저장소가 남아 있으면 다음 로컬 실행 때 R2 원본 대신 그 파일을 읽기 때문이다.
- 6개 시장 모두 목록과 그룹표가 나오는 것을 확인했다. `전체 분류표` 전환과 `?tab=countryetf`에서 `etfdb`로 넘어가는 것도 확인했다.
- 모바일 375px에서 가로 스크롤이 없다.
- 새로고침 뒤 네트워크 요청은 모두 200이다. 콘솔에 404가 하나 남아 있었는데, 편집 중 dev 서버가 다시 컴파일될 때 난 `/api/etf-universe?market=us` 요청이었고 같은 요청이 바로 뒤에 200으로 성공했다.
- `npx tsc --noEmit` 통과(`--noUnusedLocals`로도 `countryEtf.ts` 경고 없음). 웹앱에는 eslint 설정이 없다.

## 4. 커밋 제안 (두 개로 나누는 것을 권함)

```
feat(etf-universe-px): keep Yahoo volume next to each close and publish 1D return and volume ratios
feat(etf-db): open ETF·DB on a movers and volume-surge screen per listing market, retire the country ETF tab
```

배포 순서는 상관없다. 웹은 새 칸이 없으면 스냅샷 회전율로 대신하고, 봇은 새 칸을 뒤에 덧붙이기 때문이다.
