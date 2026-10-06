#!/usr/bin/env bash
# GitHub push 전에 로컬에서 웹앱(포트폴리오 › ACWI, 리밸런싱 › Index Monitor)을 띄워 확인한다.
# R2 대신 Claude_DB/out/sealed_local/ (버킷과 같은 경로) 의 봉인 파일을 읽는다. 업로드·커밋은 하지 않는다.
#
#   bash Claude_DB/scripts/local_preview.sh              # 봉인 파일 다시 만들고 http://localhost:3000 실행
#   bash Claude_DB/scripts/local_preview.sh --rebuild    # 엑셀(data/ACWI_v3.xlsx)부터 분석기·백테스트 재계산 (약 10분)
#   bash Claude_DB/scripts/local_preview.sh --index      # Index Monitor MSCI 봉인본도 다시 만듦 (webapp/src/data/indexMonitorChanges.json 갱신됨)
#   bash Claude_DB/scripts/local_preview.sh --no-export  # 이미 만든 sealed_local 그대로 웹앱만 실행
#   bash Claude_DB/scripts/local_preview.sh --build      # dev 대신 배포와 같은 프로덕션 빌드(next build && next start)로 실행
#
# 필요: Claude_DB/.env.local 의 SEALED_DATA_KEY, python3 + cryptography, webapp/node_modules (npm install)
set -euo pipefail
# Finder 더블클릭(.command)·비대화형 셸에서도 node/npm 을 찾도록
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1 || true

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CDB="$REPO/Claude_DB"
LOCAL_DIR="$CDB/out/sealed_local"
XLSX="${ACWI_XLSX:-$CDB/data/ACWI_v3.xlsx}"
PY="${PYTHON:-python3}"

REBUILD=0; INDEX=0; EXPORT=1; MODE=dev
for a in "$@"; do
  case "$a" in
    --rebuild) REBUILD=1 ;;
    --index) INDEX=1 ;;
    --no-export) EXPORT=0 ;;
    --build) MODE=prod ;;
    -h|--help) sed -n '2,11p' "$0"; exit 0 ;;
    *) echo "알 수 없는 옵션: $a"; exit 2 ;;
  esac
done

envval() {  # envval NAME FILE — .env 파일에서 값 하나 읽기 (따옴표 제거)
  [ -f "$2" ] || return 0
  grep -E "^$1=" "$2" | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
}

KEY="${SEALED_DATA_KEY:-$(envval SEALED_DATA_KEY "$CDB/.env.local")}"
if [ -z "$KEY" ]; then
  echo "✗ SEALED_DATA_KEY 가 없습니다. Claude_DB/.env.local 에 넣거나 'python3 -m Claude_DB.sealed_r2 --new-key' 로 만드세요."; exit 1
fi
export SEALED_DATA_KEY="$KEY"

cd "$REPO"
if [ "$REBUILD" = 1 ]; then
  [ -f "$XLSX" ] || { echo "✗ 엑셀 없음: $XLSX (ACWI_XLSX=경로 로 지정 가능)"; exit 1; }
  echo "▶ 분석기 재계산 ($XLSX)"
  "$PY" -m Claude_DB.factor.analyzer --xlsx "$XLSX"
  echo "▶ 백테스트 재계산 (6~7분)"
  "$PY" -m Claude_DB.factor.backtest --xlsx "$XLSX"
fi

if [ "$EXPORT" = 1 ]; then
  [ -f "$CDB/web/analyzer_data.js" ] || { echo "✗ Claude_DB/web/analyzer_data.js 없음 → --rebuild 로 실행하세요"; exit 1; }
  echo "▶ ACWI 봉인 파일 → $LOCAL_DIR/private/acwi/latest/"
  "$PY" -m Claude_DB.factor.export_webapp
  rm -rf "$CDB/out/webapp_export"   # 업로드용 사본은 미리보기에 필요 없음 (실수 업로드 방지)
  if [ "$INDEX" = 1 ]; then
    echo "▶ Index Monitor 봉인 파일"
    (cd "$CDB/index_monitor" && "$PY" src/export_webapp.py)
  fi
fi

[ -f "$LOCAL_DIR/private/acwi/latest/summary.bin" ] || { echo "✗ $LOCAL_DIR 에 summary.bin 없음"; exit 1; }
[ -f "$LOCAL_DIR/private/index_monitor/msci_rows.bin" ] || echo "! Index Monitor MSCI 봉인본 없음 → 공개 지수만 보임 (--index 로 생성)"

# 봉인 키 검증: 웹앱과 같은 키로 열리는지
"$PY" - "$LOCAL_DIR/private/acwi/latest/summary.bin" <<'EOF' || echo "! 복호화 검증 건너뜀 (python cryptography 없음 또는 키 불일치 — 화면에서 데이터가 안 보이면 키 확인)"
import sys
from Claude_DB import sealed_r2
d = sealed_r2.open_sealed(open(sys.argv[1], "rb").read())
print(f"✓ summary.bin 복호화 OK · 기준일 {d['meta'].get('as_of')} · 종목 {len(d.get('stocks') or d.get('rows') or [])}")
EOF
[ -f "$LOCAL_DIR/private/acwi/latest/backtest.bin" ] && echo "✓ backtest.bin 있음 (팩터 백테스트 화면)" || echo "! backtest.bin 없음 → 팩터 백테스트 화면이 비어 있음"

# 관리자 비밀번호: webapp/.env.local 에 없으면 로컬 전용 임시값
WENV="$REPO/webapp/.env.local"
ADMIN="${CARDNEWS_ADMIN_SECRET:-$(envval CARDNEWS_ADMIN_SECRET "$WENV")}"
[ -n "$ADMIN" ] || ADMIN="$(envval RESEARCH_ADMIN_SECRET "$WENV")"
if [ -z "$ADMIN" ]; then
  ADMIN="local-preview"
  export CARDNEWS_ADMIN_SECRET="$ADMIN"
  echo "! webapp/.env.local 에 관리자 비밀번호가 없어 로컬 전용 비밀번호 'local-preview' 를 씁니다"
fi

export SEALED_DATA_LOCAL_DIR="$LOCAL_DIR"
cd "$REPO/webapp"
[ -d node_modules ] || { echo "▶ npm install"; npm install; }

cat <<EOF

────────────────────────────────────────────────────────
 로컬 미리보기: http://localhost:3000
  1) 관리자 로그인 (비밀번호: $( [ "$ADMIN" = local-preview ] && echo "local-preview" || echo "webapp/.env.local 의 관리자 비밀번호" ))
  2) 포트폴리오 › ACWI → 스크리너 · 종목 상세(3Y/10Y) · 팩터 백테스트
  3) 리밸런싱 › Index Monitor → MSCI 행 포함 여부
 데이터 출처: $LOCAL_DIR (R2 아님) · 종료: Ctrl+C
────────────────────────────────────────────────────────
EOF

if [ "$MODE" = prod ]; then
  npm run build && npx next start -p 3000
else
  npm run dev
fi
