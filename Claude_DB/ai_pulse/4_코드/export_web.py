"""AI Pulse → SavvyETF 홈페이지용 내보내기.

로컬 HTML(데이터가 들어 있는 단일 파일)과 달리, 홈페이지에는 '화면 틀(shell)'과 '데이터(JSON)'를 따로 둡니다.
틀은 git(webapp/public/ai-pulse/)에 한 번 커밋하고, 데이터는 매일 R2에 올려 API가 내려줍니다 → git에 데이터가 쌓이지 않습니다.

    python3 4_코드/export_web.py               # 2_결과물/web/ 에 JSON·틀 생성 (로컬 확인용)
    python3 4_코드/export_web.py --upload      # + R2 업로드 (SavvyETF 저장소의 r2_data.py, R2_* 환경변수 필요)

결과:
  2_결과물/web/data/pulse.json, economy.json      화면 데이터
  2_결과물/web/ai-pulse/pulse.html, economy.html   화면 틀 → webapp/public/ai-pulse/ 로 복사
R2 키: ai_pulse/pulse/latest.json, ai_pulse/economy/latest.json (+ 같은 폴더 snapshots/YYYY-MM-DD.json)
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
WEB = ROOT / "2_결과물" / "web"
sys.path.insert(0, str(HERE))

import build_dashboard  # noqa: E402
import build_economy  # noqa: E402

R2_KEYS = {"pulse": "ai_pulse/pulse/latest.json", "economy": "ai_pulse/economy/latest.json"}
API = "/api/ai-pulse?page={page}"
# Sections left out of the public payload until their redistribution terms are confirmed (see HANDOFF D2)
PUBLIC_DROP = {"economy": ["memory"]}

# Replaces the inline payload: fetch the JSON, theme from ?theme=, report height to a parent iframe.
LOADER = r"""const __Q=new URLSearchParams(location.search);
if(__Q.get('theme'))document.documentElement.dataset.theme=__Q.get('theme');
if(__Q.get('embed')){const st=document.createElement('style');  // inside the SavvyETF tab: let the site's background show through
  st.textContent='body{background:transparent!important}.wrap{padding-top:4px!important;max-width:none!important}header h1{font-size:22px}nav{background:transparent;position:static}';document.head.append(st);}
(function(){const send=()=>parent!==window&&parent.postMessage({type:'ai-pulse-height',page:document.documentElement.dataset.page,h:document.documentElement.scrollHeight},'*');
  try{new ResizeObserver(send).observe(document.body);}catch(e){addEventListener('resize',send);}addEventListener('load',send);})();
(async()=>{let P;
try{const r=await fetch(__Q.get('src')||document.documentElement.dataset.src,{cache:'no-store'});if(!r.ok)throw new Error('HTTP '+r.status);P=await r.json();}
catch(e){const d=document.createElement('p');d.className='note';d.style.padding='24px';d.textContent='데이터를 불러오지 못했습니다 ('+e.message+'). 잠시 후 다시 시도해 주세요.';document.querySelector('.wrap').prepend(d);return;}
"""


def shell(html: str, page: str) -> str:
    """Turn a self-contained page into a data-less shell that loads its JSON at runtime."""
    assert "const P=__PAYLOAD__;" in html, "template changed: payload marker not found"
    html = html.replace("const P=__PAYLOAD__;", LOADER, 1)
    i = html.rindex("</script>")
    html = html[:i] + "\n})();\n" + html[i:]
    html = html.replace('<html lang="ko">', f'<html lang="ko" data-page="{page}" data-src="{API.format(page=page)}">', 1)
    # links between the two pages stay inside the iframe
    return html.replace('href="ai_economy.html"', 'href="economy.html"').replace('href="ai_pulse.html"', 'href="pulse.html"')


def templates() -> dict[str, str]:
    base = (HERE / "template.html").read_text(encoding="utf-8")
    style = base[base.index("<style>"):base.index("</style>") + len("</style>")]
    helpers = base[base.index("const NS="):base.index("// ---------- 한눈에")]
    econ = (HERE / "template_economy.html").read_text(encoding="utf-8").replace("__STYLE__", style).replace("__HELPERS__", helpers)
    return {"pulse": base, "economy": econ}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--upload", action="store_true", help="R2 업로드 (SAVVYETF_DIR 의 r2_data.py 사용)")
    ap.add_argument("--keep-all", action="store_true", help="PUBLIC_DROP 섹션도 포함 (비공개 용도)")
    a = ap.parse_args()
    payloads = {"pulse": build_dashboard.build(), "economy": build_economy.build()}
    if not a.keep_all:
        for page, keys in PUBLIC_DROP.items():
            for k in keys:
                payloads[page].pop(k, None)
    (WEB / "data").mkdir(parents=True, exist_ok=True)
    (WEB / "ai-pulse").mkdir(parents=True, exist_ok=True)
    for page, P in payloads.items():
        P["page"] = page
        out = WEB / "data" / f"{page}.json"
        out.write_text(json.dumps(P, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        print(f"저장: {out.relative_to(ROOT)} ({out.stat().st_size / 1e3:.0f} KB)")
    for page, html in templates().items():
        out = WEB / "ai-pulse" / f"{page}.html"
        out.write_text(shell(html, page), encoding="utf-8")
        print(f"저장: {out.relative_to(ROOT)} ({out.stat().st_size / 1e3:.0f} KB)")
    if a.upload:
        repo = Path(os.environ.get("SAVVYETF_DIR", Path.home() / "GitHub" / "SavvyETF"))
        # r2_data.py moved from the repo root to 10_공통/ on 2026-10-12 (68035ad). Keep the root for older checkouts.
        sys.path[:0] = [str(repo / "10_공통"), str(repo)]
        try:
            import r2_data  # SavvyETF/10_공통/r2_data.py — reads R2_* env vars
        except ImportError as e:
            sys.exit(f"r2_data.py를 찾지 못함 ({repo}): {e}")
        for page, P in payloads.items():
            ok = r2_data.put_json_daily(R2_KEYS[page], P, day=str(P.get("generated", ""))[:10])
            print(f"R2 {'업로드' if ok else '실패(R2_* 환경변수 확인)'}: {R2_KEYS[page]}")


if __name__ == "__main__":
    main()
