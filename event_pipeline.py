"""Telegram pipeline for /event historical event studies."""

from __future__ import annotations

import json
from datetime import datetime
from io import BytesIO
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from chart_buffers import snapshot_png_buffer
from event_charts import (
    plot_average_across_events,
    plot_event_country_overlay,
    plot_horizon_bar_chart,
    save_event_charts,
)
from event_discover import discover_event_dates
from event_pdf import EVENT_PDF_PATH, build_event_pdf
from event_report import (
    EVENT_META_PATH,
    render_event_html,
    resolve_event_pdf_public_url,
    resolve_event_public_url,
    save_event_html,
)
from event_study import EVENT_STUDY_COUNTRIES, HORIZON_DAYS, WINDOW_POST_DAYS, run_event_study

KST = ZoneInfo("Asia/Seoul")


def _format_dates_message(discovery: dict[str, Any]) -> str:
    lines = [
        f"<b>📅 Event dates — {discovery.get('query', '')}</b>",
        "",
    ]
    summary = (discovery.get("summary_ko") or "").strip()
    if summary:
        lines.append(summary)
        lines.append("")
    for idx, ev in enumerate(discovery.get("events") or [], start=1):
        title = ev.get("title") or ""
        note = ev.get("note") or ""
        lines.append(f"<b>{idx}. {ev.get('date')}</b> — {title}")
        if note:
            lines.append(f"   <i>{note}</i>")
    lines.append("")
    countries = " · ".join(EVENT_STUDY_COUNTRIES)
    lines.append(
        f"비교 지수 (미국·일본·한국·중국): {countries}\n"
        f"사후 구간: {', '.join(str(d) for d in HORIZON_DAYS)}일 "
        f"(post window {WINDOW_POST_DAYS}d)"
    )
    return "\n".join(lines).strip()


def _format_impact_message(impact: dict[str, Any]) -> str:
    lines = ["<b>🧭 국가별 영향 판단</b>", ""]
    for row in impact.get("countries") or []:
        imp = row.get("impact") or {}
        horizons = row.get("horizons") or {}

        def _p(key: str) -> str:
            v = horizons.get(key)
            return f"{v:+.1f}%" if v is not None else "n/a"

        lines.append(
            f"<b>{row.get('country_ko') or row.get('country')}</b> "
            f"— <b>{imp.get('label') or '?'}</b>"
        )
        lines.append(f"  +30 {_p('d30')} · +60 {_p('d60')} · +90 {_p('d90')}")
        summary = (imp.get("summary_ko") or "").strip()
        if summary:
            lines.append(f"  <i>{summary}</i>")
        lines.append("")
    return "\n".join(lines).strip()


def _freeze_buffers(raw: dict[str, Any]) -> dict[str, BytesIO]:
    frozen: dict[str, BytesIO] = {}
    for key, buf in (raw or {}).items():
        if buf is None:
            continue
        try:
            frozen[key] = snapshot_png_buffer(buf)
        except Exception as exc:
            print(f"event chart freeze skipped ({key}): {exc}")
    return frozen


def _chart_assets(
    buffers: dict[str, BytesIO],
    chart_paths: dict[str, Path],
) -> dict[str, Any]:
    """Prefer in-memory PNG buffers; fall back to saved files for HTML/PDF."""
    assets: dict[str, Any] = {}
    keys = set(buffers) | {k for k, v in chart_paths.items() if isinstance(v, Path)}
    for key in keys:
        if key in buffers:
            assets[key] = buffers[key]
        else:
            path = chart_paths.get(key)
            if isinstance(path, Path) and path.is_file():
                assets[key] = path
    return assets


def run_event_pipeline(query: str, *, public_url: str = "") -> dict[str, Any]:
    query = (query or "").strip()
    if not query:
        raise ValueError("empty event query")

    now = datetime.now(KST)
    run_id = now.strftime("%Y%m%d_%H%M%S")
    generated_at_display = now.strftime("%Y-%m-%d %H:%M KST")

    discovery = discover_event_dates(query)
    study = run_event_study(discovery.get("events") or [], query=query)
    chart_paths_raw = save_event_charts(study, run_id=run_id, query=query)
    raw_buffers = chart_paths_raw.pop("_buffers", {}) if isinstance(chart_paths_raw, dict) else {}
    chart_paths = {
        k: v for k, v in (chart_paths_raw or {}).items() if isinstance(v, Path)
    }

    usable_n = sum(1 for p in (study.get("panels") or []) if p.get("series"))
    averages = study.get("averages") or []
    if averages and "horizon_bars" not in raw_buffers:
        raw_buffers["horizon_bars"] = plot_horizon_bar_chart(
            averages, query=query, n_events=usable_n
        )
    if averages and usable_n >= 1 and "average" not in raw_buffers:
        raw_buffers["average"] = plot_average_across_events(
            averages, query=query, n_events=usable_n
        )
    for panel in study.get("panels") or []:
        date_str = panel.get("event_date_str") or ""
        if panel.get("series") and date_str and date_str not in raw_buffers:
            raw_buffers[date_str] = plot_event_country_overlay(panel, query=query)

    buffers = _freeze_buffers(raw_buffers)
    assets = _chart_assets(buffers, chart_paths)

    report = {
        "kind": "event",
        "query": query,
        "run_id": run_id,
        "generated_at_display": generated_at_display,
        "discovery": discovery,
        "study": study,
        "impact": study.get("impact") or {},
    }

    event_url = resolve_event_public_url(public_url)
    pdf_url = resolve_event_pdf_public_url(public_url)

    html_path = None
    pdf_path = None
    artifacts_errors: list[str] = []

    try:
        html_content = render_event_html(
            report, public_url=public_url, chart_buffers=assets
        )
        html_path = save_event_html(html_content)
    except Exception as exc:
        artifacts_errors.append(f"HTML: {exc}")
        print(f"/event HTML failed: {exc}")

    try:
        pdf_path = build_event_pdf(report, assets, output_path=EVENT_PDF_PATH)
    except Exception as exc:
        artifacts_errors.append(f"PDF: {exc}")
        print(f"/event PDF failed: {exc}")

    meta = {
        "query": query,
        "run_id": run_id,
        "generated_at_display": generated_at_display,
        "html_path": str(html_path) if html_path else "",
        "pdf_path": str(pdf_path) if pdf_path else "",
        "event_url": event_url,
        "pdf_url": pdf_url,
        "n_events": usable_n,
        "countries": list(EVENT_STUDY_COUNTRIES),
        "artifacts_errors": artifacts_errors,
    }
    EVENT_META_PATH.parent.mkdir(parents=True, exist_ok=True)
    EVENT_META_PATH.write_text(
        json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    telegram_messages: list[dict[str, Any]] = [
        {"text": _format_dates_message(discovery), "parse_mode": "HTML"},
        {"text": _format_impact_message(report["impact"]), "parse_mode": "HTML"},
    ]

    if buffers.get("horizon_bars") is not None:
        telegram_messages.append(
            {
                "text": "📊 이벤트 후 30·60·90일 평균 누적수익률 (미국·일본·한국·중국)",
                "photo": buffers["horizon_bars"],
            }
        )

    if averages and usable_n >= 2 and buffers.get("average") is not None:
        telegram_messages.append(
            {
                "text": f"Average path across {usable_n} events (t=0)",
                "photo": buffers["average"],
            }
        )

    shown = 0
    for panel in study.get("panels") or []:
        if shown >= 2:
            break
        if not panel.get("series"):
            continue
        date_str = panel.get("event_date_str") or ""
        buf = buffers.get(date_str)
        if buf is None:
            continue
        title = panel.get("title") or ""
        caption = f"Event {date_str} (t=0)"
        if title:
            caption = f"{caption}\n{title}"
        telegram_messages.append({"text": caption, "photo": buf})
        shown += 1

    if usable_n == 0:
        telegram_messages.append(
            {
                "text": (
                    "No usable index history around the discovered dates. "
                    "Try a more recent / well-known event keyword."
                )
            }
        )
    else:
        links = []
        if event_url:
            links.append(f'<a href="{event_url}">Web</a>')
        if pdf_url:
            links.append(f'<a href="{pdf_url}">PDF</a>')
        link_bit = (" · ".join(links)) if links else ""

        if pdf_path and Path(pdf_path).is_file():
            telegram_messages.append(
                {
                    "text": (
                        f"📄 /event report — {query}"
                        + (f"\n{link_bit}" if link_bit else "")
                    ).strip(),
                    "document_path": str(pdf_path),
                    "parse_mode": "HTML",
                    "button_url": event_url or None,
                    "button_text": "Open web report",
                }
            )
        elif link_bit:
            telegram_messages.append(
                {
                    "text": f"📄 /event report — {query}\n{link_bit}",
                    "parse_mode": "HTML",
                }
            )

        if artifacts_errors:
            telegram_messages.append(
                {
                    "text": "Artifact warning:\n"
                    + "\n".join(f"• {e}" for e in artifacts_errors)
                }
            )

    return {
        "run_id": run_id,
        "query": query,
        "discovery": discovery,
        "study": study,
        "impact": report["impact"],
        "chart_paths": chart_paths,
        "html_path": html_path,
        "pdf_path": pdf_path,
        "telegram_messages": telegram_messages,
    }
