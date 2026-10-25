# 14. Cursor 인수인계 — AI 시황 R2 업로드 복구 (2026-10-26)

- 작성: 2026-10-26 (Claude) · 받는 쪽: Cursor
- 대상 저장소: `/Users/wooyeol/GitHub/SavvyETF` (origin `parkwooyeol9/SavvyETF`, 브랜치 `main`)
- 기준 커밋: `e049755`
- **Claude는 git을 쓰지 않았습니다.** 아래 파일은 작업 트리에 수정만 된 상태입니다. 커밋·푸시는 Cursor 몫입니다.

---

## 1. 증상
- 웹 AI 시황(`/api/ai-pulse`)의 `generated` 가 **2026-10-12 15:33** 에서 멈춤 (10-26 기준 14일).
- 봇 `/health` → `scheduler.last_ai_pulse_error = "export did not publish today's JSON"`, `last_ai_pulse_ok_at = null`. 05:10 스케줄러는 매일 돌고 있음(heartbeat 정상).

## 2. 원인
커밋 `68035ad` (2026-10-12 18:30, "Group bot collectors into numbered folders…")에서
`r2_data.py` 가 저장소 루트 → `10_공통/r2_data.py` 로 옮겨졌다 (`R099`).

그런데 `Claude_DB/ai_pulse/4_코드/export_web.py --upload` 는 여전히
`sys.path.insert(0, SAVVYETF_DIR)` 후 `import r2_data` 를 한다 → `ModuleNotFoundError` → `sys.exit("r2_data.py를 찾지 못함 …")` → 종료 코드 1.
스케줄러(`02_시황/ai_pulse_scheduler.py`)는 이를 `exported=False` 로 받아 위 오류 문구만 남긴다.
마지막 정상 데이터(10-12 15:33)가 이동 커밋 3시간 전이라 시점이 정확히 맞는다.

재현: `env -i SAVVYETF_DIR=<repo> python3 -c "import sys; sys.path.insert(0,'<repo>'); import r2_data"` → `ModuleNotFoundError`.

## 3. 수정한 파일 (커밋 대상)
| 파일 | 변경 |
|---|---|
| `Claude_DB/ai_pulse/4_코드/export_web.py` | `sys.path[:0] = [repo/"10_공통", repo]` — `10_공통` 을 먼저, 루트는 예전 체크아웃용으로 유지. `10_공통/path_setup.py` 가 있어 `r2_data` 의 `import path_setup`·`r2_briefs` 도 풀림 |
| `02_시황/ai_pulse_scheduler.py` | 실패 문구에 원인 구분 추가: `(export_web.py --upload failed)` / `(R2 latest JSON is not today's)`. 동작은 그대로 |

같은 수정을 git 밖 원본 `SavvyDB/ai_pulse/4_코드/export_web.py` 에도 적용함(두 파일 내용 동일 유지). SavvyDB 는 git 저장소가 아니라 커밋 대상 아님.

## 4. 검증 완료
- `python3 -m py_compile` 두 파일 통과
- 봇과 같은 조건(`env -i`, `SAVVYETF_DIR` 만 지정)에서 `import r2_data` 성공, `put_json_daily` 존재
- `SavvyDB/ai_pulse` 에서 `export_web.py --upload` 끝까지 실행 → JSON·틀 저장 후 R2 단계까지 도달(로컬엔 R2 키가 없어 "R2 실패(R2_* 환경변수 확인)" 출력 — 정상). 수정 전에는 이 단계 전에 종료됨
  - 이 실행으로 `SavvyDB/ai_pulse/2_결과물/web/` 의 로컬 JSON·HTML 이 다시 만들어짐 (스크립트 본래 동작)

## 5. 검증하지 못한 것 / 주의
- **Render 배포 후 실제 05:10 실행.** 배포 다음 날 아침 확인:
  - `https://savvyetf-bot.onrender.com/health` → `last_ai_pulse_error` 가 `null`, `last_ai_pulse_ok_at` 이 그날 05시대
  - `https://savvyetf.com/api/ai-pulse` 의 `generated` 가 그날 날짜
  - 따로 수동 실행 명령은 없으니 다음 05:10 슬롯(catch-up 50분, 06:00까지)을 기다리면 됨
- 히스토리 CSV 는 R2 `ai_pulse/state/data.tar.gz` 에서 복원되는데, 14일 공백 동안에도 `save_state()` 는 돌았으므로 수집분은 쌓여 있을 것으로 봄 (미확인).
- `68035ad` 에서 옮긴 다른 루트 모듈을 `sys.path` 에 루트만 넣고 import 하는 스크립트가 더 있는지는 전수 확인하지 않음. `SAVVYETF_DIR` 사용처는 이 파일과 `daily.sh`(.env 경로만 사용) 뿐임.

## 6. 커밋 방법

```bash
cd /Users/wooyeol/GitHub/SavvyETF
git add "Claude_DB/ai_pulse/4_코드/export_web.py" "02_시황/ai_pulse_scheduler.py" \
  "Claude_DB/docs/14_Cursor_인수인계_AI시황_업로드복구.md"
git commit -m "fix(ai-pulse): find r2_data in 10_공통 so the 05:10 run publishes again"
```

이번 범위 밖(건드리지 말 것): `.next/`, 루트 `package-lock.json`, `00_exports/`, `11_받은자료/`, `research/*`, `.claude/`, `.github/workflows/python-check.yml`, `Claude_DB/docs/08_…`, `11_…`·`12_…` 인수인계서.

## 7. 완료 기준
- 배포 다음 날 `/api/ai-pulse` 의 `generated` 가 당일, `/health` 의 `last_ai_pulse_error` 가 `null`
