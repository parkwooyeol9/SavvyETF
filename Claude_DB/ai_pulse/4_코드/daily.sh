#!/bin/bash
# 매일 자동 실행용 (launchd가 호출). 브라우저는 열지 않고 로그만 남깁니다.
cd "$(dirname "$0")/.." || exit 1
LOG="2_결과물/daily.log"
PY="${PYTHON:-/Users/wooyeol/opt/anaconda3/bin/python3}"
# Local secrets (SEC contact User-Agent, R2 keys for --upload). Never committed.
set -a; [ -f .env.local ] && . ./.env.local; set +a
{
  echo "=== $(date '+%Y-%m-%d %H:%M:%S') 시작"
  "$PY" 4_코드/fetch_all.py && "$PY" 4_코드/build_dashboard.py
  "$PY" 4_코드/fetch_economy.py && "$PY" 4_코드/build_economy.py
  # Homepage: JSON for the SavvyETF tab. Uploads only when R2 keys are set (in .env.local or SavvyETF/.env).
  if [ -n "$R2_ACCOUNT_ID" ] || grep -q "^R2_ACCOUNT_ID=" "${SAVVYETF_DIR:-$HOME/GitHub/SavvyETF}/.env" 2>/dev/null; then
    "$PY" 4_코드/export_web.py --upload
  else
    "$PY" 4_코드/export_web.py
  fi
  echo "=== $(date '+%Y-%m-%d %H:%M:%S') 종료 (exit $?)"
} >> "$LOG" 2>&1
# 로그가 너무 커지지 않게 최근 2,000줄만 유지
tail -n 2000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
