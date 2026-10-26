# 16. Cursor 인수인계 — 리밸런싱 탭 백서 섹션: 고정 스냅샷 표시·지난 예상 처리·ANT 미반영 안내 (2026-10-27)

- 작성: 2026-10-27 (Claude) · 받는 쪽: Cursor
- 대상 저장소: `/Users/wooyeol/GitHub/SavvyETF` (브랜치 `main`)
- 기준 커밋: `8e5cc5e` (15번 인수인계 반영 커밋)
- **Claude는 git을 쓰지 않았습니다.** 아래 파일은 작업 트리에 수정만 된 상태입니다. 커밋·푸시·배포는 Cursor 몫입니다.

---

## 1. 배경 — 15번 반영 후 재검토 결과

| 영역 | 데이터 | 갱신 |
|---|---|---|
| 백서 섹션(그룹별 11·12월 예상, 12월 합산, 실측 이력, 방법론) | 저장소 `webapp/src/data/rebalanceWhitepaper.json` | **고정 스냅샷.** 국내 예상 10/16, 실측·해외 예상 10/14. `export_webapp.py` 재실행 + 재배포로만 바뀜 |
| 기존 ETF별 섹션 | R2 `rebalance/latest.json` | 봇 `09_매매/rebalance_scheduler.py` 가 KRX 거래일 18:10 KST 매일 갱신 (운영 확인: 10/26 18:10 생성) |

> 15번 문서 §1 의 "기존 탭은 10/13 스냅샷" 표현은 부정확했다. 10/13 은 번들 예비 파일(`rebalanceSnapshot.json`) 날짜이고, 운영 화면은 R2 를 쓴다.

재검토에서 나온 문제와 이번 조치:
1. 화면에 백서 영역이 고정이라는 표시가 약함 → **고정 스냅샷 배지 + 경과일 경고문**
2. 매매일이 지나도 예상 행이 계속 '예상'으로 남음 → **'지남 · 실측 대기' 표시**
3. 12/18 나스닥100 예상에 Anthropic(ANT) 조기 편입이 빠져 있음 → **'ANT 미반영' 태그 + 안내문**

## 2. 바뀐 파일 (커밋 대상)

| 파일 | 내용 |
|---|---|
| `webapp/src/components/RebalanceWhitepaper.tsx` | ① `NOT_REFLECTED` 상수(그룹 id → 태그·안내문, 현재 `NDX` 만) ② `daysBetween()` ③ 기본 export 와 `ForecastSection`·`CombinedSection`·`HistorySection` 에 `today` prop 추가 ④ 구분선에 `고정 스냅샷` 칩, 아래 `.rb-wp-stale` 경고문(경과 14일 초과 시 `.old` 로 강조) ⑤ 예상 표: `r.date < today` 이면 행 `.passed`(흐리게) + `지남 · 실측 대기` 태그 + 펼침 상단 경고 ⑥ 나스닥100 행 `ANT 미반영` 태그(툴팁=안내문), 펼침·표 하단 주석·실측 이력(나스닥100 선택 시)에 안내문 ⑦ 12월 합산: 마지막 예상 매매일이 지나면 경고 ⑧ 실측 이력 표의 예상 이벤트가 지나면 `예상 X · 지남, 실측 대기` |
| `webapp/src/components/RebalanceTab.tsx` | `RebalanceWhitepaperSections` 두 곳에 `today={today}` 전달 (KST 오늘, 기존 `kstToday()`) |
| `webapp/src/app/globals.css` | `.rb-wp-row.passed`, `.rb-wp-stale(.old)`, `.rb-wp-divider .rb-chip` — `/* Rebalance — 리서치 백서 섹션 */` 블록 안 `.rb-wp-row` 바로 아래 |
| `Claude_DB/docs/16_Cursor_인수인계_리밸런싱탭_고정스냅샷표시.md` | 이 문서 |

데이터(JSON)·API 라우트는 바꾸지 않았다.

## 3. 검증 완료
- `cd webapp && npx tsc --noEmit -p .` 통과, `npm run -s check:imports` → `ok (412 files)`
- 로컬 `next dev -p 3017`, `?tab=rebalance`:
  - 오늘(10/27): 구분선 `고정 스냅샷` 칩, 경고문 "2026-10-16 기준 … (11일 경과)", 지난 행 0개, 나스닥100 행 `ANT 미반영` 태그와 펼침 안내문, 표 하단 주석 1건, 런타임 오류 없음
  - 브라우저에서 날짜를 **2026-12-12로 가정**(`toLocaleDateString` 재정의 후 탭 재진입): 11/30 MSCI Korea ~ 12/11 그룹 9행이 `지남 · 실측 대기`, 펼치면 "매매일(2026-11-30)이 지났습니다…" 경고, 경고문이 강조형(57일 경과)으로 바뀜, KPI 다음 매매일이 12/14 로 넘어감. 12/15 가 남아 있어 12월 합산 경고는 정상적으로 안 뜸

## 4. 주의
- **로컬 dev 서버와 `next build` 를 같은 `.next` 로 돌리면 dev 가 깨진다.** 8e5cc5e 커밋 전 빌드(08:15) 이후 dev 의 `/api/rebalance` 가 `Cannot find module './1331.js'` 로 500 → dev 서버 재시작으로 해결. 운영과는 무관.
- `NOT_REFLECTED.NDX` 안내문은 **10/27 시점의 보도·추정**(ANT 11/16 첫 거래 가정, 국내 나스닥100 ETF 매수 약 2,900억~5,300억원)이다. ANT 상장일이 확정되거나 12/7 편입이 끝나면 문구를 고치거나, 백서 JSON 재생성 시 상수를 지울 것.
- 경과일은 화면을 연 사람의 KST 날짜로 계산(서버 캐시와 무관).

## 5. 커밋 방법

```bash
cd /Users/wooyeol/GitHub/SavvyETF
cd webapp && npm run build && cd ..   # 프로덕션 빌드 확인 (로컬 dev 서버는 끄고)
git add webapp/src/components/RebalanceWhitepaper.tsx webapp/src/components/RebalanceTab.tsx \
  webapp/src/app/globals.css \
  "Claude_DB/docs/16_Cursor_인수인계_리밸런싱탭_고정스냅샷표시.md"
git commit -m "fix(rebalance): flag the whitepaper block as a fixed snapshot, mark passed forecasts and the missing ANT entry"
```

이번 범위 밖(건드리지 말 것): `.next/`, 루트 `package-lock.json`, `00_exports/`, `11_받은자료/`, `research/*`, `.claude/`, `Claude_DB/docs/08_…` 수정분, `11_…`·`12_…` 인수인계서.

## 6. 완료 기준
- 배포 후 `https://savvyetf.com/?tab=rebalance` 의 "리서치 백서 · 지수 그룹 단위" 옆에 `고정 스냅샷` 칩과 경과일 경고문
- 예상 표 `전체` 에서 12/18 나스닥100 행에 `ANT 미반영` 태그
- 11/30 이후 접속 시 MSCI Korea 행이 흐려지고 `지남 · 실측 대기`

## 7. 근본 해결 (다음 작업 후보, 이번에 안 함)
- 백서 JSON 을 봇/R2(`rebalance/whitepaper.json`)로 올리고 `/api/rebalance/whitepaper` 가 R2 우선·번들 대체로 읽게 바꾸기 → 재배포 없이 갱신
- 매매일이 지난 그룹은 운용사 PDF 실측으로 자동 교체(예상 대비 오차 표시) — 백서 `sources.py`·`detect.py` 를 봇 작업으로 옮겨야 함
