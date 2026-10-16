# 10. Cursor 인수인계 — ETF Flow 주간 정기 업데이트 (2026-10-16)

- 작성: 2026-10-16 (Claude) · 받는 쪽: Cursor
- 요청: `11_받은자료`가 아닌 다운로드 폴더의 `ETF Flow Data 요청_2610.xlsx` (미래에셋자산운용 요청 양식, 시트 `정리` · `Raw Data`)
- 범위
  ① Python 배치 `03_ETF/etf_flow_weekly.py` — 6개 섹션 데이터 수집·집계 → 요청 양식 엑셀(네이티브 차트) + JSON → R2
  ② 웹앱 **ETF › ETF Flow** 탭 — 화면 표 + 「엑셀 다운로드」(요청 양식과 같은 파일)
  ③ 봇 스케줄러(기본 OFF) — 매주 화 07:40 KST 자동 갱신
- **Claude 는 작업 트리에 파일만 썼고 git(add·commit·push)·R2 업로드·Render 환경변수 변경은 하지 않았습니다.** 기준 커밋 `c83c44f` (main)
- 첫 결과물: `00_exports/etf_flow_weekly/ETF Flow Data_261016.xlsx` (+ 같은 날짜 `.json`)

---

## 0. 시작 전

1. `git status` 로 §1 목록 확인. `.next/` · `00_exports/` · 루트 `package-lock.json` · `11_받은자료/` · `research/ai_report/` · `research/rebalance_whitepaper/` · `Claude_DB/docs/08_…md` 수정분은 **이번 작업과 무관** — 건드리지 않음
2. 파이썬은 `.venv-sf/bin/python` (3.10, `openpyxl 3.1.5`·`requests` 있음). 기본 `python3`(3.8)은 `zoneinfo` 가 없어 스케줄러 import 실패
3. **ETF CHECK 차단 주의**: 병렬·연속 호출하면 IP 가 수십 분 막힌다(TCP SYN 무응답, `curl https://www.etfcheck.co.kr/` 가 000). 2026-10-16 에 8스레드로 돌리다 실제로 막혔고 ~10분 뒤 풀림. 그래서 배치는 단일 세션 **1초 간격 순차** 호출 + 날짜별 캐시(`00_exports/etf_flow_weekly/cache/`) 로 재실행 시 이어받는다. 수정할 때 병렬화하지 말 것

## 1. 바뀐 파일

### Python — 커밋 대상
| 파일 | 상태 | 내용 |
|---|---|---|
| `03_ETF/etf_flow_weekly.py` | **신규** | 수집·집계. 미국(ETF CHECK) 자산군·테마·Top10, 국내(네이버) 투자자별·개인 Top20, 차주 이벤트(TradingView·Nasdaq). `publish_weekly(publish=True)` 가 json·xlsx 저장 후 R2 업로드. CLI `--publish` |
| `03_ETF/etf_flow_weekly_excel.py` | **신규** | 요청 양식 엑셀 작성(openpyxl). 섹션 제목·K열 비고·순서는 양식 그대로, Top10/20 은 행 확장. 섹션별 네이티브 차트(셀 참조, ChartFormat 색 425288·B2B2B2·CC9900) |
| `03_ETF/etf_flow_weekly_scheduler.py` | **신규** | 주간 스케줄러. `ETF_FLOW_WEEKLY_SCHEDULE_ENABLED`(기본 false), `ETF_FLOW_WEEKLY_SCHEDULE_KST`(기본 `1 7:40` = 화 07:40). heavy_work 락은 잡지 않음(20~30분 네트워크 대기) |
| `01_봇/bot.py` | 수정 | import 1줄 + `start_all_schedulers` 에서 `start_etf_flow_weekly_scheduler()` 1줄 |
| `.env.example` · `render.yaml` | 수정 | 위 환경변수 2개 문서화 (render.yaml 은 `"false"` 로 추가 — 켜는 건 사람이 결정) |
| `Claude_DB/docs/10_…md` | **신규** | 이 문서 |

### 웹앱 (`webapp/src/`) — 커밋 대상
| 파일 | 상태 | 내용 |
|---|---|---|
| `lib/etfFlowWeekly.ts` | **신규** | 타입 + R2 로더(`etf_flow_weekly/latest.json`·`latest.xlsx`). **R2 미설정 + 비운영(NODE_ENV≠production)** 일 때만 `../00_exports/etf_flow_weekly/` 최신 파일을 읽는 로컬 미리보기 폴백 |
| `app/api/etf-flow-weekly/route.ts` | **신규** | JSON (`withServerCache` 5분, `cdnCacheHeader("etfSlow")`) |
| `app/api/etf-flow-weekly/excel/route.ts` | **신규** | R2 의 xlsx 를 그대로 다운로드 (`filename*=UTF-8''ETF Flow Data_YYMMDD.xlsx`) |
| `components/EtfFlowWeeklyTab.tsx` | **신규** | 6개 섹션 표 + 0 기준 막대 + 「엑셀 다운로드」·「새로고침」 |
| `components/lazyTabs.tsx` · `components/Dashboard.tsx` | 수정 | `EtfFlowWeeklyTab` dynamic import, `tab === "etfflow"` 분기 |
| `lib/types.ts` | 수정 | ShellTabId·SHELL_TAB_IDS·라벨 `etfflow: "ETF Flow"`, NAV `etf` 그룹 tabs 에 `"etf"` 다음으로 추가, 딥링크 `?tab=etf-flow|flow|etf_flow` |
| `app/globals.css` | 수정 | 파일 끝 `.etfflow-*` 블록 |

### 커밋 금지
`00_exports/**` (결과물·캐시 — 사용자 규칙상 결과물 폴더), `.claude/launch.json` (로컬 미리보기용 `webapp-etfflow` 설정을 Claude 가 추가함).

## 2. 데이터 정의 (요청 양식 ↔ 구현)

주(週) = **미국 최근 5거래일(이번주) / 그 직전 5거래일(지난주)**, 국내는 **미국 이번주와 같은 날짜 구간**의 국내 거래일 합(휴장 있으면 4일 등). 날짜 범위는 엑셀 C2·각 섹션 비고·웹 부제에 표기. ETF CHECK 미국 순유입은 약 2일 늦으므로(금 15시 KST 최신 = 수요일분) 화요일 아침 실행 시 직전 월~금과 일치.

| 섹션 | 소스 | 정의 |
|---|---|---|
| 1. 자산군별 주간 순유입 ($B) | ETF CHECK `getGlobalEtfInflowTermHist`(일별 NETRPAMT, Morningstar) | 자산군 = ETF CHECK 대분류 우선순위 **가상자산 > 원자재 > 채권·단기자금(T-bill) > 주식·리츠**. 전체 = 미국 상장 ETF 전체(멀티에셋·통화·변동성 포함, 약 5,700개) |
| 2. 테마별 4주 ($B) | 〃 + `getGlobalEtfListByCtg` 소분류 | **정방향(레버리지·인버스 제외)** ETF 중: S&P500=`0501007` · 美국채 중장기=국공채∩미국−(단기·초단기·물가채·단기자금) · IG회사채=회사채−하이일드−CLO · 금=금선물·금현물 · 美배당주=고배당∩미국−커버드콜−채권 · 에너지=섹터 에너지 · 디지털자산=가상자산 전체 · 하이일드=고수익채권 · 중국 주식=중국∩주식 · 반도체=글로벌·K-반도체. 규칙은 `_theme_rules()` |
| 3. Top 10 유입/유출 | 〃 + `getGlobalEtfRankListMarketCap`(AUM) + 네이버 ETF 목록 | 주간순유입 정렬(레버리지 포함 전체), AUM대비 = 주간순유입/최근 AUM, 4주 누적 = 최근 20거래일. **국내 유사 ETF** = `KR_SIMILAR`(티커→국내명 키워드) → 테마 폴백, **TIGER 우선** 후 순자산 큰 순, 레버리지·인버스·(H)·채권혼합 제외 |
| 4. 투자자별 수급 (억원) | 네이버 `m.stock.naver.com/api/stock/{code}/trend` | 일별 개인·기관·외국인 **순매수 수량 × 종가** 합(추정 금액 — KRX 금액 통계는 로그인 필요). 대상 = 네이버 탭 해외주식(4)·원자재(5) 전체 + 채권(6)/기타(7) 중 해외 키워드. 커버드콜·프리미엄·인컴·옵션·버퍼 → `커버드콜&인컴`, `혼합` 제외 |
| 5. 개인 Top 20 | 〃 | 위 대상 중 개인 순매수 상·하위 20 |
| 6. 차주 이벤트 | TradingView `economic-calendar.tradingview.com/events`(importance≥1, 미·중·한·유로) + Nasdaq `api.nasdaq.com/api/calendar/earnings` | 같은 날 같은 국가 지표는 1줄로 묶어 최대 4줄 + 시총 상위 10개 실적을 날짜별 1줄. 원자료는 Raw Data 시트 오른쪽 |

**미국 일별 이력이 왜 필요한가**: ETF CHECK 일괄 랭킹은 최근 1일·1주·1개월·3개월 **누적값만** 준다. 이번주는 1주 값(=최근 5거래일 합, 이력으로 검증 `W=5d`)으로 전 ETF 정확하지만, **지난주·테마 4주 시계열**은 주별로 쪼개야 해서 ETF별 일별 이력이 필요하다.
**수집 범위**: `|3M|+|M|` 순유입 큰 순 **최대 300개**(`HIST_MAX`, 1초 간격 ≈ 6분) + 주간 상·하위 30개. 나머지 소형 ETF 는 `(1개월−1주)` 를 남은 주 수로 균등 배분(Raw Data `주간값 산출` = `구간추정`) — 그래서 소형 ETF 위주 테마(예: 중국 주식)는 과거 3주 값이 같게 나올 수 있다. 정밀도를 올리려면 `HIST_MAX` 를 늘리되(1,200 ≈ 25분) 병렬화는 금지. `--cached-only` 는 당일 캐시만 쓰고 추가 호출 없이 재집계.

## 3. 검토

```bash
.venv-sf/bin/python -m py_compile 03_ETF/etf_flow_weekly.py 03_ETF/etf_flow_weekly_excel.py 03_ETF/etf_flow_weekly_scheduler.py
.venv-sf/bin/python 03_ETF/etf_flow_weekly.py            # 로컬 생성만 (~8분, 같은 날 재실행은 캐시로 ~1분)
.venv-sf/bin/python 03_ETF/etf_flow_weekly.py --cached-only   # 당일 캐시로 재집계만
.venv-sf/bin/python 03_ETF/etf_flow_weekly.py --publish  # + R2 (루트 .env 에 R2_* 필요)
cd webapp && npx tsc --noEmit -p .                        # 통과 확인함
```

로컬 화면: `cd webapp && npx next dev -p 3017` → `http://localhost:3017/?tab=etf-flow` (R2 미설정이면 00_exports 최신 파일로 표시, 엑셀 다운로드도 동작).

재현 기준값 (2026-10-16 실행, 이력 300개 · 추정 5,403개, ETF CHECK 기준일 10/14)
| 항목 | 값 |
|---|---|
| 미국 이번주 / 지난주 | 10/08~10/14 / 10/01~10/07 |
| 자산군 이번주 ($B) | 전체 +52.37 · 주식 +34.55 · 채권 +18.84 · 원자재 −0.86 · 디지털 −0.66 |
| 유입 1위 / 유출 1위 | SPYM +5.65 / ARKK −2.62 |
| 국내 기간 · 대상 | 10/08~10/14 (4거래일, 10/9 한글날) · 해외 ETF 454개 |
| 해외주식 개인/기관/외국인 (억원) | +1,593 / −1,984 / +522 |
| 웹 | `/api/etf-flow-weekly` 200, `/excel` 200 (524KB) — 로컬 3017 에서 확인 |

## 4. 배포 순서 (사람 결정 필요)

1. 커밋·PR (Python + webapp 함께). Vercel 은 R2 만 읽으므로 추가 env 없음
2. 첫 데이터 올리기: R2 키가 있는 곳(Render 셸 또는 루트 `.env` 를 채운 로컬)에서 `--publish` 1회. 올리기 전 탭은 "주간 Flow 스냅샷이 아직 없습니다" 로 표시됨(정상)
3. 정기화: Render 환경변수 `ETF_FLOW_WEEKLY_SCHEDULE_ENABLED=true` (시각 바꾸려면 `ETF_FLOW_WEEKLY_SCHEDULE_KST="0 7:40"`). Render IP 에서 ETF CHECK 가 막히면 로그에 `연속 실패 — 이력 수집 중단` 이 찍히고 받은 만큼으로 계속 진행
4. 탭 공개 범위: 지금은 공개 탭. 관리자 전용으로 하려면 `ADMIN_ONLY_TABS` 에 `"etfflow"` 추가

## 5. 알려진 한계

- 국내 금액은 수량×종가 추정(장중 체결가 차이). 기관 = 네이버 '기관' 합계
- 미 국채 중장기 테마는 이름에 Muni/Tax-Exempt 가 있는 지방채 제외, 주식 테마(S&P500·배당·에너지·중국·반도체)는 자산군 '주식'만
- VOO 4주 −45B / IVV 4주 +50B 처럼 원천(ETF CHECK·Morningstar) 값 자체가 큰 경우가 있음 — 가공 없이 그대로 표기
- FTXR 처럼 AUM 이 아주 작은 ETF 는 AUM대비 % 가 극단값(−500%)으로 나올 수 있음
- 원자재 그룹에 KRX 금현물 ETF 포함(국내 상장 금 가격이지만 해외 원자재 노출로 분류)
- `etf_us_new_scheduler.py` 의 `due_slot_id(now_kst=…, last_slot_id=…, catchup_minutes=…)` 호출은 실제 시그니처(`now, hour, minute, *, last_slot, window_minutes`)와 다름 — 기본 OFF 라 드러나지 않은 기존 버그(이번 범위 밖, 수정 안 함)
