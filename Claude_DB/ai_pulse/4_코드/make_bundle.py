"""SavvyETF 커밋용 묶음(savvyetf_export/)을 최신 코드로 다시 만듭니다.

    python3 4_코드/make_bundle.py

savvyetf_export/ 는 SavvyETF 저장소와 같은 경로 구조입니다. Cursor는 HANDOFF_AI_PULSE.md 를 읽고
이 폴더의 파일을 저장소 같은 위치로 복사한 뒤 커밋합니다.
  손으로 관리:  HANDOFF_AI_PULSE.md, webapp/src/**, patches/**
  자동 생성:    Claude_DB/ai_pulse/** (파이프라인 코드 사본), webapp/public/ai-pulse/*.html (화면 틀),
               sample_data/*.json (로컬 확인용, 커밋 금지)
"""
from __future__ import annotations

import re
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
B = ROOT / "savvyetf_export"
CODE = ["fetch_all.py", "fetch_economy.py", "build_dashboard.py", "build_economy.py", "export_web.py", "make_bundle.py",
        "template.html", "template_economy.html", "daily.sh"]
GITIGNORE = """# 수집 결과·이력·로컬 비밀값 — 저장소에 넣지 않음 (데이터는 R2로)
2_결과물/
1_원본데이터/
.env.local
__pycache__/
"""


def main() -> None:
    subprocess.run([sys.executable, str(HERE / "export_web.py")], check=True)
    dst = B / "Claude_DB" / "ai_pulse"
    if dst.exists():
        shutil.rmtree(dst)
    (dst / "4_코드").mkdir(parents=True)
    for f in CODE:
        shutil.copy2(HERE / f, dst / "4_코드" / f)
    for f in ["README.md", "run.sh"]:
        shutil.copy2(ROOT / f, dst / f)
    (dst / ".gitignore").write_text(GITIGNORE, encoding="utf-8")
    # Safety net for a public repo: no personal contact strings in anything we ship
    leaks = [p for p in dst.rglob("*") if p.is_file() and re.search(r"[\w.+-]+@(gmail|naver|daum)\.", p.read_text("utf-8", "ignore"))]
    if leaks:
        sys.exit(f"개인 이메일이 포함된 파일: {leaks}")
    pub = B / "webapp" / "public" / "ai-pulse"
    pub.mkdir(parents=True, exist_ok=True)
    for f in ["pulse.html", "economy.html"]:
        shutil.copy2(ROOT / "2_결과물" / "web" / "ai-pulse" / f, pub / f)
    sd = B / "sample_data"
    sd.mkdir(exist_ok=True)
    for f in ["pulse.json", "economy.json"]:
        shutil.copy2(ROOT / "2_결과물" / "web" / "data" / f, sd / f)
    n = sum(1 for p in B.rglob("*") if p.is_file())
    print(f"묶음 갱신: {B.relative_to(ROOT.parent)} (파일 {n}개)")


if __name__ == "__main__":
    main()
