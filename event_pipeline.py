"""Telegram pipeline for /event historical event studies."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from event_charts import (
    plot_average_across_events,
    plot_event_country_overlay,
    save_event_charts,
)
from event_discover import discover_event_dates
from event_study import EVENT_STUDY_COUNTRIES, WINDOW_DAYS, run_event_study

KST = ZoneInfo("Asia/Seoul")


def _format_dates_message(discovery: dict[str, Any]) -> str:
    lines = [
        f"<b>📅 Event dates — {discovery.get('query', '')}</b>",
        f"<i>source: {discovery.get('source', '')}</i>",
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
    saved = discovery.get("saved_path")
    if saved:
        lines.append("")
        lines.append(f"<code>saved: {saved}</code>")
    lines.append("")
    countries = " · ".join(EVENT_STUDY_COUNTRIES)
    lines.append(
        f"Comparing <b>/idx</b> country indices (±{WINDOW_DAYS}d, t=0 = event):\n{countries}"
    )
    return "\n".join(lines).strip()


def run_event_pipeline(query: str) -> dict[str, Any]:
    query = (query or "").strip()
    if not query:
        raise ValueError("empty event query")

    run_id = datetime.now(KST).strftime("%Y%m%d_%H%M%S")
    discovery = discover_event_dates(query)
    study = run_event_study(discovery.get("events") or [])
    chart_paths = save_event_charts(study, run_id=run_id, query=query)

    telegram_messages: list[dict[str, Any]] = [
        {"text": _format_dates_message(discovery), "parse_mode": "HTML"},
    ]

    for panel in study.get("panels") or []:
        if not panel.get("series"):
            err = "; ".join((panel.get("errors") or [])[:3])
            date_str = panel.get("event_date_str") or "?"
            telegram_messages.append(
                {
                    "text": (
                        f"⚠️ {date_str} — no index series"
                        + (f" ({err})" if err else "")
                    )
                }
            )
            continue
        title = panel.get("title") or ""
        caption = f"Event {panel.get('event_date_str')} — country indices (t=0)"
        if title:
            caption = f"{caption}\n{title}"
        buf = plot_event_country_overlay(panel, query=query)
        telegram_messages.append({"text": caption, "photo": buf})

    averages = study.get("averages") or []
    usable_n = sum(1 for p in (study.get("panels") or []) if p.get("series"))
    if averages and usable_n >= 2:
        buf = plot_average_across_events(
            averages, query=query, n_events=usable_n
        )
        telegram_messages.append(
            {
                "text": (
                    f"Average across {usable_n} events — mean path by country (t=0)"
                ),
                "photo": buf,
            }
        )

    if usable_n == 0:
        telegram_messages.append(
            {
                "text": (
                    "No usable index history around the discovered dates. "
                    "Try a more recent / well-known event keyword."
                )
            }
        )

    return {
        "run_id": run_id,
        "query": query,
        "discovery": discovery,
        "study": study,
        "chart_paths": chart_paths,
        "telegram_messages": telegram_messages,
    }
