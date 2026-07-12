"""HTML report for /event studies (web page + PDF source charts)."""

from __future__ import annotations

import base64
import html
from io import BytesIO
from pathlib import Path
from typing import Any

PROJECT_DIR = Path(__file__).resolve().parent
DATA_DIR = PROJECT_DIR / "data"
EVENT_HTML_PATH = DATA_DIR / "event.html"
EVENT_META_PATH = DATA_DIR / "event_meta.json"


def _buffer_to_data_uri(buf: BytesIO | bytes | Path | None, mime: str = "image/png") -> str:
    if buf is None:
        return ""
    if isinstance(buf, Path):
        if not buf.is_file():
            return ""
        data = buf.read_bytes()
    elif isinstance(buf, (bytes, bytearray)):
        data = bytes(buf)
    else:
        if getattr(buf, "closed", False):
            return ""
        getvalue = getattr(buf, "getvalue", None)
        if callable(getvalue):
            try:
                data = getvalue()
            except Exception:
                data = b""
        else:
            pos = buf.tell()
            buf.seek(0)
            data = buf.read()
            try:
                buf.seek(pos)
            except Exception:
                pass
    if not data:
        return ""
    encoded = base64.b64encode(data).decode("ascii")
    return f"data:{mime};base64,{encoded}"


def _fmt_pct(value: float | None) -> str:
    if value is None:
        return "n/a"
    return f"{value:+.2f}%"


def resolve_event_public_url(public_url: str = "") -> str:
    """Map SUMMARY_PUBLIC_URL (.../summary) → .../event."""
    from summary_builder import resolve_summary_public_url

    web = (public_url or "").strip() or resolve_summary_public_url()
    web = web.rstrip("/")
    if web.endswith("/summary"):
        return f"{web.rsplit('/summary', 1)[0]}/event"
    if web.endswith("/event"):
        return web
    return f"{web}/event"


def resolve_event_pdf_public_url(public_url: str = "") -> str:
    web = resolve_event_public_url(public_url)
    if web.endswith("/event"):
        return f"{web}.pdf"
    return f"{web.rstrip('/')}/event.pdf"


def render_event_html(
    report: dict[str, Any],
    *,
    public_url: str = "",
    chart_buffers: dict[str, Any] | None = None,
) -> str:
    chart_buffers = chart_buffers or {}
    discovery = report.get("discovery") or {}
    impact = report.get("impact") or {}
    study = report.get("study") or {}
    query = html.escape(str(report.get("query") or discovery.get("query") or ""))
    generated = html.escape(str(report.get("generated_at_display") or ""))
    event_url = resolve_event_public_url(public_url)
    pdf_url = resolve_event_pdf_public_url(public_url)
    base_url = event_url.rstrip("/").removesuffix("/event") if event_url else ""

    css_link = (
        f'<link rel="stylesheet" href="{html.escape(base_url)}/css/styles.css" />'
        if base_url
        else ""
    )
    fonts_link = (
        '<link rel="preconnect" href="https://fonts.googleapis.com" />'
        '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />'
        '<link href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,600;9..40,700'
        '&family=Instrument+Serif&display=swap" rel="stylesheet" />'
    )

    event_rows = []
    for idx, ev in enumerate(discovery.get("events") or [], start=1):
        event_rows.append(
            "<tr>"
            f"<td>{idx}</td>"
            f"<td>{html.escape(str(ev.get('date') or ''))}</td>"
            f"<td>{html.escape(str(ev.get('title') or ''))}</td>"
            f"<td>{html.escape(str(ev.get('note') or ''))}</td>"
            "</tr>"
        )
    events_table = (
        "<table><thead><tr><th>#</th><th>Date</th><th>Title</th><th>Note</th></tr></thead>"
        f"<tbody>{''.join(event_rows)}</tbody></table>"
        if event_rows
        else "<p class='meta'>No event dates</p>"
    )

    impact_cards = []
    for row in impact.get("countries") or []:
        imp = row.get("impact") or {}
        tone = html.escape(str(imp.get("tone") or "muted"))
        horizons = row.get("horizons") or {}
        impact_cards.append(
            f"""<article class="impact-card tone-{tone}">
  <h3>{html.escape(str(row.get('country_ko') or row.get('country') or ''))}
    <span class="badge">{html.escape(str(imp.get('label') or ''))}</span></h3>
  <p>{html.escape(str(imp.get('summary_ko') or ''))}</p>
  <p class="meta">+30일 {_fmt_pct(horizons.get('d30'))}
    · +60일 {_fmt_pct(horizons.get('d60'))}
    · +90일 {_fmt_pct(horizons.get('d90'))}</p>
</article>"""
        )

    chart_sections = []
    bar_uri = _buffer_to_data_uri(chart_buffers.get("horizon_bars"))
    if bar_uri:
        chart_sections.append(
            f"<section class='card-section'><h2>30·60·90일 평균 수익률</h2>"
            f"<img src='{bar_uri}' alt='horizon bars' /></section>"
        )
    avg_uri = _buffer_to_data_uri(chart_buffers.get("average"))
    if avg_uri:
        chart_sections.append(
            f"<section class='card-section'><h2>평균 경로 (t=0)</h2>"
            f"<img src='{avg_uri}' alt='average path' /></section>"
        )
    for panel in study.get("panels") or []:
        date_str = panel.get("event_date_str") or ""
        uri = _buffer_to_data_uri(chart_buffers.get(date_str))
        if not uri:
            continue
        title = html.escape(str(panel.get("title") or date_str))
        chart_sections.append(
            f"<section class='card-section'><h2>Event {html.escape(date_str)} — {title}</h2>"
            f"<img src='{uri}' alt='event {html.escape(date_str)}' /></section>"
        )

    pdf_link = (
        f' · <a href="{html.escape(pdf_url)}">PDF</a>' if pdf_url else ""
    )
    narrative = html.escape(str(impact.get("narrative_ko") or "")).replace("\n", "<br/>")

    return f"""<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SavvyETF /event — {query}</title>
  {fonts_link}
  {css_link}
  <style>
    :root {{
      --bg: #0b1018; --panel: #141d2b; --border: #2b3648;
      --text: #e8eef5; --muted: #8fa3b8; --accent: #4da3ff;
    }}
    body {{
      margin: 0; background: var(--bg); color: var(--text);
      font-family: "DM Sans", system-ui, sans-serif; line-height: 1.5;
    }}
    .summary-wrap {{ max-width: 1100px; margin: 0 auto; padding: 24px 16px 48px; }}
    .summary-hero {{
      margin-bottom: 2rem; padding: 1.5rem; border: 1px solid var(--border);
      border-radius: 14px; background: var(--panel);
    }}
    .summary-hero h1 {{ font-family: "Instrument Serif", Georgia, serif; font-size: 1.75rem; margin: 0 0 0.5rem; }}
    .brand {{ display: flex; align-items: center; gap: 10px; font-weight: 700; margin-bottom: 1rem; }}
    .brand-dot {{ width: 9px; height: 9px; border-radius: 50%; background: var(--accent); }}
    .card-section {{
      margin: 1.5rem 0; padding: 1.25rem; border: 1px solid var(--border);
      border-radius: 12px; background: var(--panel);
    }}
    .card-section img {{ width: 100%; border-radius: 8px; border: 1px solid var(--border); }}
    .impact-grid {{ display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }}
    .impact-card {{
      padding: 12px; border-radius: 10px; border: 1px solid var(--border);
      background: rgba(255,255,255,0.02);
    }}
    .impact-card.tone-negative {{ border-color: #f87171; }}
    .impact-card.tone-positive {{ border-color: #3dd686; }}
    .impact-card.tone-neutral {{ border-color: #fbbf24; }}
    .badge {{
      font-size: 0.75rem; margin-left: 8px; padding: 2px 8px; border-radius: 999px;
      border: 1px solid var(--border); color: var(--muted);
    }}
    table {{ width: 100%; border-collapse: collapse; font-size: 0.9rem; color: var(--text); }}
    th, td {{ padding: 6px 4px; border-bottom: 1px solid var(--border); text-align: left; }}
    th {{ color: var(--muted); font-weight: 500; }}
    .meta {{ color: var(--muted); font-size: 0.9rem; }}
    a {{ color: var(--accent); }}
    h2 {{ margin: 0 0 0.75rem; font-size: 1.2rem; color: var(--text); }}
    h3 {{ margin: 0 0 0.4rem; font-size: 1.05rem; color: var(--text); }}
    p {{ color: var(--text); }}
  </style>
</head>
<body>
  <div class="summary-wrap">
    <header class="summary-hero">
      <div class="brand"><span class="brand-dot"></span> SavvyETF /event</div>
      <h1>{query}</h1>
      <p class="meta">{generated}{pdf_link}</p>
      <p class="meta">비교 지수: 미국(^GSPC) · 일본(^N225) · 한국(^KS11) · 중국(MCHI)</p>
    </header>

    <section class="card-section">
      <h2>과거 유사 사례</h2>
      <p class="meta">{html.escape(str(discovery.get('summary_ko') or ''))}</p>
      {events_table}
    </section>

    <section class="card-section">
      <h2>국가별 영향 판단</h2>
      <p>{narrative}</p>
      <div class="impact-grid" style="margin-top:1rem">{''.join(impact_cards)}</div>
    </section>

    {''.join(chart_sections)}
  </div>
</body>
</html>
"""


def save_event_html(html_content: str, path: Path | None = None) -> Path:
    out = path or EVENT_HTML_PATH
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html_content, encoding="utf-8")
    return out


def load_event_html() -> str | None:
    if EVENT_HTML_PATH.is_file():
        return EVENT_HTML_PATH.read_text(encoding="utf-8")
    return None
