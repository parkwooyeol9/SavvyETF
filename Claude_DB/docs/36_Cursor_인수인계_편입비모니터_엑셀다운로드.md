# 36. Cursor 인수인계 — 편입비 모니터: 선택 ETF 엑셀 다운로드

- 작성: 2026-11-05 (Claude)
- 기준 커밋: `ea1e09a` (브랜치 `feat/krx-option-board` 작업트리)
- **선행: 35번 문서**(운용사 공식 소스 전환)와 같은 파일 `EtfWeightMonitorTab.tsx`를 고친다 → 35 → 36 순서로 같은 커밋 또는 연속 커밋.
- 탭: ETF → 편입비 → 편입비 모니터 (`?tab=etfweights`)

## 무엇을 하나

편입비 모니터에서 ETF를 고르면 패널 오른쪽 위 `새로고침` 옆에 **`{티커} 엑셀`** 버튼이 생긴다.
누르면 **지금 화면에 보이는 ETF·기준일·비교일 그대로** `.xlsx`를 만든다. 차트는 셀 범위를 참조하는 Excel 네이티브 차트다.
웹 표는 상위 50종만 보이지만 엑셀에는 **해당 일자의 전체 보유 목록**이 들어간다.

파일명: `SavvyETF_편입비_{TICKER}_{YYYYMMDD 보유기준일}.xlsx`

## 시트 구성

| 시트 | 언제 | 내용 |
|---|---|---|
| 요약 | 항상 | ETF명·티커·운용사, 보유 기준일과 **기준일 의미**(운용사 공식 / etfcheck 가격일), 공시 주기(일간/월말), 커버리지(전체/Top10만), 비교 기준일, AUM, 종목 수, 비중 합계, 상위10 합계, 누적 스냅샷 기간, 원천·URL·메모, 수집/다운로드 시각, 시트 안내, notes |
| 보유종목 | 항상 | 순위·티커·종목명·섹터·자산구분·비중(%)·비교일 비중·변화(%p)·보유주식수·비교일 주식수·주식수 변화·평가액(USD)·CUSIP/ISIN. 자동필터. **상위 15 막대 차트**(O열부터) |
| 변동 | 비교일 스냅샷이 있을 때 | 신규 편입 / 편출 / 비중 증가 상위10 / 비중 감소 상위10 (비교일 비중·당일 비중·변화·주식수 변화) |
| 비중시계열 | history가 있을 때 | 날짜 × 주요 종목(최대 12) 비중. 2일 이상이면 **선 차트** |
| 경제노출 | 레그가 2개 이상인 그룹이 있을 때 (DRAM 현물+TRS) | 그룹·비중·비교일 비중·변화·구성 레그. 일반 ETF는 단일 레그라 보유종목과 중복이라 생략 |

- 비중 단위는 % 값 그대로(5.02 = 5.02%). 서식: 비중 `0.00`, 변화 `+0.00;-0.00`, 주식수 `#,##0`.
- "비교일" = 화면의 "전일 대비"와 같은 스냅샷(`history.dates`에서 선택일 바로 앞날). 화면과 같은 키(`ticker || cusip || name`, 대문자)로 매칭.
- 비교일에 없던 종목은 비교일 비중 0 → 변동 시트 "신규 편입". 반대는 "편출".

## 바뀐 파일

| 파일 | 내용 |
|---|---|
| `webapp/src/lib/etfWeightsExcel.ts` (신규) | `buildEtfWeightsSheets(input)` 순수 함수(시트 배열 생성, 테스트 용이) · `downloadEtfWeightsExcel(input)` (xlsx 동적 import → `buildXlsxWithCharts` → `downloadXlsx`) · `etfWeightsFilename()` · `holdingKey()` |
| `webapp/src/components/EtfWeightMonitorTab.tsx` | `ExcelButton` + `downloadEtfWeightsExcel` import. panel-head 버튼 영역을 `<div>`로 묶고 `{티커} 엑셀` 버튼 추가 — 입력: `latest: data`, `view: daySnap ?? data`, `prev: prevSnap`, `activeDate` |

재사용: `src/lib/xlsxCharts.ts`(Index Monitor와 같은 SheetJS + DrawingML 차트 주입), `src/components/ExcelButton.tsx`(만드는 중…/실패 표시).
서버·API·Python 변경 없음. 새 의존성 없음(`xlsx`는 이미 package.json에 있음).

## 검증 (Claude가 한 것)

1. `npx tsc --noEmit -p .` — 두 파일 오류 없음.
2. 로컬 스냅샷 5종(DGRO·HDV·VFLO·VYM·XLK)으로 `buildEtfWeightsSheets` → xlsx 생성, openpyxl로 셀 확인, LibreOffice PDF 렌더로 막대·선 차트 표시 확인. 비교일은 가짜 전일 스냅샷으로 변동 시트(신규·편출·증감) 동작 확인.
3. `next dev` + 브라우저: `/api/etf-weights` 응답을 페이지 안에서만 XLK 로컬 스냅샷으로 대체(임시, 코드 변경 아님) → 버튼 노출, 클릭 시 `SavvyETF_편입비_XLK_20261103.xlsx` 생성, 콘솔 오류 없음.
   (dev에서는 첫 클릭 시 xlsx 청크 컴파일로 ~10초 걸림 — 프로덕션 빌드에선 즉시.)
4. 샘플 결과물: `00_exports/etf_weights_excel/SavvyETF_편입비_{DGRO,HDV,VFLO,VYM,XLK}_*.xlsx` (실제 스냅샷, 비교일 없음 → 요약·보유종목·비중시계열 3시트).

로컬엔 R2 키가 없어 실데이터 API로는 못 봤다 → **배포 후 프리뷰에서 아래 완료 기준을 확인**해 줄 것.

## 완료 기준 (배포 프리뷰)

- [ ] `?tab=etfweights`에서 XLK 선택 → `XLK 엑셀` 버튼 → 파일명 `SavvyETF_편입비_XLK_<기준일>.xlsx`
- [ ] 요약 시트 "기준일 의미 = 운용사 공식 파일의 보유 기준일", VYM은 "공시 주기 = 월말 (약 1개월 지연 공시)"
- [ ] 보유종목 행 수 = 화면 "원천 보유 목록 · N종"의 N (웹 표 50행 제한과 무관)
- [ ] 스냅샷이 2일 이상 쌓인 티커(예: Roundhill DRAM)에서 변동 시트와 비중시계열 선 차트 생성, DRAM은 경제노출 시트까지
- [ ] 기준일 드롭다운에서 과거 날짜 선택 후 다운로드 → 파일명·보유종목이 그 날짜 기준
- [ ] Excel(Mac/Win)에서 열 때 복구 경고 없음

## 커밋 범위

커밋할 것: `webapp/src/lib/etfWeightsExcel.ts`, `webapp/src/components/EtfWeightMonitorTab.tsx`, 이 문서 (+ 35번 문서 범위).
**커밋 금지**: `00_exports/**`(샘플), `data/etf_weights/**`, 같은 작업트리의 KRX 옵션보드 변경(`04_국내시장/krx_option_*`, `KrxOptionBoardTab.tsx`, `krxOptionBoard.ts`, `globals.css`, `KrxInvestorFlowSection.tsx`, 34번 문서).

권장 커밋 메시지:

```
feat(etf-weights): download the selected ETF's holdings, changes and history as an Excel workbook
```
