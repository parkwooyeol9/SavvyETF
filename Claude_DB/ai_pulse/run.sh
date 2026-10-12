#!/bin/bash
# AI Pulse: 수집 → 대시보드 생성. 인자는 fetch_all.py로 전달됩니다 (예: ./run.sh --only gurus apps).
set -e
cd "$(dirname "$0")"
set -a; [ -f .env.local ] && . ./.env.local; set +a   # SEC contact User-Agent etc. (not committed)
python3 4_코드/fetch_all.py "$@"
python3 4_코드/build_dashboard.py
python3 4_코드/fetch_economy.py
python3 4_코드/build_economy.py
open 2_결과물/ai_pulse.html 2>/dev/null || true
