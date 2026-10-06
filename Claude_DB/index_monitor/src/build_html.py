"""data/out/data.json 을 web/template.html 의 __DATA__ 자리에 넣어 web/index_monitor.html 생성.

실행(프로젝트 루트에서): python src/build_html.py
결과물은 단일 HTML 파일이라 브라우저로 바로 열 수 있다 (외부 의존: Google Fonts 만).
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
data = (ROOT / "data/out/data.json").read_text(encoding="utf-8").replace("</", "<\\/")
tpl = (ROOT / "web/template.html").read_text(encoding="utf-8")
assert "__DATA__" in tpl, "template.html 에 __DATA__ 자리표시자가 없습니다"
out = ROOT / "web/index_monitor.html"
out.write_text(tpl.replace("__DATA__", data), encoding="utf-8")
print(f"→ {out.relative_to(ROOT)} ({out.stat().st_size:,} bytes)")
