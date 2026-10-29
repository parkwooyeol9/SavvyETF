# 26. Cursor 인수인계 — AI Pick 탭 개편 (ETF · 주목 종목 매수/매도 Pick) (2026-10-29)

- 작성: 2026-10-29 (Claude Code) · 받는 쪽: Cursor (커밋·푸시·배포)
- 대상 저장소: `/Users/wooyeol/GitHub/SavvyETF` (`main`), 웹앱 `webapp/`
- 범위: 웹앱만 바꿨다. 봇(Render)·Python 작업·새 크롤링·새 외부 수집은 없다. 이미 저장소와 R2에 있는 산출물만 읽는다.

---

## 1. 바뀐 화면

AI → AI Pick 탭(`tab=ideas`)이 두 구역으로 바뀐다.

1. **ETF · 국가 / 업종 / 테마**: 상장시장(한국·미국·일본) × 구분(국가별·업종별·테마별) 토글. 매수 Pick과 매도 Pick을 최대 5개씩 보여 준다.
2. **주목할 만한 종목 · 한국 / 미국 / 일본**: ACWI 구성 종목 중 매수 Pick과 매도 Pick을 최대 5개씩 보여 준다.

카드 하나에는 점수(0~100), 근거 칩(1W/1M/3M/1Y, Flow, 추세 n/6, RSI, 뉴스 등), 한 줄 근거, **기준일**이 표시된다. 상단에는 데이터 소스별 기준일을 보여 주고, 없는 소스는 노란색 "없음 — … 생략"으로 표시한다. 맨 아래 "신호 규칙"은 접어 둔다.

## 2. 파일

| 파일 | 내용 |
|---|---|
| `webapp/src/lib/aiPick.ts` (신규) | 타입·신호 규칙(순수 함수). ETF 그룹핑(국가 `reg` / 업종 `sec` / 테마 키워드·`st`), 점수, Flow 가감, 종목 점수 |
| `webapp/src/lib/aiPickData.ts` (신규) | 서버 로더. 아래 데이터 소스를 읽어 payload를 만든다 |
| `webapp/src/app/api/ai-pick/route.ts` (신규) | `GET /api/ai-pick`. 서버 캐시 10분(stale 60분), CDN `etfSlow` |
| `webapp/src/components/AiPickTab.tsx` (신규) | 새 화면 |
| `webapp/src/components/TradingIdeasTab.tsx` (삭제) | 옛 화면. `Dashboard.tsx`·`lazyTabs.tsx`가 `AiPickTab`을 쓰도록 바꿨다 |
| `webapp/src/lib/etfUniverseServer.ts` (신규) | `/api/etf-universe` 라우트에 있던 R2 수익률 오버레이 로직을 옮겼다. 동작은 같다 |
| `webapp/src/lib/acwiPxStore.ts` (신규) | `/api/acwi-tech` 라우트에 있던 R2 `acwi_px` 로더를 옮겼다. 캐시 키 `acwi-tech:stored`도 그대로라서 두 API가 같은 캐시를 공유한다 |
| `webapp/src/app/api/etf-universe/route.ts`, `webapp/src/app/api/acwi-tech/route.ts` | 위 lib를 import하도록만 바꿨다 |
| `webapp/src/app/globals.css` | 맨 끝에 `/* AI Pick */` 블록(`.aipick-*`)을 추가했다 |

`/api/trading-ideas`와 `lib/tradingIdeas.ts`는 **남겨 두었다**. 비중 최적화 탭(`WeightOptimizeTab`)이 계속 쓴다.

## 3. 데이터 소스 (모두 기존 산출물)

| 소스 | 위치 | 용도 |
|---|---|---|
| ETF 유니버스 kr/us/jp | `src/data/etfUniverse/*.json` + R2 `etf_universe_px/latest.json` | 그룹 1W·1M·3M·1Y(√AUM 가중), 대표 ETF |
| ETF Flow 주간 | R2 `etf_flow_weekly/latest.json` (로컬 dev는 `00_exports/etf_flow_weekly/` 최신본) | 미국 테마 4주 순유입, 미국 상장 순유입·유출 상위 티커, 한국 상장 기관+외국인 순매수 |
| ACWI 추세·밸류 | `src/data/acwiTechFacts.json` (as_of 2026-10-01) | 추세 n/6, 12M, 52주 고점 대비, PER 3년 백분위, ROE |
| ACWI 일봉 | R2 `acwi_px/latest.json` | 기존 `buildQuantSnapshot`으로 RSI·MA22·MACD·z → 매수/관망/매도 타이밍 |
| 한국 뉴스 NLP | R2 `kospi200_panel/latest.json`의 `nlp_score` | ±5 가감 |
| 한글 종목명 | `src/data/kospi200Universe.json`, `kosdaq100Universe.json` | 한국 종목 이름 표시 |

`/api/ai-pick`은 Yahoo 등 외부로 요청하지 않는다. R2에 일봉이 없으면 타이밍 없이 팩트만으로 계산한다(`acwi-tech`처럼 Yahoo로 대체 조회하지 않는다).

## 4. 신호 규칙 요약

- **ETF**: 레버리지·인버스는 제외한다. 그룹 AUM이 최소 기준(한국 300억원, 미국 $1B, 일본 $300M)에 못 미치면 제외한다. 점수는 같은 구분 안에서 순위로 매기며 3M 40%, 1Y(없으면 6M) 30%, 1M 30%이고, 수급 방향에 따라 ±8을 더하거나 뺀다.
  - 매수: 점수 ≥ 65 · 1M > 0 · 3M > 0 · 과열 아님(1W ≥ +8% 또는 1M ≥ +20%이면 과열로 보고 제외)
  - 매도: 점수 ≤ 35 · 1M < 0 · 3M < 0
- **종목**: 점수 = 추세 n/6 × 55, 12M 순위 × 15, 52주 고점(±5), PER 3년 백분위(≥95면 −8, ≤20이면 +5), ROE ≥ 15%(+5), 일봉 타이밍(±15)과 모멘텀(±5), 뉴스(±5)를 합산한다.
  - 매수: 점수 ≥ 65 · 추세 ≥ 4 · 타이밍이 매도 아님
  - 매도: (점수 ≤ 35 · 추세 ≤ 2), 또는 (타이밍 매도 · 추세 ≤ 3)

## 5. 검증 (로컬 `next dev -p 3017`, R2 키 없음)

- `npx tsc --noEmit` 통과. 웹앱에 eslint 설정 파일이 없어 lint는 돌리지 않았다.
- `/api/ai-pick` 200. 한국 상장 국가 9 · 업종 10 · 테마 18그룹, 미국 상장 테마 17그룹 등. 종목은 한국 80 · 미국 543 · 일본 178종목을 평가했다.
- 화면은 데스크톱과 모바일(375px, 가로 스크롤 없음)에서 확인했다. 콘솔 에러는 0건이다.
- `/api/etf-universe?market=kr`(1,088행)와 `/api/acwi-tech?country=한국`(15행)은 리팩터링 후에도 정상이다.
- **로컬에는 R2 키가 없어서** ETF 일간 수익률 오버레이, ACWI 일봉 타이밍, KOSPI200 NLP는 "없음"으로 표시된 상태로만 확인했다. 배포 후 운영에서 다음을 확인해 달라.
  1. 상단 소스 스트립에서 세 항목에 날짜가 찍히는지
  2. 종목 카드에 `일봉 매수 · 상승/중립`, `RSI` 칩이 나오는지
  3. 한국 종목에 `뉴스 …` 칩이 나오는지
- 참고: 번들 스냅샷의 한국 상장 1M 값이 이상하게 낮다(예: KODEX 200 1M −18.8%). 그래서 로컬에서는 한국 상장 국가·업종 매수 Pick이 비어 있다. 운영에서는 R2 오버레이 수익률로 덮이므로 그때 다시 볼 것.

## 6. 커밋 제안

```
feat(ai-pick): rebuild the AI Pick tab on stored ETF, flow, ACWI and NLP data
```

- 메모리: 응답당 R2에 일봉이 있는 한국·미국·일본 종목(국가·업종별 주요 종목, 수백 개 이하)을 `buildQuantSnapshot`한다. 서버 캐시 10분이고 Vercel 함수에서 돈다. 봇 메모리와는 무관하다.
