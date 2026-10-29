# 24. Cursor 인수인계 — 미 중간선거 탭: 리포트 양식 수정 · 원자료 엑셀 · 한국(코스피) 영향 (2026-10-29)

- 작성: 2026-10-29 (Claude Code) · 받는 쪽: Cursor
- 대상 저장소: `/Users/wooyeol/GitHub/SavvyETF` (`main`). git 커밋은 하지 않았다.
- 확인: `npx tsc --noEmit` 통과, `scripts/check-import-graph.mjs` 통과. 로컬 dev(3017)에서 `/api/midterm-study`, 두 엑셀 다운로드, 화면을 확인했다. 리포트 엑셀은 운영 payload로 만들어 LibreOffice PDF로 렌더해 확인했다.

## 바뀐 파일

| 파일 | 내용 |
|---|---|
| `webapp/src/lib/xlsxWorkbook.ts` | 병합 셀(`merges`), 인쇄 맞춤(`fitToWidth`), 시작 시트(`activeSheet`), 행 높이 계산 개선 |
| `webapp/src/lib/usMidtermExcel.ts` | 리포트 문단 A:G 병합, 값 B:G 병합, `원자료_*` 시트 7개 + 의석분포 네이티브 차트 |
| `webapp/src/lib/midtermStudy.ts` | `KR_MARKET_SPECS`(코스피), `KR_SECTOR_SPECS`(KRX 업종 20개), `assetSpec()`, payload `kr_markets`/`kr_sectors` |
| `webapp/src/lib/midtermStudyLoad.ts` | 네이버 코스피 일봉, KRX 번들 병합, `loadMidtermStudyBundle()`(엑셀용 원자료 창), 캐시 키 `midterm-study:v4` |
| `webapp/src/lib/midtermStudyExcel.ts` | `KR_Horizons`, `KR_Paths`, `Raw_US`, `Raw_KR` 시트, 코스피 차트 2개, Charts 시트 머리글 병합 |
| `webapp/src/app/api/midterm-study/excel/route.ts` | bundle을 읽어 원자료 전달 |
| `webapp/src/components/MidtermStudyTab.tsx` | 「한국 영향 (코스피 · 코스피 업종)」 패널, 선거 표 코스피 +3m/+1y 열 |
| `webapp/src/data/krSectorMidterm.json` | **신규. 현재는 빈 번들**(`windows: []`). 아래 스크립트가 채운다 |
| `04_국내시장/krx_sector_midterm.py` | **신규.** KRX 업종지수를 중간선거 창별로 받아 위 JSON을 쓴다 |

## 1. 리포트 다운로드 깨짐 (미 중간선거 탭 → `/api/us-midterm/excel`)

원인: 문단·제목·장 제목을 전부 A열(폭 12) 한 칸에 넣고 줄바꿈만 켜 두었다. 셀 병합 기능이 없어서 문장이 폭 12짜리 세로 띠로 접혔고, 행 높이를 A열 폭으로 계산한 뒤 140pt로 잘라서 아래가 잘려 나갔다. 키-값의 값(B열 폭 20)도 같은 이유로 잘렸다.

- `xlsxWorkbook`에 `merges`를 넣고, 병합한 행의 높이는 병합 전체 폭으로 계산한다.
- 한글은 숫자 폭의 약 1.7배로 계산한다. 이전 공식(`폭×1.35`글자)은 한글 줄 수를 크게 적게 잡았다. 상한도 140pt에서 409pt(엑셀 최대)로 올렸다.
- **다른 엑셀(리밸런스·ACWI 등)도 같은 빌더를 쓴다.** 행 높이가 조금 커질 수 있다. 이전에 잘리던 한글 셀이 덜 잘리는 쪽이다.
- 리포트 시트는 A4 세로 한 쪽 폭에 맞춰 인쇄되도록 설정했고, 위 2행 고정은 없앴다.

## 2. 원자료 엑셀

- 리포트: `원자료_의회`·`원자료_권력조합`·`원자료_상원의석분포`(네이티브 막대 차트)·`원자료_경합주`·`원자료_등급보드`·`원자료_ETF`·`원자료_중간선거역사`. 확률은 % 숫자다. 파일을 열면 리서치노트 시트가 먼저 뜬다.
- 스터디: `Raw_US`, `Raw_KR`. 선거마다 −30일~+400일(달력일) 창의 **일별 종가**를 날짜·기준지수 거래일 `t`와 함께 넓은 표로 담는다. French 업종 값은 가격이 아니라 일간 수익률을 누적한 지수다(README에 적었다).
- 원자료는 클라이언트 JSON에 싣지 않는다. 서버 캐시 번들(`loadMidtermStudyBundle().raw`)에만 둔다. 로컬에서 만든 스터디 엑셀은 약 1.9MB였다(Vercel 응답 한도 4.5MB).

## 3. 한국 영향

- 코스피: 네이버 `siseJson`(인증 없음)으로 1990-01-04부터 받는다 → 1990–2022 중간선거 **9회**. 기본 시나리오(1982·2010·2018·2022)의 코스피 n=3이다.
- t=0은 미국과 같은 날짜(선거일 화요일)다. 한국 화요일 장 마감은 개표 전이다.
- 코스피 업종지수 21개(기준 1980-01-04)는 KRX 정보데이터시스템에만 있다. **2025-12-27부터 로그인이 필요하다.** 비로그인 호출은 `LOGOUT`을 돌려준다. 다음 금융의 과거 차트 API는 자동 접근이 막혀 쓰지 않았다. ECOS와 네이버에는 업종지수가 없다.
- 그래서 업종은 정적 번들로 넣는다. 번들이 비어 있으면 화면에 「아직 번들되지 않았다」는 안내가 나오고, 엑셀의 `KR_*` 시트에는 코스피만 들어간다.

### 운영자가 할 일 (1회)

```
# .env (커밋 금지)에 KRX_ID / KRX_PW, 또는 브라우저 로그인 후 Cookie 헤더를 KRX_COOKIE 로
python3 04_국내시장/krx_sector_midterm.py --check   # 로그인 + 1982년 코스피 한 구간 확인
python3 04_국내시장/krx_sector_midterm.py           # webapp/src/data/krSectorMidterm.json 생성
```

- 로그인 POST(`MDCCOMS001D1.cmd`, 응답 `CD001`/`CD011`)는 공개 문서가 없어 추정한 형식이다. 실패하면 `KRX_COOKIE`를 쓰면 된다. 조회 요청(`MDCSTAT00301`, 2년 단위)은 pykrx 1.0.51과 같은 형식이다.
- 실행이 끝나면 업종별 첫 데이터 날짜가 출력된다. **업종이 실제로 몇 년부터 있는지(=몇 사이클을 덮는지)는 이 출력으로 확인해야 한다.** 1980년부터 있으면 1982–2022 11회, 그렇지 않으면 더 적다. 코스피도 번들 값으로 1982·1986이 채워진다(네이버 1990~ 앞부분만 이어 붙인다).
- 생성된 JSON(예상 수백 KB)을 커밋·배포하면 서버가 다음 캐시 갱신(최대 24시간, 재배포 시 즉시) 때 업종 평균을 계산한다.
- 로컬에서 가짜 번들(업종 2개)로 화면·엑셀 경로를 시험했고, 지금은 빈 번들로 되돌려 두었다.

### 추가 (같은 날): KRX Open API 인증키 방식

- 운영자가 `.env`에 `KRX_AUTH_KEY`(openapi.krx.co.kr 인증키)만 넣었다. 스크립트는 `KRX_COOKIE` → `KRX_ID/KRX_PW` → `KRX_AUTH_KEY` 순으로 인증 방식을 고른다.
- 인증키 방식은 「KOSPI 시리즈 일별시세정보」(`idx/kospi_dd_trd`, 헤더 `AUTH_KEY`)를 날짜마다 한 번씩 호출한다. 지수명은 `norm_name`과 별칭으로 KRX 코드에 맞춘다. **2010-01-04 이후만** 주므로 업종은 2010·2014·2018·2022 네 번만 덮는다. 1982–2006까지 받으려면 ID/PW(정보데이터시스템)가 필요하다.
- 2026-10-29 확인: 키는 KRX가 인식한다(키 없이 호출하면 `Unauthorized Key`, 이 키로는 `Unauthorized API Call`). 하지만 지수·주식·ETF API 6종이 모두 401이었다. 포털에서 해당 API **이용신청 승인**이 나야 한다. 승인 뒤 `--check`가 지수명 매핑을 출력한다.

### 추가 2 (같은 날): 업종 번들 생성 · 코스닥 · 3분할

- 운영자가 「KOSPI 시리즈」「KOSDAQ 시리즈」 일별시세정보 API 이용 승인을 받았다. `kospi_dd_trd`는 지수 51개, `kosdaq_dd_trd`는 37개를 돌려준다. 가장 이른 날짜는 2010-01-04다(2009-12-30은 빈 응답).
- API는 업종을 KRX 개편 후 이름으로 준다(음식료·담배, 기계·장비, 일반서비스 등). 스크립트 `INDICES`와 TS `KR_SECTOR_SPECS` 라벨을 새 이름으로 바꾸고, 옛 이름은 `NAME_ALIASES`로 남겼다. `--check` 결과 21개가 모두 매핑됐다.
- `krSectorMidterm.json`을 생성했다(210KB). 선거 창 4개(2010·2014·2018·2022)에 코스피와 업종 20개가 각각 약 310거래일씩 들어 있고, 빈 값은 없다. 2022-11-08 코스피 2399.04는 네이버 종가와 같다.
- **코스닥 추가:** `KR_MARKET_SPECS`에 `kosdaq`을 넣었다. 네이버 1996-07-02~, 2004년 기준 변경이 이미 연결된 시계열이며 1998–2022 중간선거 7회를 덮는다. 코스닥 업종은 넣지 않았다.
- **화면:** 「한국 영향」을 코스피(vs S&P 500), 코스닥(vs 나스닥), 코스피 업종지수 셋으로 나눴다(`KrIndexBlock`). 선거 표에는 코스닥 +3m/+1y 열을 더했다. 업종 막대는 Y축 라벨 20개를 모두 보이게 했다.
- **엑셀:** Charts에 「코스닥 vs 나스닥」 차트를 더해 8개가 됐다. `Raw_KR`에 코스닥 열이 붙는다(로컬 파일 2.1MB).
- **커버 횟수:** 코스피 9회, 코스닥 7회, 업종 4회. 기본 시나리오(여당 하원 패·상원 유지)는 미국 n=4, 코스피·코스닥·업종 n=3이다.

## 남은 것 / 주의

- 업종 코드는 KRX 1005–1026이고, 라벨은 Open API가 주는 개편 후 이름이다. 이름이 또 바뀌면 `INDICES`·`NAME_ALIASES`·`KR_SECTOR_SPECS`를 함께 고쳐야 한다.
- payload에 KR 자산이 들어가 `/api/midterm-study` 응답이 약 0.58MB에서 0.95MB로 커졌다. 업종을 채우면 조금 더 커진다.
