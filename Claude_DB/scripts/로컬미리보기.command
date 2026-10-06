#!/bin/bash
# Finder 에서 더블클릭 → 로컬 웹앱(http://localhost:3000) 실행. 이미 만든 봉인 파일 사용. 창을 닫거나 Ctrl+C 로 종료.
cd "$(dirname "$0")/../.." || exit 1
bash Claude_DB/scripts/local_preview.sh --no-export
echo; read -n 1 -s -r -p "종료됨 — 아무 키나 누르면 창이 닫힙니다"
