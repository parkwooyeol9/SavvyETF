# 13. Cursor 인수인계 — ACWI 기술적분석 검토·수정 (2026-10-23)

- 작성: 2026-10-23 (Claude) · 받는 쪽: Cursor
- 대상 저장소: `/Users/wooyeol/GitHub/SavvyETF` (origin `parkwooyeol9/SavvyETF`, 브랜치 `main`)
- 기준 커밋: `6d11a62` (feat(web): show dated valuation context on the selected ACWI stock)
- 검토 범위: 오늘 Cursor 커밋 `23a413b` · `974c1e5` · `6d11a62` + 작업 트리에 남은 ETF Flow 매일 실행 변경
- **Claude는 git을 쓰지 않았습니다.** 아래 파일은 작업 트리에 수정만 된 상태입니다. 커밋·푸시는 Cursor 몫입니다.
- 라이선스(MSCI 비중·Datastream 밸류에이션 공개)는 사용자가 "괜찮다"고 확인함 → 공개 범위는 그대로 둠.

---

## 1. 검토 결과 요약

| 구분 | 내용 | 조치 |
|---|---|---|
| 🔴 버그 | Render 이미지(`Dockerfile`)에 `webapp/` 이 없어 06:30 `acwi_px` 작업이 유니버스를 못 읽음 → SPY 하나만 받고 `n_ok=1` 로 **성공 처리**, R2 에 SPY만 올라감. 웹은 저장본이 비어 매번 Yahoo 직접 호출하면서도 출처를 "06:30 KST 갱신"으로 표시 | 수정 (§2-A) |
| 🟠 효율 | `/api/acwi-tech` 가 표·티커 조회마다 R2 `acwi_px/latest.json`(주요 종목 2년 일봉, 수 MB)을 매번 새로 받아 파싱 | 수정 (§2-B) |
| 🟡 정확도 | Yahoo 일봉 타임스탬프(현지 개장 시각)를 UTC 날짜로 잘라서 UTC+10 이상 시장(서머타임 중 호주·뉴질랜드)이 하루 앞 날짜로 찍힘. Python·TS 양쪽 | 수정 (§2-A, §2-B) |
| 🟡 정확도 | Python 저장 대상(국가·업종별 상위 12)이 웹 표(한쪽 필터 상위 15)보다 좁아 13~15위는 매번 Yahoo 직접 호출 | 수정 (§2-A) |
| 🟡 UX | 국가·업종 칩을 빠르게 바꾸면 늦게 온 이전 응답이 최신 표를 덮어씀 | 수정 (§2-C) |
| 🟡 UX | 티커 조회 중 기간(6개월/1년/2년)을 바꾸면 조회 결과가 사라지고 표 첫 종목으로 돌아감 | 수정 (§2-C) |
| 🟡 UX | 요청 제한(429, IP당 분당 20회)·HTML 오류 응답이면 `res.json()` 이 터져 원인 없는 오류 문구 | 수정 (§2-C) |
| 🟡 위생 | 티커 서버 캐시 키가 사용자 입력 원문(대소문자·길이 무제한) | 수정 (§2-B) |
| ✅ 정상 | `tsc`, `npm run build` 통과. 관리자 ACWI 탭에서 빠진 "국가·업종·테마"는 `ValuationTab` 에서 계속 쓰이므로 회귀 아님 | — |
| ✅ 정상 | ETF Flow 매일 03:40 변경(미커밋) 코드 자체는 문제없음. 단 **기본값이 ON** 으로 바뀜 (§4) | 그대로 커밋 |

## 2. 수정한 파일 (커밋 A)

### A. `Dockerfile`, `10_공통/acwi_px.py`
| 파일 | 변경 |
|---|---|
| `Dockerfile` | `COPY webapp/src/data/acwiYahooUniverse.json webapp/src/data/acwiYahooUniverse.json` 한 줄 추가 (`data/universes/` 다음). `webapp/` 전체는 넣지 않음 |
| `10_공통/acwi_px.py` `build_payload` | 유니버스가 비면 `RuntimeError` → 스케줄러가 `last_acwi_px_error` 에 기록하고 슬롯을 소진하지 않음 (조용한 성공 방지) |
| `10_공통/acwi_px.py` `fetch_closes` | 날짜 = `timestamp + meta.gmtoffset` 기준 (거래소 현지 날짜) |
| `10_공통/acwi_px.py` `major_yahoos` | 기본 `per_country=15, per_sector=15` (웹 `pickAcwiMajors` 의 한쪽 필터 상한과 동일). 저장 시계열 559 → 661종목. 국가×업종 조합(상위 12)은 늘리면 1,442종목·JSON 약 16MB 라 넣지 않음 — 저장본에 없으면 웹이 Yahoo 직접 호출 |

### B. `webapp/src/app/api/acwi-tech/route.ts`
- `loadStored()` 를 `withServerCache("acwi-tech:stored", 10분, 60분 stale)` 로 감쌈 (실제 읽기는 `readStored()`). 저장본은 하루 한 번 바뀌므로 충분.
- `fetchYahoo` 도 `meta.gmtoffset` 으로 현지 날짜.
- `ticker` 파라미터를 `trim().toUpperCase().slice(0, 32)` 로 정규화한 뒤 캐시 키에 사용. (`parseQuantTicker`·`findAcwiRow` 가 어차피 대문자로 비교하므로 결과는 동일)

### C. `webapp/src/components/AcwiTechPanel.tsx`
- `readJson()` 헬퍼: 429 → "요청이 많습니다. 잠시 뒤 다시 눌러 주세요.", JSON 이 아니면 `HTTP <status>` 문구.
- `boardSeq` / `lookupSeq` ref: 마지막 요청의 응답만 상태에 반영 (이전 응답·로딩 표시가 최신 것을 덮지 않음).
- `lookupTicker` 상태 + 기간 변경 `useEffect`: 티커 조회 중 기간을 바꾸면 같은 티커를 새 기간으로 다시 조회. 기간 버튼의 `setLookup(null)` 제거. 표 행을 누르면 조회 상태(`lookupSeq` 증가 포함)를 정리.
- `// eslint-disable-next-line react-hooks/exhaustive-deps` 1곳 — `CountryEtfTab.tsx`·`UsPortfolioTab.tsx` 와 같은 관례.

## 3. 검증 완료
- `npx tsc --noEmit` 통과, `npm run build` 통과 (수정 전·후 모두)
- `python3 -m py_compile 10_공통/acwi_px.py` 통과
- `acwi_px.fetch_closes`: `BHP.AX` 최신 일자 2026-10-23(현지 날짜, 수정 전 방식이면 10-22), `005930.KS`·`AAPL` 정상
- `build_payload([])` → `RuntimeError: ACWI universe is empty` 확인. 현재 유니버스 2,247종목, 저장 대상 661종목
- 로컬 dev(`webapp-etfflow`, :3017) `?tab=quant`
  - `/api/acwi-tech?country=호주` 15행 모두 스냅샷, `ticker=bhp.ax` 조회 + facts 정상
  - "일본" → 30ms 뒤 "영국" 클릭 → 표·활성 칩 모두 영국 유지
  - `BHP.AX` 조회 후 "6개월" 클릭 → `ticker=BHP.AX&range=6mo` 재요청, BHP 차트 유지
  - 콘솔 오류 0
- 참고: dev 화면에 숨은 "기술적분석" 사본(`<div hidden id="S:0">`)이 보이는데 React 스트리밍 SSR 잔여물이라 요청을 보내지 않음. 문제 아님.

## 4. 검증하지 못한 것 / 주의
- **Render 배포 후 06:30 작업 실제 실행.** 로컬엔 R2 가 없어 저장본 경로(`source: "Yahoo Finance · 06:30 KST 갱신"`)는 브라우저로 확인 못 함. 배포 다음 날 `/healthz`(또는 스케줄러 상태)의 `last_acwi_px_as_of`·`last_acwi_px_error` 와 로그 `Scheduled acwi_px: ... ok=<약 2200> series=<약 660>` 확인.
- 유니버스 JSON 을 다시 만들면(`python 10_공통/acwi_px.py --write-universe`) 같은 파일이 이미지에 들어가므로 Render 재배포가 필요.
- `/api/quant`(ETF 기술적분석) 의 Yahoo 날짜 처리도 같은 UTC 방식일 수 있음 — 이번 범위 밖, 미확인·미수정.
- ETF Flow 미커밋 변경은 `_enabled()` 기본값이 `"true"` 로 바뀌어 env 없이도 켜짐. `render.yaml` 도 `true`. 매일 03:40 ETF CHECK 를 20~30분 순차 호출. 사용자 의도라고 보고 커밋 B 로 둠.

## 5. 커밋 방법

```bash
cd /Users/wooyeol/GitHub/SavvyETF
git status --short   # 아래 파일 외에 바뀐 게 없는지 확인

# 커밋 A — Claude 검토 수정
git add Dockerfile "10_공통/acwi_px.py" \
  webapp/src/app/api/acwi-tech/route.ts webapp/src/components/AcwiTechPanel.tsx \
  "Claude_DB/docs/13_Cursor_인수인계_ACWI기술적분석_검토수정.md"
git commit -m "fix(acwi): ship the universe to the bot image and keep the technicals desk on the latest request"

# 커밋 B — 오늘 Cursor 작업 중 남은 ETF Flow 매일 실행
git add .env.example "01_봇/bot.py" 03_ETF/etf_flow_weekly_scheduler.py render.yaml
git commit -m "feat(etf-flow): refresh the flow sheet every day at 03:40 KST"

cd webapp && npm run build
```

커밋하면 안 되는 것 / 이번 범위 밖: `.next/`, 루트 `package-lock.json`, `00_exports/`, `11_받은자료/`, `research/*`, `.claude/`, `.github/workflows/python-check.yml`, `Claude_DB/docs/08_…`(00_exports 표기만 바뀐 1줄), `11_…`·`12_…` 인수인계서 — 각자 원래 작업에서 판단.

## 6. 완료 기준
- Render 재배포 후 다음 06:30 실행 로그에 `ok` 가 2,000 이상, `series` 600 이상
- 기술적분석 탭 상단 출처가 "Yahoo Finance · 06:30 KST 갱신", 기준일 표시
- 국가 칩을 빠르게 바꿔도 마지막 국가 표가 남고, 티커 조회 후 기간 변경 시 조회 종목이 유지됨
