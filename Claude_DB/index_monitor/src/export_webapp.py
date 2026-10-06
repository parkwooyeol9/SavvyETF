"""data/out/data.json 을 SavvyETF 웹앱(리밸런싱 > Index Monitor 탭)용으로 내보낸다.

실행(프로젝트 루트에서): python src/export_webapp.py [--as-of 2026-10-02] [--upload]
출력
  <repo>/webapp/src/data/indexMonitorChanges.json  — MSCI 를 뺀 공개 행 {"asOf", "rows"} (git 에 커밋됨)
  data/out/webapp_msci_rows.bin                     — MSCI_* 행 봉인본 (Claude_DB/sealed_r2.py)
  --upload 이면 봉인본을 R2 private/index_monitor/msci_rows.bin 으로 올린다 (API 가 관리자에게만 합쳐 준다)
저장소가 공개라 MSCI 공개 리스트(DB 생성 금지 고지) 행은 웹앱 파일에 넣지 않는다. 웹앱 쪽 파일은 생성물이라 손으로 고치지 않는다.
"""
import argparse
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REPO = ROOT.parent.parent
OUT = REPO / "webapp/src/data/indexMonitorChanges.json"
MSCI_OUT = ROOT / "data/out/webapp_msci_rows.bin"
MSCI_KEY = "private/index_monitor/msci_rows.bin"

sys.path.insert(0, str(REPO))
from Claude_DB import sealed_r2  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("--as-of", default=datetime.now(timezone(timedelta(hours=9))).strftime("%Y-%m-%d"))
ap.add_argument("--upload", action="store_true")
args = ap.parse_args()

rows = json.loads((ROOT / "data/out/data.json").read_text(encoding="utf-8"))
assert isinstance(rows, list) and rows, "data/out/data.json 이 비어 있습니다. build_dataset.py 를 먼저 실행하세요"
public = [r for r in rows if not str(r.get("index_id", "")).startswith("MSCI_")]
msci = [r for r in rows if str(r.get("index_id", "")).startswith("MSCI_")]
OUT.write_text(json.dumps({"asOf": args.as_of, "rows": public}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
blob = sealed_r2.seal({"asOf": args.as_of, "rows": msci})
MSCI_OUT.write_bytes(blob)
LOCAL = REPO / "Claude_DB/out/sealed_local" / MSCI_KEY   # 로컬 미리보기(SEALED_DATA_LOCAL_DIR)용 사본
LOCAL.parent.mkdir(parents=True, exist_ok=True)
LOCAL.write_bytes(blob)
print(f"→ {OUT.relative_to(REPO)} (공개 {len(public)} rows, asOf {args.as_of}, {OUT.stat().st_size:,} bytes)")
print(f"→ {MSCI_OUT.relative_to(ROOT)} (MSCI {len(msci)} rows 봉인, {len(blob):,} bytes)")
if args.upload:
    sealed_r2.upload({MSCI_KEY: blob})
    print(f"업로드 완료 → R2 {MSCI_KEY}")
