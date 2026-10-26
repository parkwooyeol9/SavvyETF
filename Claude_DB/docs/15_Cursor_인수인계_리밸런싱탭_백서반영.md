# 15. Cursor 인수인계 — ETF 리밸런싱 탭에 리서치 백서 반영 (2026-10-27)

- 작성: 2026-10-27 (Claude) · 받는 쪽: Cursor
- 대상 저장소: `/Users/wooyeol/GitHub/SavvyETF` (브랜치 `main`)
- 기준 커밋: `78f6302`
- **Claude는 git을 쓰지 않았습니다.** 아래 파일은 작업 트리에 수정·추가만 된 상태입니다. 커밋·푸시·배포는 Cursor 몫입니다.

---

## 1. 배경

리밸런싱 탭(`?tab=rebalance`)은 2026-10-13 `Claude_Work/rebalance/build.py` 스냅샷(ETF 23개, 그중 비중 계산 6개)만 보여줬다.
그 뒤 `research/rebalance_whitepaper/` 에서 대량 리서치(운용사 일자별 PDF 2,683개, 유동비율 2,006종목)를 해
`00_exports/rebalance_whitepaper/국내주식형ETF_리밸런싱_백서.*` 를 만들었고, 결과를 `export_webapp.py` 로
`webapp/src/data/rebalanceWhitepaper.json` 에 내보냈다. 이전 세션에서 이 JSON을 API·엑셀까지만 연결해 두었고 화면에는 나오지 않았다.

### 검토 결과 — 기존 탭의 한계와 백서로 메울 수 있는 것
| 기존 탭의 한계 | 백서가 가진 것 | 이번 반영 |
|---|---|---|
| 종목 편출입 미반영(화면 경고 문구) | KOSPI200·KOSDAQ150·K-반도체·고배당 편입/편출 후보 + 종목별 예상 매매 | ✅ 그룹별 예상 표 → 펼치면 후보·매수/매도 상위 |
| ETF 단위, 23개 중 6개만 계산 | 같은 기초지수 ETF를 묶은 **지수 그룹** 국내 15 + 해외형 6 | ✅ |
| 캘린더에 11/30 MSCI, 12/14 K-반도체, 12/15 고배당, 12/18 해외형이 없음 | 그룹별 다음 매매일 | ✅ 캘린더에 점선 칸으로 병합 |
| 12월 같은 주에 겹치는 수요가 안 보임 | 12/10~12/15 종목별 합산 + ADV 대비 충격 | ✅ |
| 과거 결과 = 이벤트 스터디(주가)만 | 2024-05~2026-10 실측 회전율·매수 규모·고충격 종목 | ✅ 그룹별 차트·표 |
| 예상 신뢰도 표시 없음 | 가중(방법론 공개 여부)·교체(근사/미반영) 신뢰도, 모델 수정 내역 | ✅ 칩 + 접는 검증 내역 |
| 첫 로딩 | 백서 JSON 659KB를 `/api/rebalance` 에 통째로 붙이던 상태 | ✅ 별도 정적 라우트로 분리·경량화(gzip 약 93KB) |

## 2. 바뀐 파일 (커밋 대상)

| 파일 | 상태 | 내용 |
|---|---|---|
| `webapp/src/data/rebalanceWhitepaper.json` | 신규 | 백서 결과 (export_webapp.py 출력, 기준 실측 10/14·정밀예상 10/16) |
| `webapp/src/app/api/rebalance/whitepaper/route.ts` | 신규 | `force-static` GET. 과거 이벤트 종목 행을 \|매매\| 상위 30개로 잘라 응답(309KB, gzip 93KB). `Cache-Control: s-maxage=86400` |
| `webapp/src/app/api/rebalance/route.ts` | **변경 없음** | 이전 세션에서 whitepaper 를 붙였던 수정을 되돌려 `78f6302` 와 동일 → `git status` 에 안 나옴 |
| `webapp/src/lib/rebalance.ts` | 수정 | 백서 타입(`RebalanceWhitepaper` 등), `RebalanceWhitepaperResponse`, `WP_FX_DEFAULT=1400` |
| `webapp/src/lib/rebalanceExcel.ts` | 수정 | 엑셀에 백서 시트 5개(11-12월예상요약·12월합산상위·과거실측이벤트·지수방법론·유니버스) + 안내 시트 기준일 |
| `webapp/src/components/RebalanceWhitepaper.tsx` | 신규 | 백서 섹션 컴포넌트. `part="forecast"`(11·12월 그룹 예상 + 12월 합산), `part="history"`(실측 이력·방법론·검증 내역) |
| `webapp/src/components/RebalanceTab.tsx` | 수정 | 백서 lazy fetch, 캘린더 병합(`CalDay`·`dayAum`), 날짜 태그 "백서 n그룹 x억", KPI 보완, 엑셀에 백서 병합 |
| `webapp/src/app/globals.css` | 수정 | `.rb-wp-*` 스타일, `.rb-day.wp`(점선) — `/* KOSDAQ 100 monitor */` 바로 위 |
| `Claude_DB/docs/15_Cursor_인수인계_리밸런싱탭_백서반영.md` | 신규 | 이 문서 |

## 3. 화면 변화 (위→아래)

1. **KPI** — "다음 매매일"이 11/30 MSCI Korea(백서)로 바뀜. "최대 매매일"은 스냅샷 ETF 순자산과 백서 *국내* 그룹 AUM 중 큰 값으로 비교 → 12/10(54조). 해외형 그룹 AUM은 국내 종목 수급이 아니라 비교에서 뺌. "선택일 최대 순매매"는 스냅샷 계산이 없으면 백서 그룹 예상에서 채움(12/10 → LG에너지솔루션 −1,531억).
2. **매매일 캘린더** — 백서에만 있는 날(11/30·12/14·12/15·12/18)을 점선 칸으로 추가, 모든 해당일에 `백서 n그룹 x억` 태그.
3. **(신규) 지수 그룹별 11·12월 정기변경 예상** — 국내/해외/전체 칩. 열: 매매일·그룹·가중 규칙 / 그룹 AUM / 회전율(과거 실측 범위) / 예상 매수(해외는 $M 병기) / 직전 실측 / 편입·편출 수 / 신뢰도. 캘린더 선택일 행 강조. 행 클릭 → 구성 ETF, 방법론 시점, 교체 기준, 편입·편출 후보, 매수·매도 상위 10(비중 전→후, ADV20, 충격%).
4. **(신규) 12월 집중 주간(12/10~12/15) 종목별 합산 수요** — 매수·매도 각 15(백서 기준 충격순), 여러 그룹이 겹치면 "n개 그룹" 태그, 클릭 시 그룹별 내역.
5. 기존: 일자·ETF·종목 매트릭스 / 종목별 예상 순매매 / 정기변경 ETF / ETF별 목표비중 — 그대로. "편출입 미반영" 경고에 백서 표 안내 추가, 계산 ETF가 없는 날은 빈 문구 대신 백서 그룹 예상 요약.
6. **(신규) 과거 정기변경 실측 이력** — 21개 그룹 칩, 방법론 카드(산출기관·주기·시점·가중·구성 ETF·검증 여부), 막대(매수 규모)+선(회전율) 차트(비정기=노랑, 예상=옅게), 이벤트 표 → 클릭 시 종목 상위 8.
7. **(신규) 백서 모델 검증·수정 내역** (접힘) — 그 다음 기존 "과거 정기변경 전후 주가", "가정·출처·규칙".

## 4. 검증 완료
- `cd webapp && npx tsc --noEmit -p .` 통과
- `npm run -s check:imports` → `ok (412 files)`
- 로컬 `next dev -p 3017` 에서 `?tab=rebalance`:
  - `/api/rebalance/whitepaper` 200, 309,555 bytes / `/api/rebalance` 67KB(백서 미포함)
  - 캘린더 16칸(스냅샷 11 + 백서 5), 기본 선택 12/10, 예상 표 국내 11행·전체 17행(+해외 6), 12/10 행 4개 강조
  - 모든 날짜 칩·예상 행·해외 그룹(나스닥100) 이력 클릭 시 런타임 오류 없음
  - 375px 폭에서 신규 섹션 가로 넘침 없음

## 5. 검증하지 못한 것 / 주의
- **`next build`(프로덕션 빌드)는 돌리지 않음** — dev 서버와 `.next` 를 같이 쓰기 때문. 커밋 전 `cd webapp && npm run build` 한 번 확인 부탁.
- **엑셀 다운로드는 실제로 받아보지 않음**(타입체크만). 탭의 엑셀 버튼으로 `백서_*` 시트 5개가 생기는지 확인.
- 백서가 아직 로딩 전이면(또는 `/api/rebalance/whitepaper` 실패 시) 기존 화면만 그대로 나오고 엑셀에도 백서 시트가 빠짐 — 의도된 동작.
- 백서 숫자는 **10/14~10/16 고정 스냅샷**이다. 봇/R2로 자동 갱신되지 않으며, 바꾸려면 아래 §7로 JSON을 다시 만들어 재배포.
- 백서와 기존 스냅샷은 같은 날짜라도 범위가 다름(백서 = 지수 그룹 합산·편출입 포함, 스냅샷 = ETF별·비중 조정만). 화면 문구로 출처를 구분해 두었음.

## 6. 커밋 방법

```bash
cd /Users/wooyeol/GitHub/SavvyETF
git add webapp/src/data/rebalanceWhitepaper.json \
  webapp/src/app/api/rebalance/whitepaper/route.ts \
  webapp/src/lib/rebalance.ts webapp/src/lib/rebalanceExcel.ts \
  webapp/src/components/RebalanceWhitepaper.tsx webapp/src/components/RebalanceTab.tsx \
  webapp/src/app/globals.css \
  "Claude_DB/docs/15_Cursor_인수인계_리밸런싱탭_백서반영.md"
git commit -m "feat(rebalance): surface the whitepaper's index-group forecasts, Dec overlap and PDF-measured history"
```

`globals.css` 에 다른 작업 수정분이 섞였는지 `git diff webapp/src/app/globals.css` 로 확인(이번 변경은 `.rb-day.wp` 와 `/* Rebalance — 리서치 백서 섹션 */` 블록뿐).

이번 범위 밖(건드리지 말 것): `.next/`, 루트 `package-lock.json`, `00_exports/`, `11_받은자료/`, `research/*`(백서 코드 90MB 포함), `.claude/`, `Claude_DB/docs/08_…` 수정분, `11_…`·`12_…` 인수인계서.

## 7. 백서 데이터 갱신 (나중에)

```bash
cd /Users/wooyeol/GitHub/SavvyETF
python3 research/rebalance_whitepaper/export_webapp.py   # out/dash_data.json·addendum.json·appendix.json → webapp/src/data/rebalanceWhitepaper.json
```
`research/` 는 커밋 대상이 아니므로 이 명령은 로컬(작성자 PC)에서만 가능. 갱신 후 JSON만 커밋·배포.

## 8. 완료 기준
- 배포 후 `https://savvyetf.com/?tab=rebalance` 에 "리서치 백서 · 지수 그룹 단위" 구분선과 신규 섹션 4개가 보임
- `https://savvyetf.com/api/rebalance/whitepaper` 가 `{"ok":true,...}` 반환, `/api/rebalance` 응답에는 `whitepaper` 키 없음
- 캘린더에 11/30·12/14·12/15·12/18 점선 칸

## 9. 다음 개선 후보 (이번에 안 함)
- **12/10 정기변경 후 사후 검증**: 12/11 운용사 PDF로 실측 → 백서 예상 대비 오차를 탭에 표시(백서 `appendix.compare` 확장).
- **백서 갱신 자동화**: `export_webapp.py` 결과를 R2(`rebalance/whitepaper.json`)로 올리고 라우트가 R2 우선 → 재배포 없이 갱신.
- **"종목으로 찾기"**: 백서 HTML 대시보드에 있는 종목 검색(한 종목의 모든 그룹·이벤트 매매 이력)을 탭으로 이식.
- **이벤트 스터디 표본 확대**: 지금 정기변경 몇 회뿐 → 백서의 2024-05 이후 실측 이벤트 전체로 전후 초과수익 재계산.
