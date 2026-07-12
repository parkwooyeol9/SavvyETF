"""WSB Reddit brief orchestrator: crawl + financial top-2 + HTML/PDF (/reddit)."""

from __future__ import annotations

import html
import json
from pathlib import Path
from typing import Any

from financial_data import _format_large_number, _format_multiple, _format_pct
from financial_pipeline import run_financial_analysis
from reddit_wsb import format_reddit_telegram, generate_reddit_brief
from summary_builder import (
    _as_photo_buffer,
    _buffer_to_data_uri,
    _freeze_chart_buffer,
    format_summary_pdf_message,
    resolve_summary_public_url,
)

PROJECT_DIR = Path(__file__).resolve().parent
DATA_DIR = PROJECT_DIR / "data"
REDDIT_HTML_PATH = DATA_DIR / "reddit.html"
REDDIT_META_PATH = DATA_DIR / "reddit_meta.json"
REDDIT_PDF_PATH = DATA_DIR / "reddit.pdf"

TOP_FINANCIAL_COUNT = 2
# Index / leveraged products rarely have usable equity fundamentals.
SKIP_FINANCIAL_TICKERS = {
    "IWM",
    "QQQ",
    "SOXL",
    "SPX",
    "SPY",
    "TNA",
    "TQQQ",
    "UVXY",
}


def resolve_reddit_public_url(public_url: str = "") -> str:
    web = public_url.strip() if public_url else resolve_summary_public_url()
    if web.endswith("/summary"):
        return f"{web.rsplit('/summary', 1)[0]}/reddit"
    if web.endswith("/reddit"):
        return web
    return f"{web.rstrip('/')}/reddit"


def resolve_reddit_pdf_public_url(public_url: str = "") -> str:
    web = resolve_reddit_public_url(public_url)
    if web.endswith("/reddit"):
        return f"{web}.pdf"
    return f"{web.rstrip('/')}/reddit.pdf"


def _top_financial_symbols(tickers: list[tuple[str, int]], limit: int = TOP_FINANCIAL_COUNT) -> list[str]:
    picked: list[str] = []
    for symbol, _count in tickers:
        sym = str(symbol).upper().strip()
        if not sym or sym in SKIP_FINANCIAL_TICKERS or sym in picked:
            continue
        picked.append(sym)
        if len(picked) >= limit:
            break
    return picked


def _attach_top_financials(brief: dict[str, Any]) -> list[dict[str, Any]]:
    symbols = _top_financial_symbols(list(brief.get("tickers") or []))
    packs: list[dict[str, Any]] = []
    for symbol in symbols:
        try:
            result = run_financial_analysis(symbol)
            packs.append(
                {
                    "symbol": symbol,
                    "mention_count": next(
                        (n for t, n in (brief.get("tickers") or []) if str(t).upper() == symbol),
                        None,
                    ),
                    "profile": result["profile"],
                    "chart": result["chart"],
                    "text_summary": result["text_summary"],
                    "telegram_messages": result["telegram_messages"],
                }
            )
        except Exception as exc:
            packs.append({"symbol": symbol, "error": str(exc)})
            print(f"Reddit financial analysis failed ({symbol}): {exc}")
    return packs


def _freeze_reddit_charts(brief: dict[str, Any]) -> None:
    for pack in brief.get("financials") or []:
        if not isinstance(pack, dict):
            continue
        if pack.get("chart") is not None:
            pack["chart"] = _freeze_chart_buffer(pack.get("chart"))
        # Keep telegram photo payloads on frozen bytes (avoid closed BytesIO).
        refreshed: list[dict] = []
        for msg in pack.get("telegram_messages") or []:
            if not isinstance(msg, dict):
                continue
            out = {k: v for k, v in msg.items() if k != "photo"}
            if "photo" in msg and pack.get("chart") is not None:
                out["photo"] = pack["chart"]
            refreshed.append(out)
        if refreshed:
            pack["telegram_messages"] = refreshed


def _metric_rows(profile: dict[str, Any]) -> list[tuple[str, str]]:
    metrics = profile.get("metrics") or {}
    rows = [
        ("PER (TTM)", _format_multiple(metrics.get("per"))),
        ("Forward PER", _format_multiple(metrics.get("forward_per"))),
        ("PBR", _format_multiple(metrics.get("pbr"))),
        ("Market cap", _format_large_number(metrics.get("market_cap"))),
        ("ROE", _format_pct(metrics.get("roe"))),
        ("Gross margin", _format_pct(metrics.get("gross_margin"))),
        ("Operating margin", _format_pct(metrics.get("operating_margin"))),
        ("Net margin", _format_pct(metrics.get("net_margin"))),
        ("EPS growth YoY", _format_pct(metrics.get("eps_growth_yoy"), signed=True)),
        ("Revenue growth YoY", _format_pct(metrics.get("revenue_growth_yoy"), signed=True)),
    ]
    if metrics.get("eps_ttm") is not None:
        rows.append(("EPS (TTM)", f"{metrics['eps_ttm']:.2f}"))
    if metrics.get("dividend_yield") is not None:
        rows.append(("Dividend yield", _format_pct(metrics.get("dividend_yield"))))
    if metrics.get("beta") is not None:
        rows.append(("Beta", f"{metrics['beta']:.2f}"))
    return rows


def _render_financials_html(brief: dict[str, Any]) -> str:
    packs = brief.get("financials") or []
    if not packs:
        return ""
    cards: list[str] = []
    for pack in packs:
        symbol = html.escape(str(pack.get("symbol") or ""))
        if pack.get("error"):
            cards.append(
                f"""
                <div class="fin-card">
                  <h3>${symbol}</h3>
                  <p class="meta">Financial analysis unavailable: {html.escape(str(pack['error']))}</p>
                </div>
                """
            )
            continue
        profile = pack.get("profile") or {}
        name = html.escape(str(profile.get("company_name") or symbol))
        sector = html.escape(str(profile.get("sector") or "n/a"))
        mention = pack.get("mention_count")
        mention_bit = f" · WSB mentions ×{mention}" if mention else ""
        data_uri = _buffer_to_data_uri(pack.get("chart"), "image/png")
        img = (
            f'<img src="{data_uri}" alt="{symbol} financial chart" />'
            if data_uri
            else "<p class='meta'>Chart unavailable</p>"
        )
        rows = "".join(
            f"<tr><th>{html.escape(label)}</th><td>{html.escape(value)}</td></tr>"
            for label, value in _metric_rows(profile)
        )
        cards.append(
            f"""
            <div class="fin-card">
              <h3>${symbol} · {name}</h3>
              <p class="meta">{sector}{html.escape(mention_bit)}</p>
              {img}
              <table><tbody>{rows}</tbody></table>
            </div>
            """
        )
    return f"""
    <section class="appendix-section">
      <h2>📊 Financial analysis (top mentions)</h2>
      <p class="meta">Same pipeline as /financial · Finnhub + Yahoo · top {TOP_FINANCIAL_COUNT} equity tickers</p>
      <div class="leader-grid">{''.join(cards)}</div>
    </section>
    """


def render_reddit_html(brief: dict[str, Any], public_url: str = "") -> str:
    reddit_url = resolve_reddit_public_url(public_url)
    pdf_url = resolve_reddit_pdf_public_url(public_url)
    base_url = reddit_url.rstrip("/").removesuffix("/reddit")
    title = f"SavvyETF Reddit / WSB — {brief.get('generated_at_display', '')}"

    posts = brief.get("posts") or []
    post_rows: list[str] = []
    for idx, post in enumerate(posts[:20], start=1):
        title_text = html.escape(str(post.get("title") or "").strip())
        url = html.escape(str(post.get("permalink") or post.get("url") or "#"))
        meta_bits: list[str] = []
        if post.get("flair"):
            meta_bits.append(html.escape(str(post["flair"])))
        if post.get("score") is not None:
            meta_bits.append(f"▲{post['score']}")
        if post.get("num_comments") is not None:
            meta_bits.append(f"💬{post['num_comments']}")
        tick = post.get("tickers") or []
        tick_html = (
            f"<span class='meta'>${' $'.join(html.escape(str(t)) for t in tick[:6])}</span>"
            if tick
            else ""
        )
        meta = " · ".join(meta_bits)
        post_rows.append(
            f"<li><a href=\"{url}\" target=\"_blank\" rel=\"noopener\">{idx}. {title_text}</a>"
            f"<span class='meta'>{meta}</span>{tick_html}</li>"
        )

    tickers = brief.get("tickers") or []
    ticker_pills = "".join(
        f'<span class="pill">${html.escape(str(t))} ×{n}</span>' for t, n in tickers[:12]
    ) or '<span class="pill">No clear ticker cluster</span>'

    ai = brief.get("ai") or {}
    themes = ai.get("themes_ko") or []
    themes_html = (
        " · ".join(html.escape(str(t)) for t in themes) if themes else "(none)"
    )
    focus = html.escape(str(ai.get("investor_focus_ko") or "").strip())
    summary_ko = html.escape(str(ai.get("ai_summary_ko") or "").strip()).replace("\n", "<br/>")

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

    return f"""<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{html.escape(title)}</title>
  {fonts_link}
  {css_link}
  <style>
    body {{ margin: 0; }}
    .summary-wrap {{ max-width: 1100px; margin: 0 auto; padding: 24px 16px 48px; }}
    .summary-hero {{
      margin-bottom: 2rem; padding: 1.5rem; border: 1px solid var(--border, #2b3648);
      border-radius: var(--radius, 14px); background: var(--panel, #141d2b);
    }}
    .summary-hero h1 {{ font-family: var(--serif, Georgia, serif); font-size: 1.75rem; margin: 0 0 0.5rem; }}
    .brand {{ display: flex; align-items: center; gap: 10px; font-weight: 700; margin-bottom: 1rem; }}
    .brand-dot {{ width: 9px; height: 9px; border-radius: 50%; background: #ff4500; }}
    .pill-row {{ display: flex; flex-wrap: wrap; gap: 8px; margin-top: 1rem; }}
    .pill {{
      font-size: 0.8rem; padding: 4px 10px; border-radius: 999px;
      border: 1px solid var(--border, #2b3648); color: var(--muted, #8fa3b8);
    }}
    h2 {{ margin: 0 0 0.75rem; font-size: 1.25rem; }}
    h3 {{ margin: 0 0 0.5rem; font-size: 1.05rem; color: var(--accent, #4da3ff); }}
    .meta {{ color: var(--muted, #8fa3b8); font-size: 0.9rem; display: block; margin-top: 2px; }}
    .appendix-section, .card-section {{
      margin: 1.5rem 0; padding: 1.25rem; border: 1px solid var(--border, #2b3648);
      border-radius: 12px; background: var(--panel, #141d2b);
    }}
    .leader-grid {{ display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }}
    .fin-card {{
      background: rgba(255,255,255,0.02); border: 1px solid var(--border, #2b3648);
      border-radius: 10px; padding: 12px;
    }}
    .fin-card img {{
      width: 100%; border-radius: 8px; border: 1px solid var(--border, #2b3648); margin: 0.75rem 0;
    }}
    table {{ width: 100%; border-collapse: collapse; font-size: 0.88rem; }}
    th, td {{ padding: 5px 4px; border-bottom: 1px solid var(--border, #2b3648); text-align: left; }}
    th {{ color: var(--muted, #8fa3b8); font-weight: 500; width: 45%; }}
    ul.posts {{ margin: 0; padding-left: 18px; }}
    ul.posts li {{ margin-bottom: 10px; }}
    a {{ color: #4da3ff; }}
    .ai-box {{
      white-space: normal; line-height: 1.55; color: var(--text, #e8eef5);
      background: rgba(255,69,0,0.06); border-left: 3px solid #ff4500; padding: 0.75rem 1rem;
    }}
    .summary-footer {{
      margin-top: 2rem; padding-top: 1rem; border-top: 1px solid var(--border, #2b3648);
      color: var(--muted, #8fa3b8); font-size: 0.85rem;
    }}
  </style>
</head>
<body>
  <div class="summary-wrap">
    <div class="brand"><span class="brand-dot"></span> SavvyETF</div>
    <section class="summary-hero">
      <h1>{html.escape(title)}</h1>
      <p class="meta">r/wallstreetbets · source={html.escape(str(brief.get('crawl_source', '?')))} · Gemini KR · /financial top {TOP_FINANCIAL_COUNT}</p>
      <p class="meta">Live: <a href="{html.escape(reddit_url)}">{html.escape(reddit_url)}</a>
         · <a href="{html.escape(pdf_url)}">PDF</a>
         · US brief: <a href="{html.escape(base_url + '/summary') if base_url else '/summary'}">/summary</a></p>
      <div class="pill-row">
        <span class="pill">r/wallstreetbets</span>
        <span class="pill">Gemini</span>
        <span class="pill">/financial ×{TOP_FINANCIAL_COUNT}</span>
        <span class="pill">PDF</span>
      </div>
    </section>

    <section class="card-section">
      <h2>👀 Investor interest tickers</h2>
      <div class="pill-row">{ticker_pills}</div>
      <p class="meta" style="margin-top:1rem">Themes: {themes_html}</p>
      {"<p class='meta'>" + focus + "</p>" if focus else ""}
    </section>

    <section class="card-section">
      <h2>🤖 Gemini WSB summary</h2>
      <div class="ai-box">{summary_ko or "(요약 없음)"}</div>
      <p class="meta">AI source: {html.escape(str(ai.get('source', 'rules')))}</p>
    </section>

    <section class="card-section">
      <h2>📌 Hot posts</h2>
      <ul class="posts">{''.join(post_rows) or "<li class='meta'>No posts</li>"}</ul>
    </section>

    {_render_financials_html(brief)}

    <footer class="summary-footer">
      SavvyETF Reddit / WSB · Generated {html.escape(str(brief.get('generated_at_display', '')))} · Not financial advice
    </footer>
  </div>
</body>
</html>"""


def save_reddit(brief: dict[str, Any], html_content: str) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    REDDIT_HTML_PATH.write_text(html_content, encoding="utf-8")
    meta = {
        "generated_at_display": brief.get("generated_at_display"),
        "crawl_source": brief.get("crawl_source"),
        "ticker_count": len(brief.get("tickers") or []),
        "financial_symbols": [
            p.get("symbol") for p in (brief.get("financials") or []) if isinstance(p, dict)
        ],
        "has_pdf": bool(brief.get("pdf_path")),
        "kind": "reddit",
    }
    REDDIT_META_PATH.write_text(json.dumps(meta, indent=2), encoding="utf-8")


def load_reddit_html() -> str | None:
    if REDDIT_HTML_PATH.exists():
        return REDDIT_HTML_PATH.read_text(encoding="utf-8")
    return None


def _minimal_reddit_html(brief: dict[str, Any], public_url: str = "", *, error: str = "") -> str:
    when = html.escape(str(brief.get("generated_at_display", "")))
    err = html.escape(error) if error else ""
    reddit_url = resolve_reddit_public_url(public_url)
    pdf_url = resolve_reddit_pdf_public_url(public_url)
    detail = f"<p class='meta'>HTML render note: {err}</p>" if err else ""
    return f"""<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8"><title>SavvyETF Reddit / WSB</title>
<style>body{{font-family:system-ui,sans-serif;background:#0b1018;color:#e8eef5;padding:2rem}}
a{{color:#4da3ff}}.meta{{color:#8fa3b8}}</style></head>
<body>
  <h1>SavvyETF Reddit / WSB</h1>
  <p class="meta">{when}</p>
  <p>Full web layout was unavailable, but the brief was generated.</p>
  <p><a href="{html.escape(pdf_url)}">Download PDF</a> · <a href="{html.escape(reddit_url)}">/reddit</a></p>
  {detail}
  <p class="meta">Re-run /reddit if this page looks incomplete.</p>
</body></html>"""


def render_reddit_telegram_full(brief: dict[str, Any], public_url: str = "") -> list[dict]:
    messages = format_reddit_telegram(brief)

    for pack in brief.get("financials") or []:
        if not isinstance(pack, dict):
            continue
        symbol = pack.get("symbol") or "?"
        if pack.get("error"):
            messages.append({"text": f"📊 /financial ${symbol} unavailable: {pack['error']}"})
            continue
        # Prefer pipeline telegram payloads; rebuild photo from frozen bytes if needed.
        for msg in pack.get("telegram_messages") or []:
            out = dict(msg)
            if "photo" in out:
                photo = _as_photo_buffer(out.get("photo") or pack.get("chart"))
                if photo is None:
                    out.pop("photo", None)
                else:
                    out["photo"] = photo
            messages.append(out)
        if not pack.get("telegram_messages"):
            photo = _as_photo_buffer(pack.get("chart"))
            caption = f"📊 Financial — ${symbol}"
            if photo is not None:
                messages.append({"text": caption, "photo": photo})
            if pack.get("text_summary"):
                messages.append({"text": pack["text_summary"], "parse_mode": "HTML"})

    reddit_web = resolve_reddit_public_url(public_url)
    pdf_url = resolve_reddit_pdf_public_url(public_url)
    messages.append(
        {
            "text": (
                f"🟠 Reddit / WSB brief (web): {reddit_web}\n"
                f"📄 PDF: {pdf_url}"
            )
        }
    )
    pdf_message = format_summary_pdf_message(brief, public_url or reddit_web)
    if pdf_message:
        messages.append(pdf_message)
    elif brief.get("pdf_error"):
        messages.append({"text": f"PDF export unavailable: {brief['pdf_error']}"})
    return messages


def generate_and_save_reddit_brief(public_url: str = "") -> dict[str, Any]:
    brief = generate_reddit_brief()
    brief["kind"] = "reddit"
    brief["financials"] = _attach_top_financials(brief)
    _freeze_reddit_charts(brief)

    reddit_web = resolve_reddit_public_url(public_url)

    try:
        html_content = render_reddit_html(brief, public_url=public_url or reddit_web)
        save_reddit(brief, html_content)
        brief["html"] = html_content
    except Exception as exc:
        brief["html_error"] = str(exc)
        print(f"Reddit HTML export failed: {exc}")
        try:
            stub = _minimal_reddit_html(brief, public_url or reddit_web, error=str(exc))
            save_reddit(brief, stub)
            brief["html"] = stub
        except Exception as stub_exc:
            print(f"Reddit HTML stub also failed: {stub_exc}")

    try:
        from summary_pdf import REDDIT_PDF_PATH as PDF_OUT, build_summary_pdf_safe

        pdf_path = build_summary_pdf_safe(brief, output_path=PDF_OUT)
        brief["pdf_path"] = str(pdf_path)
        # Refresh meta now that PDF exists.
        if brief.get("html"):
            save_reddit(brief, brief["html"])
    except Exception as exc:
        brief["pdf_path"] = None
        brief["pdf_error"] = str(exc)
        print(f"Reddit PDF export skipped: {exc}")

    brief["telegram_messages"] = render_reddit_telegram_full(brief, public_url or reddit_web)
    return brief
