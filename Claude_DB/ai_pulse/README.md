# AI Pulse — AI 붐을 발언과 숫자로 재는 계기판

AI 구루 12명의 최근 발언을 중심으로, 개발자 선택(SDK 다운로드), 기업 채용, 오픈모델, 앱 순위, 오픈소스, 연구량을 한 페이지에 모았습니다. 모두 키 없이 수집합니다.

**바로 열어볼 것:**
- `2_결과물/ai_pulse.html` — 구루 발언·SDK·채용·오픈모델·앱 순위·연구량
- `2_결과물/ai_economy.html` — **AI 경제 침투**: 투자가 사용량·매출·기업 채택·일자리·생산성으로 이어지는지, 로봇으로 번지는지

두 페이지는 서로 링크돼 있고, 더블클릭하면 오프라인에서 열립니다.

## 실행

```bash
cd ~/GitHub/SavvyDB/ai_pulse
pip install pandas        # 처음 한 번
./run.sh                  # 수집 + 대시보드 생성 (arXiv 첫 실행만 약 20분, 이후 2~3분)
```

일부만:

```bash
python3 4_코드/fetch_all.py --only gurus apps     # 발언·앱 순위만 (1~2분)
python3 4_코드/build_dashboard.py
```

권장 주기는 매일입니다. 채용·Hugging Face·앱 순위·GitHub는 실행할 때의 값만 받을 수 있어서, 매일 실행해야 "달라진 점"과 추이가 생깁니다.

### 매일 자동 실행 (macOS)

`4_코드/daily.sh`가 수집과 화면 생성을 하고 `2_결과물/daily.log`에 기록합니다. 매일 07:30에 돌리려면 터미널에서 아래를 한 번 실행하세요(Mac이 잠들어 있었으면 깨어난 뒤 실행됩니다).

```bash
cat > ~/Library/LaunchAgents/com.savvydb.aipulse.plist <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.savvydb.aipulse</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>/Users/wooyeol/GitHub/SavvyDB/ai_pulse/4_코드/daily.sh</string></array>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>7</integer><key>Minute</key><integer>30</integer></dict>
</dict></plist>
PLIST
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.savvydb.aipulse.plist
```

끄기: `launchctl bootout gui/$(id -u)/com.savvydb.aipulse` · 지금 바로 한 번 돌려보기: `launchctl kickstart gui/$(id -u)/com.savvydb.aipulse`

## 화면 구성

| 섹션 | 무엇을 보나 | 출처 |
|---|---|---|
| 달라진 점 | 직전 실행 대비 앱 순위·채용 공고·GitHub 스타·Hugging Face 점유·구루 발언량의 큰 변화 | 각 `*_history.csv` |
| ① AI 구루 발언 | 12명의 최근 30일 발언 헤드라인(영문·국내, 같은 발언은 하나로 묶고 보도 매체 수 표시), 직접 인용문, 무드 지수(가속·낙관 vs 신중·우려), 화제성, 인물×주제 지도, 본인 블로그·에세이·블루스카이, 팟캐스트·뉴스레터 | Google News RSS, 본인 사이트, Bluesky, Dwarkesh·Lex Fridman, Import AI·One Useful Thing·Gary Marcus |
| ② 개발자 선택 | OpenAI·Anthropic·Google SDK 주간 다운로드와 점유율, 프레임워크(LangChain·MCP 등) | pypistats.org, npm |
| ③ 채용 | AI 10개사 공고 수, 최근 30일 신규, 직군 구성, 하드웨어·인프라 공고 | Greenhouse·Ashby 공개 채용 API |
| ④ 오픈모델 | LLM 다운로드 점유율(조직별), 트렌딩 모델 | Hugging Face API |
| ⑤ 앱 순위 | 한국·미국 앱스토어 무료 100위 안 AI 앱 | Apple 마케팅 RSS |
| ⑥ 오픈소스 | 주요 AI 저장소 18개 스타·최근 커밋 | GitHub API |
| ⑦ 연구량 | arXiv cs.LG·cs.AI·cs.CL 월별 논문 수 (24개월) | arXiv 목록 페이지 |

### 추적하는 구루

일리야 수츠케버, 샘 올트먼, 다리오 아모데이, 데미스 허사비스, 제프리 힌턴, 얀 르쿤, 안드레이 카르파시, 젠슨 황, 페이페이 리, 앤드루 응, 요슈아 벤지오, 무스타파 술레이만. `4_코드/fetch_all.py`의 `GURUS`에 (영문 이름, 한글 이름, 소개, 성) 한 줄을 넣으면 추가됩니다.

## AI 경제 침투 페이지

AI 가치사슬을 7단계(투자 → 사용량 → 매출 → 기업 채택 → 일자리 → 생산성 → 로봇)로 놓고 각 단계의 최신 값을 한 줄로 보여준 뒤, 섹션별로 풀어 봅니다.

| 섹션 | 지표 | 출처 |
|---|---|---|
| ① 매출 전환 | 빅테크 5사(MSFT·GOOGL·AMZN·META·ORCL) 분기 설비투자 vs 매출과 그 비율, 엔비디아 매출, 기업 AI API 주간 지출·토큰 사용량·실효 단가(Anthropic·OpenAI), OpenRouter 토큰 처리량 상위 모델과 가격, AI 앱 매출 순위 | SEC XBRL, Ramp AI Index, OpenRouter, iTunes RSS |
| ② 기업 채택 | 미국 기업 AI 도입률(Ramp 결제 기준·Census 설문 기준·6개월 내 예정), 회사별 기업 도입률, 업종별 도입률, 직원 1인당 월 AI 지출, 공시에 AI를 언급한 보고서 수와 업종 구성 | Ramp, Census BTOS, SEC 전문검색 |
| ③ 생산성·일자리 | 노동생산성 전년비, 총요소생산성(가동률 조정), 채용 공고 중 AI 비중(미·영·독), 개발자 채용 공고, 컴퓨터 시스템 설계업 고용 | FRED(BLS·Indeed), SF 연준, Indeed Hiring Lab |
| ④ 로보틱스 | 산업용 로봇 수출(중·일·독·한·미·이), 로봇·자율주행 기업 채용과 제조 직무 비중, arXiv 로보틱스 논문, 로봇 AI 모델 다운로드, 로봇 노출 직업 | UN Comtrade, Greenhouse·Ashby, arXiv, Hugging Face, Anthropic Economic Index |
| 핵심·⓪ 모델 경쟁 | 자동 관찰 5개(꼬리표), 25개 모델 지능 지수 vs 과제당 비용과 효율 경계, API 비용 계산기 | Artificial Analysis, OpenRouter |
| ⑤ 인프라·ETF | 반도체·메모리·네트워크·광통신·전력 기업 분기 매출과 AIQ·BOTZ·DTCR **실제** 편입 비중, 메모리 현물가 | SEC XBRL, Global X 보유종목, TrendForce |

수집: `python3 4_코드/fetch_economy.py` (약 10분, Comtrade 요청 제한 때문. 지난 연도 무역 자료는 다시 받지 않아 다음부터 빨라짐) → `python3 4_코드/build_economy.py`. `run.sh`와 `daily.sh`가 둘 다 함께 실행합니다.

읽을 때 주의:
- **Ramp**는 Ramp 결제를 쓰는 미국 기업(7만+, 중소·성장 기업 위주) 기준이라 미국 전체보다 도입률이 높습니다. 토큰 지출은 Ramp로 결제된 API 사용분만입니다. 데이터는 공개 페이지에 들어 있는 값을 읽으므로 페이지 구조가 바뀌면 실패할 수 있습니다(상태 카드에 표시).
- **Census BTOS**는 2025년 11월 AI 문항이 바뀌었습니다. 업종별 값은 최근 3회 평균이고 비공개 처리(S)된 칸은 뺍니다.
- **빅테크 설비투자**는 현금흐름표의 유형자산 취득액(데이터센터 외 설비 포함)입니다. AI 매출만 따로 공시하는 회사가 없어 전체 매출과 비교합니다. 엔비디아·오라클은 회계 분기 중간 날짜로 달력 분기에 맞췄습니다.
- **공시 속 AI**는 매년 1분기에 연간보고서가 몰려 4분기 합으로 봅니다. 금융 업종엔 스팩(SPAC)이 많이 섞입니다.
- **생산성**에서 AI 효과만 분리할 수는 없습니다. 도입률과 같은 시기에 움직이는지 나란히 보는 용도입니다.
- 키가 필요한 미국 무역 API(월간 로봇 수입)와 한국 데이터(관세청 수출, 한국은행 생산성)는 아직 넣지 않았습니다.

## SavvyETF 홈페이지 탑재

홈페이지(savvyETF, AI 메뉴 › "AI 펄스" 탭)에는 데이터 없는 화면 틀과 매일 바뀌는 JSON을 나눠서 올립니다.

- `python3 4_코드/export_web.py` → `2_결과물/web/` 에 JSON 2개와 틀 HTML 2개. `--upload`를 붙이면 R2(`ai_pulse/{pulse,economy}/latest.json`)에 올림. `daily.sh`는 R2 키가 있으면 자동 업로드.
- `python3 4_코드/make_bundle.py` → `savvyetf_export/`: SavvyETF 저장소와 같은 경로 구조의 커밋용 묶음 + Cursor 인수인계서 `HANDOFF_AI_PULSE.md`.
- 공개 JSON에서는 약관 확인 전인 TrendForce 메모리 현물가를 뺍니다(`PUBLIC_DROP`).
- SEC가 요구하는 연락처 User-Agent는 코드가 아니라 `.env.local`의 `SAVVY_UA`에 둡니다(저장소가 공개라서).

## 화면 보는 법 — 꼬리표

AI 경제 침투 페이지의 핵심 관찰과 요약 문장에는 꼬리표가 붙습니다: **사실**(출처가 보고·측정한 값) · **추정**(데이터 위에서 우리가 계산한 값) · **전망**(기관·시장의 예상) · **해석**(관측에 대한 우리의 읽기).

## 폴더

```
ai_pulse/
├── README.md
├── run.sh
├── 2_결과물/
│   ├── data/              정리된 CSV, *_history.csv(스냅샷 누적), status.json
│   └── ai_pulse.html      대시보드
└── 4_코드/
    ├── fetch_all.py       수집·정리 (발언 판별 규칙 포함)
    ├── build_dashboard.py 화면용 수치 계산 → ai_pulse.html
    ├── template.html      ai_pulse 화면 틀 (공용 스타일·차트 함수)
    ├── fetch_economy.py   AI 경제 침투 수집
    ├── build_economy.py   → ai_economy.html
    ├── template_economy.html
    ├── export_web.py      홈페이지용 JSON·틀 (+ R2 업로드)
    ├── make_bundle.py     SavvyETF 커밋 묶음 → savvyetf_export/
    └── daily.sh           매일 자동 실행용
```

원본 파일을 따로 보관할 필요가 없는 API들이라 `1_원본데이터/`는 없습니다. 기간이 쌓이는 데이터는 `2_결과물/data/*_history.csv`에 있으니 지우지 마세요.

## 알아둘 점

- **발언 수집 방식:** X(트위터)는 로그인이 필요해 수집하지 않습니다. 대신 뉴스 헤드라인에서 이름 뒤에 says·warns·밝혔다 같은 말이나 따옴표가 오면 발언으로 봅니다. 따옴표 안 문장은 직접 인용으로 따로 뽑습니다. 별명('Godfather of AI'), 영화 〈Artificial〉(올트먼 전기 영화), 가족·가십 기사는 뺍니다. 헤드라인은 기자의 요약이라 원문과 다를 수 있으니 링크로 확인하세요.
- **무드 지수:** 발언 헤드라인을 단어 목록으로 가속·낙관(+1)·신중·우려(−1)·중립(0)으로 나눈 평균입니다(×100). "규제 필요 없다", "AI가 인류를 죽인다고 보지 않는다"처럼 우려 단어를 부정하는 말은 가속 쪽으로 셉니다. 뉴스 헤드라인은 원래 우려 쪽으로 기울어 있으니 수준보다 주간 변화와 인물 간 차이로 읽으세요. 단어 목록은 `build_dashboard.py`의 `OPT`·`CAU`에서 고칩니다.
- **중복 묶기:** 같은 인물의 헤드라인 중 인용문이 같거나 단어가 35% 이상 겹치면 같은 발언으로 묶습니다(이름은 비교에서 뺌). 영문과 국내 기사는 언어가 달라 따로 남습니다.
- **본인 채널:** 일리야 수츠케버·젠슨 황·허사비스 등은 공개 블로그가 없어 뉴스로만 추적합니다. 얀 르쿤·카르파시의 블루스카이는 2023~2024년 이후 활동이 없어 "최근 활동 없음"으로 표시됩니다.
- **PyPI 집계 단절:** 2026년 8월 마지막 주부터 모든 PyPI 패키지 다운로드가 동시에 약 40% 줄었습니다(같은 기간 npm은 증가). 실제 사용 감소보다 집계 방식 변화로 보입니다. 회사 간 점유율 비교는 유효합니다.
- **SDK 다운로드**에는 CI 서버 자동 설치가 섞여 있습니다. MCP·LangChain처럼 다른 패키지가 함께 설치하는 경우 수치가 부풀려집니다.
- **직군 분류**는 공고 제목·부서명 키워드 규칙입니다. 고객 대응 엔지니어(Solutions·Forward Deployed)는 영업·고객으로 셉니다.
- **arXiv**는 API가 요청 제한(429)이 잦아 월별 목록 페이지의 "Total of N entries"를 읽습니다. robots.txt의 요청 간격(15초)을 지켜서 첫 실행이 오래 걸립니다. 지난 달 값은 다시 받지 않습니다.
- **저작권:** 헤드라인과 링크, 블로그 제목만 저장합니다. 기사 본문의 저작권은 각 언론사에 있습니다. 개인 분석용입니다.
- 조사했지만 뺀 것: 네이버 금융·Forbes·Box Office Mojo(robots.txt가 수집 금지), Stocktwits(봇 차단), Google Trends(공개 엔드포인트 없음).
