# SavvyETF

ETF·시황 리서치 플랫폼. 텔레그램 봇이 데이터를 모으고 브리프를 만들고, 웹 대시보드가 그 결과와 실시간 조회를 보여 줍니다.

- 대시보드: https://savvyetf.com (Vercel, `webapp/`)
- 봇·수집기: Render Web Service `savvyetf-bot` (Docker, 저장소 루트)
- 저장소: Cloudflare R2 버킷 `savvyetf-briefs` (브리프·스냅샷·시계열), Supabase (커뮤니티 로그인만)

```
          시세·뉴스 API (Yahoo · Naver · KRX · DART · FRED · OKX …)
                              │
                 ┌────────────┴────────────┐
                 ▼                         ▼
   Render: python bot.py            Vercel: webapp (Next.js)
   · 텔레그램 명령 / 브리프 발송      · 대시보드 탭 · /api/*
   · 스케줄러 (장마감 스냅샷 등)      · Yahoo 직접 조회 (히트맵·시뮬레이션)
   · /api/web/* (Vercel 전용)  ◀─────┤ BOT_WEB_API_SECRET
                 │                         │
                 └──────► Cloudflare R2 ◀──┘
                      (etf_db/, briefs/, nlp_history/, mp/ …)
```

## 저장소 구조

루트의 `bot.py` 는 실행기입니다. `python bot.py` 로 그대로 띄웁니다. 수집 코드는 종류별 번호 폴더에 있습니다.

| 경로 | 내용 |
|---|---|
| `bot.py` | 실행기. 번호 폴더를 경로에 넣고 `01_봇/bot.py` 를 띄움 |
| `01_봇/` | HTTP 서버, 텔레그램, 스케줄 슬롯, 알림, `ops_log.py` |
| `02_시황/` | 국내·미국·NXT 브리프, 뉴스, NLP, 레딧 |
| `03_ETF/` | ETF DB, 편입비, 섹터, ETF CHECK |
| `04_국내시장/` | 코스피200, 코스닥100, 종목 크롤러, KOFIA |
| `05_매크로/` | 매크로, 계절성, 재무·컨센서스, 신용 모니터 |
| `06_ESG/` | ESG, 이벤트 스터디, 기후 |
| `07_공시/` | DART |
| `08_ADR/` | ADR |
| `09_매매/` | 업비트·바이낸스, 김프, 리밸런싱 스케줄 |
| `10_공통/` | R2, 차트 폰트, 시세 신선도, 미국 휴장 달력 |
| `11_받은자료/` | 받은 엑셀. 봇이 읽지 않음 |
| `webapp/` | Vercel 대시보드 (Next.js 15). 자세한 내용은 [`webapp/README.md`](webapp/README.md) |
| `data/` | 봇이 쓰는 시드·유니버스. **webapp 사본의 원본** (아래 “공유 데이터”) |
| `Claude_DB/`, `Claude_Work/` | 인수인계된 분석 코드. 폴더 이름이 import 경로라 그대로 둠 |
| `research/` | 오프라인 연구 하네스 (배포 안 됨) |
| `obsidian/` | 결정 로그·데이터 정책 노트 |
| `colab/` | 원래 Colab 노트북과 티커 목록 (이미지에 포함됨) |

## 로컬 실행

```bash
bash setup.sh                      # .env 생성, .venv 생성, 의존성 설치
# .env 에 TELEGRAM_BOT_TOKEN 등 입력 (.env.example 참고, 주석에 전체 목록)
source .venv/bin/activate
python bot.py
```

같은 토큰으로 봇을 두 곳에서 돌리면 텔레그램이 409를 반환합니다. 로컬에서 실행할 때는 Render 인스턴스와 토큰을 분리하세요.

웹앱:

```bash
cd webapp
npm install
npm run dev
```

## 배포

`main` 에 푸시하면 두 곳이 자동 배포됩니다.

| 대상 | 트리거 | 실패 시 |
|---|---|---|
| Vercel (`webapp/`) | `main` 푸시 | 빌드 실패하면 직전 Production 유지 |
| Render (`savvyetf-bot`) | `main` 푸시 (auto-deploy) | 빌드 실패하면 직전 배포 유지 |

- Render 설정은 `render.yaml` (Blueprint, **Web Service**, Starter 플랜). 비밀값은 `sync: false` 로 두고 Render 대시보드에서만 입력합니다.
- Vercel 환경변수와 크론은 [`webapp/README.md`](webapp/README.md), `webapp/vercel.json`.
- 푸시 전 확인: `cd webapp && npm run build` (import 검사 포함).

### CI (GitHub Actions)

| 워크플로 | 하는 일 |
|---|---|
| `webapp-import-check.yml` | 웹앱 import 그래프 검사 + `tsc --noEmit` |
| `python-check.yml` | 공유 데이터 동기화 확인, 의존성 설치, 모든 모듈 컴파일, `import bot` |
| `python-deps-lock.yml` | **수동 실행.** Python 3.12 기준으로 의존성을 해석해 `constraints.txt` 를 커밋 |

### Python 의존성 고정

`requirements.txt` 는 허용 범위, `constraints.txt` 는 정확한 버전입니다. Docker 이미지는 `constraints.txt` 가 있으면 그 버전으로 설치합니다.
처음 한 번, 그리고 업그레이드하고 싶을 때 GitHub → Actions → **python deps lock** → Run workflow.

## 공유 데이터

봇과 웹앱이 같은 파일을 각자 사본으로 갖고 있습니다. `data/` 가 원본입니다.

```bash
python scripts/sync_shared_data.py          # data/ → webapp/src/data/ 복사
python scripts/sync_shared_data.py --check  # 다르면 실패 (CI에서 실행)
```

## 관리자 전용 기능

대시보드의 관리자 전용 탭과 데이터는 **서버에서** 막습니다 (`webapp/src/lib/adminGuard.ts`).
새 관리자 전용 탭을 만들면 화면에서 숨기는 것과 별도로, 그 탭이 부르는 API 라우트에 `requireSiteAdmin()` 를 넣고 응답을 `PRIVATE_NO_STORE` 로 보내야 합니다 (CDN 이 `Authorization` 을 구분하지 않기 때문).

## 프로세스 역할 분리 (선택)

`BOT_ROLE` 로 한 프로세스가 맡을 일을 고릅니다. 기본값 `all` 은 지금까지와 동일합니다.

| `BOT_ROLE` | 웹 서버 | 스케줄러 | 텔레그램 폴링 |
|---|---|---|---|
| `all` (기본) | ✓ | ✓ | ✓ |
| `web` | ✓ | – | ✓ |
| `scheduler` | ✓ (`/health`) | ✓ | – |

메모리가 부족할 때 `web` 과 `scheduler` 를 별도 Render 서비스로 나눌 수 있습니다. 나누기 전에 확인할 점:

- `/summary*`, `/reddit`, `/event` 페이지와 PDF 는 스케줄러가 **로컬 디스크**에 쓴 파일을 웹 서버가 읽습니다. 서비스를 나누면 디스크가 공유되지 않으므로 이 경로들을 R2 에서 읽도록 먼저 바꿔야 합니다.
- 텔레그램 폴링은 한 곳(`web`)에서만 돌아야 합니다. 발송(브로드캐스트)은 `scheduler` 에서도 됩니다.
- Render 서비스가 하나 늘면 요금도 늘어납니다 (Starter 기준 월 약 $7).

## 운영 확인

- `GET /health` (`HEALTH_CHECK_SECRET` 설정 시 토큰 필요): 스케줄러 스레드 상태, 마지막 슬롯·오류, `role`, `suppressed_errors` (무시된 예외의 호출 위치별 횟수).
- Render 로그의 `[suppressed] 모듈.함수 (N회): 오류` 줄은 호출 위치마다 10분에 한 번만 찍힙니다 (`SUPPRESSED_LOG_WINDOW_SECONDS`).
- 대시보드 관리자 탭 **적재 현황**: R2 데이터셋별 마지막 적재일과 지연 여부.

## 보안

- 토큰·키는 `.env`(로컬)와 Render/Vercel 대시보드에만 둡니다. 이 저장소는 공개 저장소입니다.
- 원래 Colab 노트북에 봇 토큰이 노출된 적이 있다면 [@BotFather](https://t.me/BotFather) 에서 `/revoke` 후 새 토큰을 쓰세요.
