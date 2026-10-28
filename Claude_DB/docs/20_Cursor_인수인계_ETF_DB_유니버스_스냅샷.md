# 20. Cursor 인수인계 — ETF·DB 탭을 상장 시장별 유니버스 스냅샷으로 교체 (2026-10-28)

- 작성: 2026-10-28 (Claude) · 받는 쪽: Cursor
- 대상 저장소: `/Users/wooyeol/GitHub/SavvyETF` (origin `parkwooyeol9/SavvyETF`, 브랜치 `main`)
- 기준 커밋: `7d0e99a`
- **Claude는 git을 쓰지 않았습니다.** 아래 파일은 작업 트리에 추가·수정만 된 상태입니다. 빌드 확인·커밋·푸시는 Cursor 몫입니다.

---

## 1. 무엇을 했나
기존 ETF › DB 탭(`?tab=etfdb` 한국, `?tab=etfdbus` 미국)은 사용자가 탭을 열 때마다 네이버·Yahoo를 크롤링해 집계했다. 그래서 무겁고 자주 열리지 않았다. 이를 **SavvyDB Refinitiv 마스터 파일로 미리 만든 정적 스냅샷**으로 바꿨다.

- 대상: 한국·미국·유럽(UCITS)·일본·홍콩·중국 6개 상장 시장, 8,608종
- 분류(시장 공통): 자산군 · 투자지역 · 업종(GICS) · 전략/테마 · 운용사 · 레버리지 · 운용방식(패시브/액티브). 한국은 국내/해외, 유럽은 설정국·거래소가 추가됨
- 화면 동작: 시장 버튼 → 범위 프리셋(전체 / 패시브(일반형) / 해외 패시브(한국만) / 액티브) → 분류 탭 → 왼쪽 카테고리 목록(종수·비중·순자산 막대) → 오른쪽 표(검색, 정렬: 순자산·1Y·3M·총보수·이름, 200행부터 300행씩 더 보기)
- **예전 실시간 화면도 남겨 두었다.** 한국·미국에서 "실시간 수급 보기" 버튼을 누를 때만 예전 `EtfDbTab`/`EtfDbUsTab`을 동적 import한다. 기본 진입 시에는 크롤링 API를 호출하지 않는다.

| 시장 | 종수 | 순자산 | 원본 시트 |
|---|---|---|---|
| 한국 | 1,088 | 408.7조원 | `ETF_Master_한국(QT).xlsx` › `Update_260813` |
| 미국 | 4,335 | $16.38T | `ETF_Master_미국.xlsx` › `ETF_Master` |
| 유럽 | 1,613 | $2.34T | `ETF_Master_유럽 (상장 거래소 기준).xlsx` › 아일랜드 + 룩셈부르그 |
| 일본 | 421 | $877.3B | `ETF_Master_일본.xlsx` › `ETF_Master_일본` |
| 홍콩 | 221 | $81.8B | `ETF_Master_홍콩_중국.xlsx` › `ETF_Master_홍콩` |
| 중국 | 930 | $582.8B | `ETF_Master_홍콩_중국.xlsx` › `ETF_Master_중국` |

제외한 행: 미국 BDC·SPAC 등 Refinitiv 펀드유형이 없는 971건, 상장폐지 RIC(`^`) 317건, OTC(`.PK`) 50건, 시가총액 없음 24건. 유럽은 아일랜드·룩셈부르크 시트에 같은 상품이 한 번 더 있어(MWRD, 순자산 $17.1B) 티커·이름·순자산이 같으면 한 건만 남긴다.

Cursor 검토(커밋 전): 본문 종수 9,009는 위 표 합계와 달랐다. 표 합계 8,609에서 유럽 중복 1건을 빼 8,608이다. 일본 순자산은 스냅샷 기준 $877.3B이다.

### 기존 DB 탭에서 가져온 것
- 한국 GICS 키워드 규칙: `webapp/src/lib/etfDb.ts`의 `GICS_SECTOR_RULES`
- 영문 테마 규칙: `webapp/src/lib/etfDbUsClassify.ts`의 `RULES`·`LEVERAGED`

두 규칙을 파이썬(`GICS_RULES`·`LEV_RE` 등)으로 옮겨 쓰고, Refinitiv 분류가 비어 있을 때 보조로만 쓴다. 화면은 기존 `.etfdb-*` 레이아웃(카테고리 레일 + 표)을 그대로 재사용했다.

## 2. 커밋 대상 파일
| 파일 | 변경 |
|---|---|
| `03_ETF/etf_universe.py` | **신규.** SavvyDB 마스터 → 시장별 엑셀(`00_exports/etf_universe/`, gitignore) + 웹 JSON |
| `webapp/src/data/etfUniverse/{kr,us,eu,jp,hk,cn,index}.json` | **신규.** 열 단위 스냅샷, 합계 2.0MB(gzip 약 0.5MB). `public/`이 아니라 번들에 넣음(아래 4-3) |
| `webapp/src/lib/etfUniverse.ts` | **신규.** 타입·디코딩·그룹 집계·포맷터 |
| `webapp/src/app/api/etf-universe/route.ts` | **신규.** `?market=` → 해당 시장 JSON, 시장 없이 호출하면 index. 시장별 동적 import |
| `webapp/src/components/EtfUniverseTab.tsx` | **신규.** 탭 UI. 예전 화면은 버튼을 누를 때만 `next/dynamic`으로 불러옴 |
| `webapp/src/components/Dashboard.tsx` | `etfdb` → `<EtfUniverseTab />`, `etfdbus` → `<EtfUniverseTab initialMarket="us" />`. `EtfDbTab`·`EtfDbUsTab` import 제거 |
| `webapp/src/components/lazyTabs.tsx` | `EtfDbTab`·`EtfDbUsTab` export → `EtfUniverseTab` |
| `webapp/src/lib/types.ts` | 라벨 `etfdb: "상장 시장별 ETF"`. DB 하위 메뉴에서 `etfdbus` 제거(탭 ID는 유효하게 남겨 `?tab=etfdbus`는 미국 시장으로 열림) |
| `webapp/src/lib/apiCache.ts` | 캐시 등급 `snapshot` 추가(s-maxage 1h, swr 24h) |
| `webapp/src/middleware.ts` | `HEAVY_PATHS`에 `/api/etf-universe` 60회/분 추가 |
| `webapp/src/app/globals.css` | `.etfu-*` 스타일 추가(시장 버튼, 4칸 통계, 태그, 주석, 900px 이하 반응형) |
| `Claude_DB/docs/20_Cursor_인수인계_ETF_DB_유니버스_스냅샷.md` | 이 문서 |

**건드리지 않은 것:** `/api/etf-db`, `/api/etf-db-us`, `EtfDbTab.tsx`, `EtfDbUsTab.tsx`, `lib/etfDb*.ts`, `cron/warm-cache`, `dataCatalog.ts`.
`/api/etf-db-us`는 자금흐름(`lib/moneyFlowEtf.ts`)과 warm-cache 크론이 계속 쓰므로 지우면 안 된다.

## 3. 검증한 것
- `webapp`에서 `npx tsc --noEmit -p .` → 오류 0
- `next dev`(포트 3017)의 `?tab=etfdb`에서 확인한 것:
  - 6개 시장 전환이 동작하고, 시장 버튼에 종수·순자산이 표시됨
  - 미국 › 투자지역: 미국 3,144종(80.3%), 글로벌(미국 제외) 269종 등
  - 검색 `taiwan` → EWT·FLTW 2종
  - 한국 › 해외 패시브 = 357종 · 121.2조. 앞서 따로 전달한 엑셀(`국내상장_해외패시브ETF_20261028.xlsx`)과 같은 값
  - `?tab=etfdbus` 딥링크가 미국 시장으로 열림
  - 375px 폭에서 가로 넘침 0
  - 콘솔 오류 없음
  - "한국 실시간 수급 보기"를 누르면 예전 한국 화면이 표 400행으로 정상 렌더
- API 게이트:
  - Origin·Sec-Fetch-Site 없이 요청 → 403
  - `Sec-Fetch-Site: same-origin` → 200
  - `market=xx` → 400

## 4. 검증하지 못한 것 / 확인 요청
1. **`npm run build`와 lint는 실행하지 않았다.** JSON 7개를 동적 import하므로 빌드 출력에 시장별 청크가 생기는지, 서버리스 함수 크기 경고가 없는지 확인해 줄 것.
2. **Vercel 배포 후 첫 응답 속도.** `us.json`(1.0MB)을 import하는 콜드 스타트 시간을 확인. CDN 캐시(`snapshot` 등급)가 적용되면 이후 요청은 캐시에서 나간다.
3. **데이터 공개 범위.** Refinitiv 원천 데이터라서 `public/`에 두지 않았다. 직전 커밋 a5a33bf의 같은 출처 게이트·봇 차단이 그대로 적용된다. 화면을 볼 수 있는 사람이면 표의 내용은 볼 수 있다.
4. **미국 액티브 과소 집계.** 운용방식은 사용자 규칙(종목명에 'Active'/'액티브'가 있으면 액티브)을 따랐다. 미국은 이 규칙으로 126종만 액티브로 잡힌다. Dimensional·Avantis 등은 이름에 'Active'가 없어 패시브로 분류된다. 화면의 '기준·분류 방법'과 엑셀 주석에 적어 두었다.
5. **기준 시각.** 한국은 시트의 Last Update 값, 나머지는 원본 파일 저장 시각을 기준으로 했다. Refinitiv 시트에는 기준일 셀이 없다.

## 5. 커밋·배포 방법

```bash
cd /Users/wooyeol/GitHub/SavvyETF/webapp
npx tsc --noEmit -p .
npm run build
npm run dev            # http://localhost:3000/?tab=etfdb 에서 3절 항목 확인

cd /Users/wooyeol/GitHub/SavvyETF
git add 03_ETF/etf_universe.py \
        webapp/src/data/etfUniverse \
        webapp/src/lib/etfUniverse.ts \
        webapp/src/app/api/etf-universe/route.ts \
        webapp/src/components/EtfUniverseTab.tsx \
        webapp/src/components/Dashboard.tsx \
        webapp/src/components/lazyTabs.tsx \
        webapp/src/lib/types.ts \
        webapp/src/lib/apiCache.ts \
        webapp/src/middleware.ts \
        webapp/src/app/globals.css \
        "Claude_DB/docs/20_Cursor_인수인계_ETF_DB_유니버스_스냅샷.md"
git commit -m "feat(etf-db): replace the live-crawl DB tab with per-listing-market ETF universe snapshots from SavvyDB"
git push origin main   # Vercel 자동 배포
```

이번 범위 밖(건드리지 말 것): `Claude_DB/docs/08_…`(수정 상태), `11_…`·`12_…` 인수인계서, `research/*`, `00_exports/`, `11_받은자료/`, `.next/`.

## 6. 배포 후 확인 (완료 기준)
- `https://savvyetf.com/?tab=etfdb`가 크롤링 대기 없이 바로 뜨고, 6개 시장이 모두 열림
- 개발자도구 Network에서 기본 진입 시 `/api/etf-db`·`/api/etf-db-us` 호출이 없고 `/api/etf-universe?market=…`만 있음
- `?tab=etfdbus`로 들어가면 미국 시장이 선택된 상태로 열림
- "실시간 수급 보기"를 누르면 예전 화면이 뜸(이때만 크롤링 API 호출)

## 7. 데이터 갱신 방법
SavvyDB 마스터(Refinitiv)를 새로 고친 뒤 아래를 실행하고, 바뀐 JSON을 커밋한다.

```bash
cd /Users/wooyeol/GitHub/SavvyETF
python3 -I 03_ETF/etf_universe.py                 # 6개 시장 전체 (약 25초)
python3 -I 03_ETF/etf_universe.py --markets kr us # 일부만 (index.json의 나머지 시장 항목은 유지)
git add webapp/src/data/etfUniverse && git commit -m "data(etf-universe): refresh snapshots" && git push
```

- 엑셀은 `00_exports/etf_universe/ETF_Universe_<시장>_<YYYYMMDD>.xlsx`로 함께 생성된다(커밋 대상 아님).
- 한국 시트 이름 `Update_260813`과 각 시트의 열 위치는 `etf_universe.py`의 `load_kr`·`LAY_*`에 고정되어 있다. 원본 시트 이름이나 열 순서가 바뀌면 이 두 곳을 같이 고친다.
