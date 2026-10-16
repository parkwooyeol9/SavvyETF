# 10. Cursor 인수인계 — ETF Flow 주간 정기 업데이트 (2026-10-16)

- 작성: 2026-10-16 (Claude) · 받는 쪽: Cursor
- 요청: `11_받은자료`가 아닌 다운로드 폴더의 `ETF Flow Data 요청_2610.xlsx` (미래에셋자산운용 요청 양식, 시트 `정리` · `Raw Data`)
- 범위
  ① Python 배치 `03_ETF/etf_flow_weekly.py` — 6개 섹션 데이터 수집·집계 → 요청 양식 엑셀(네이티브 차트) + JSON → R2
  ② 웹앱 **ETF › ETF Flow** 탭 — 화면 표 + 「엑셀 다운로드」(요청 양식과 같은 파일)
  ③ 봇 스케줄러(기본 OFF) — 매주 화 07:40 KST 자동 갱신
- **Claude 는 작업 트리에 파일만 썼고 git(add·commit·push)·R2 업로드·Render 환경변수 변경은 하지 않았습니다.** 기준 커밋 `c83c44f` (main)
- 첫 결과물: `00_exports/etf_flow_weekly/ETF Flow Data_261016.xlsx` (+ 같은 날짜 `.json`)
- **개정 2 (2026-10-16 17:10, Claude)**: 1차 배포 시도 실패 원인 진단 + 배포 절차 재작성. §A 를 먼저 읽고, §4 는 새 절차로 대체됨

---

## A. 1차 배포 실패 진단 (2026-10-16 16:10~17:05 KST, Cursor)

### A-1. 🚨 Render 봇 환경변수가 20개만 남고 나머지가 삭제됨 — 최우선 복구

| 시각(KST) | 일 |
|---|---|
| 16:31 | Cursor 가 `GET /v1/services/srv-d96a1qfavr4c73932kng/env-vars` 로 현재 목록을 받고, `ETF_FLOW_WEEKLY_*` 2개를 더해 `PUT …/env-vars` |
| 16:45 | Cursor 가 Render 재배포 트리거 → **`update_failed`** |
| 17:08 | Claude 확인: `?limit=100` 으로 조회해도 **20개뿐**, env group 없음 |

- 원인: Render `GET env-vars` 는 **기본 20개씩 페이지네이션**(각 항목에 `cursor`)하고, `PUT env-vars` 는 **병합이 아니라 전체 교체**다. 첫 페이지 20개만 PUT 하면서 나머지가 지워졌다. (Cursor 스크립트 주석 "Render API merges" 가 틀린 가정)
- 남은 20개: `AI_PULSE_*`(3) · `BOT_ROLE` · `CREDIT_MONITOR_SCHEDULE_KST` · `ESG_DAILY_TG_MAX` · `ESG_EVENTS_TELEGRAM_MAX` · `ETFCHECK_CATCHUP_MINUTES` · `ETFDB_*`(2) · `ETF_FLOW_WEEKLY_*`(2) · `ETF_WEIGHT_CATCHUP_MINUTES` · `KOSDAQ100_*`(2) · `KOSDAQ_ACTIVE_*`(2) · `REDDIT_TELEGRAM_COMPACT` · `SUMMARY_KOR_CATCHUP_MINUTES` · `SUMMARY_US_TELEGRAM_COMPACT`
- **사라진 것(render.yaml 기준, 일부)**: `TELEGRAM_BOT_TOKEN` · `TELEGRAM_CHAT_ID*` · `BOT_WEB_API_SECRET` · `WEB_PUBLISH_URL` · `WEB_INGEST_SECRET` · `R2_*`(5) · `BRIEF_MEDIA_BASE_URL` · `WEBAPP_PUBLIC_URL` · `GEMINI/FRED/FINNHUB/EODHD/DART_API_KEY` · `FINMIND_TOKEN` · `KAKAO_*` · 모든 `*_SCHEDULE_ENABLED`/`*_SCHEDULE_KST`(요약·ESG·ETF 섹터 등) · 메모리·캐시 튜닝(`MALLOC_ARENA_MAX`, `HEAVY_WORK_SERIALIZE` 등). `render.yaml` 의 `value:` 가 적힌 키는 Blueprint sync 로 돌아오지만, **`sync: false` 비밀값은 사람이 다시 넣어야 한다**
- 현재 상태: 봇은 16:06 배포분(옛 환경변수로 기동)이 **아직 살아 있어** `https://savvyetf-bot.onrender.com/` 200. 하지만 **다음 재시작·재배포(main push 포함) 때 비밀값 없이 떠서 텔레그램·R2·브리프 발행이 전부 멈춘다**. 그 전에 복구해야 함
- 로컬에는 사본이 없다: 루트 `.env` 없음, `webapp/.env.local` 은 1개 키뿐. Vercel 에 `R2_*`(5)·`WEB_INGEST_SECRET` 는 있으나 Secret 유형이라 값을 다시 읽을 수 없을 수 있음
- **복구는 사람이 직접**(Render 대시보드 › savvyetf-bot › Environment): 텔레그램 토큰(BotFather), R2 키(Cloudflare — Vercel 과 같은 값), 각 API 키, `WEB_INGEST_SECRET`(Vercel 과 같은 값; 모르면 새로 만들어 Vercel·Render 둘 다 교체). 스케줄 on/off 값은 `render.yaml` 의 `value:` 를 참고
- **재발 방지**: Render env 는 API `PUT` 금지. 한 개만 바꿀 땐 `PUT /env-vars/{key}`(단건) 또는 대시보드. 목록 조회는 `cursor` 로 끝까지 넘길 것

### A-2. 웹 탭이 계속 "스냅샷이 아직 없습니다" 였던 이유

- Cursor 의 Render one-off job(`python3 - <<EOF … r2_data.put_json …`)은 **A-1 이후** 실행돼 Render 에 `R2_*` 가 없었다. `r2_data.put_json` 은 `r2_configured()` 가 거짓이면 **예외 없이 `False` 만 반환**하므로 job 은 exit 0 = `succeeded` 로 보였지만 실제 업로드는 0건
- 즉 "Render·Vercel 의 R2 버킷이 다르다"는 가설은 **검증되지 않았다**. `.env.example` 에는 "Same R2_* values on Render bot + Vercel webapp" 이라고 되어 있고, A-1 복구 때 Vercel 과 같은 값을 넣으면 원래 설계(배치 → R2 직접 쓰기 → Vercel 읽기)도 동작해야 한다
- 그래도 ESG 탄소(#143)처럼 **Vercel 수신 API 로 보내는 경로**가 버킷 차이·로컬 키 부재와 무관해서 더 안전하다 → §4 는 이 경로로 정리

### A-3. 그 밖에 정리할 것

- **운영에 커밋 안 된 코드가 올라가 있음**: 17:02 Cursor 가 작업 트리에서 `npx vercel --prod` 로 직접 배포. 지금 `savvyetf.com` 에는 git 에 없는 `POST /api/etf-flow-weekly`(+ `apiCache.invalidateServerCache`)가 떠 있다(무인증 POST → 401 확인). **이 diff 를 커밋하지 않고 main 이 다시 배포되면 수신 API 가 사라진다** → §4-1 에서 커밋
- `transfer.sh` 업로드 시도(DNS 실패) — 결과물 JSON 을 외부 공개 업로드 서비스에 올리려던 것. 재시도하지 말 것
- Cursor 가 macOS 키체인에서 Cloudflare 항목을 검색한 흔적(`security` 출력) — 자격증명을 키체인에서 꺼내 쓰는 방식은 쓰지 말 것. 키는 사람이 넣는다
- Render job `startCommand` 에 gzip+base64 페이로드를 통째로 넣는 방식은 명령 길이·JSON 이스케이프 문제(`Invalid control character`)를 일으켰다. 쓰지 말 것

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

## 4. 배포 순서 (개정 2 — 이전 절차 폐기)

> 이전 1번의 "Vercel 은 R2 만 읽으므로 추가 env 없음" 은 틀렸다. 배치가 어느 R2 에 쓰는지가 실행 위치(Render·로컬)의 env 에 달려 있고, 로컬엔 R2 키가 없다. 운영 데이터는 **Vercel 수신 API → Vercel 의 R2** 로만 넣는다(ESG 탄소 #143 과 같은 구조).

```
[로컬 또는 Render] etf_flow_weekly.py ──POST (Bearer WEB_INGEST_SECRET)──▶ Vercel /api/etf-flow-weekly
                                                                         └─ Vercel 의 R2_* 로 etf_flow_weekly/latest.json · latest.xlsx 저장
                                                                    탭 GET ◀─ 같은 R2 에서 읽음
```

**4-0. 선행(사람)**: §A-1 Render 환경변수 복구. ETF Flow 와 별개로 봇 전체가 걸린 일이라 이것부터.

**4-1. 웹 수신 API 커밋** — 작업 트리의 `webapp/src/app/api/etf-flow-weekly/route.ts`(POST 추가)·`webapp/src/lib/apiCache.ts`(`invalidateServerCache`)는 이미 운영에 떠 있으니 그대로 커밋·PR. 검토 포인트:
- 인증: `siteAdminAuthorized` 또는 `WEB_INGEST_SECRET` Bearer (ESG `/api/esg-carbon` POST 와 같은 방식)
- 본문 = `publish_weekly` 의 slim payload(`raw_us` 제외, `raw_us_top` 300행) + `xlsx_base64`. 실측 **JSON 171KB + xlsx base64 682KB ≈ 0.85MB** — Vercel 요청 한도 4.5MB 안. `raw_us` 전체(2.1MB)는 보내지 말 것
- `r2PutJsonDaily(latest.json, …, day)` 로 날짜 스냅샷도 같이 남는지 `lib/r2.ts` 에서 확인

**4-2. Python 전송 함수 추가** (`03_ETF/etf_flow_weekly.py`, 아직 없음)
- `push_to_webapp(slim, xlsx_bytes, *, base_url, secret)` — `06_ESG/esg_carbon.py:255 push_to_webapp` 을 그대로 본뜬다(`urllib.request`, `Authorization: Bearer`, timeout 60)
- base_url: `WEBAPP_PUBLIC_URL` → 없으면 `WEB_PUBLISH_URL` 에서 `/api/ingest` 제거 (esg_carbon.py:300 근처와 같은 규칙). secret: `WEB_INGEST_SECRET`
- `publish_weekly(publish=True)`: secret·base_url 이 있으면 **push 우선**, 없을 때만 `r2_data` 직접 쓰기. `r2_data.put_*` 가 `False` 를 돌려주면 **예외로 올려** 조용한 성공(A-2)을 막는다
- CLI: `--push`(웹 전송) 추가, `--cached-only` 와 같이 쓸 수 있게
- 스케줄러(`etf_flow_weekly_scheduler.py`)는 `publish_weekly(publish=True)` 그대로 → 위 분기로 자동으로 push

**4-3. 첫 데이터 올리기 (로컬, 재수집 없이)**
```bash
WEB_INGEST_SECRET=… WEBAPP_PUBLIC_URL=https://savvyetf.com \
  .venv-sf/bin/python 03_ETF/etf_flow_weekly.py --cached-only --push
curl -s "https://savvyetf.com/api/etf-flow-weekly?ts=$(date +%s)" | head -c 300   # ok:true, generated_at 확인
curl -sI "https://savvyetf.com/api/etf-flow-weekly/excel" | head -5                  # 200, xlsx
```
- 오늘 캐시(`00_exports/etf_flow_weekly/cache/`, 7개 파일)가 있으니 ETF CHECK 호출 0회, 1분 안팎. **처음부터 재수집하지 말 것**(IP 차단 시 요청당 20초 타임아웃이 쌓여 수십 분 소모)
- GET 은 `withServerCache` 5분 + CDN `s-maxage=300` 이 걸려 있다. POST 가 같은 인스턴스 캐시는 지우지만 다른 인스턴스·CDN 은 최대 5분 늦을 수 있음 — 바로 안 보이면 5분 뒤 재확인(재배포·재업로드 반복하지 말 것)
- `WEB_INGEST_SECRET` 값은 사람이 터미널에서 직접 export (문서·커밋·채팅에 남기지 말 것)

**4-4. 정기화 (A-1 복구 뒤)**: Render `ETF_FLOW_WEEKLY_SCHEDULE_ENABLED` 는 현재 `true` 로 들어가 있음(16:31 PUT). Render 에 `WEB_INGEST_SECRET`·`WEBAPP_PUBLIC_URL` 이 복구돼 있어야 화요일 07:40 실행이 웹까지 반영된다. 복구 전 화요일이 오면 수집만 하고 업로드는 실패하니, 복구가 늦어지면 대시보드에서 `false` 로 돌려 둘 것. Render IP 가 ETF CHECK 에 막히면 로그에 `연속 실패 — 이력 수집 중단` 이 찍히고 받은 만큼으로 진행
**4-5. 탭 공개 범위**: 지금은 공개 탭. 관리자 전용으로 하려면 `ADMIN_ONLY_TABS` 에 `"etfflow"` 추가

**하지 말 것**: Render env 일괄 `PUT` · `npx vercel --prod` 로 작업 트리 직접 배포(커밋 후 main 배포로) · Render job `startCommand` 에 데이터 넣기 · 외부 파일 공유 서비스 업로드 · 키체인 조회

## 5. 알려진 한계

- 국내 금액은 수량×종가 추정(장중 체결가 차이). 기관 = 네이버 '기관' 합계
- 미 국채 중장기 테마는 이름에 Muni/Tax-Exempt 가 있는 지방채 제외, 주식 테마(S&P500·배당·에너지·중국·반도체)는 자산군 '주식'만
- VOO 4주 −45B / IVV 4주 +50B 처럼 원천(ETF CHECK·Morningstar) 값 자체가 큰 경우가 있음 — 가공 없이 그대로 표기
- FTXR 처럼 AUM 이 아주 작은 ETF 는 AUM대비 % 가 극단값(−500%)으로 나올 수 있음
- 원자재 그룹에 KRX 금현물 ETF 포함(국내 상장 금 가격이지만 해외 원자재 노출로 분류)
- `etf_us_new_scheduler.py` 의 `due_slot_id(now_kst=…, last_slot_id=…, catchup_minutes=…)` 호출은 실제 시그니처(`now, hour, minute, *, last_slot, window_minutes`)와 다름 — 기본 OFF 라 드러나지 않은 기존 버그(이번 범위 밖, 수정 안 함)
