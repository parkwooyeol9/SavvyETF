"""Telegram pipeline for /idx global index dashboard."""

from __future__ import annotations

from typing import Any

from idx_data import build_idx_dashboard


def _fmt_pct(value: float | None, *, signed: bool = True) -> str:
    if value is None:
        return "n/a"
    return f"{value:+.2f}%" if signed else f"{value:.2f}%"


def _fmt_ret_block(pack: dict[str, Any] | None, *, label: str) -> str:
    if not pack:
        return f"{label}: n/a"
    if pack.get("note") and pack.get("return_pct") is None and not pack.get("error"):
        return f"{label}: {pack['note']}"
    if pack.get("error") and pack.get("return_pct") is None:
        err = pack.get("error")
        if err in {"n/a"}:
            return f"{label}: n/a"
        return f"{label}: n/a ({err})"
    asof = pack.get("asof") or ""
    asof_bit = f" · {asof}" if asof else ""
    sym = pack.get("symbol") or ""
    sym_bit = f" <code>{sym}</code>" if sym else ""
    return f"{label}{sym_bit}: <b>{_fmt_pct(pack.get('return_pct'))}</b>{asof_bit}"


def format_idx_telegram(dashboard: dict[str, Any]) -> list[dict]:
    messages: list[dict] = []

    # Message 1: MSCI country weight top5
    lines = [
        "<b>🌍 /idx — MSCI country weights</b>",
        f"<i>{dashboard.get('generated_at', '')}</i>",
        "",
    ]
    for key in ("acwi", "world", "eem"):
        pack = (dashboard.get("packs") or {}).get(key) or {}
        lines.append(f"<b>{pack.get('label', key)}</b> · ETF {pack.get('etf', '')}")
        top5 = pack.get("top5") or []
        if not top5:
            lines.append("  (weights unavailable)")
        else:
            for idx, (country, weight) in enumerate(top5, start=1):
                lines.append(f"  {idx}. {country} — <b>{weight:.2f}%</b>")
        lines.append(f"<i>{pack.get('source', '')}</i>")
        lines.append("")
    majors = dashboard.get("major_countries") or []
    lines.append("<b>Major countries (union of top5s)</b>")
    lines.append(" · ".join(majors) if majors else "(none)")
    messages.append({"text": "\n".join(lines).strip(), "parse_mode": "HTML"})

    # Message 2: market board
    board = [
        "<b>📈 Major markets — index / futures / FX</b>",
        "Latest Yahoo daily close-to-close returns",
        "",
    ]
    for row in dashboard.get("markets") or []:
        country = row.get("country") or "?"
        if row.get("error"):
            board.append(f"<b>{country}</b> — {row['error']}")
            board.append("")
            continue
        board.append(
            f"<b>{country}</b> · {row.get('index_name')} (<code>{row.get('index_symbol')}</code>)"
        )
        board.append(_fmt_ret_block(row.get("index"), label="Index"))
        fut_label = "Futures"
        if row.get("futures_name"):
            fut_label = f"Futures ({row['futures_name']})"
        elif not row.get("futures_symbol"):
            fut_label = "Futures"
        board.append(_fmt_ret_block(row.get("futures"), label=fut_label))
        fx_label = "FX"
        if row.get("fx_name"):
            fx_label = f"FX ({row['fx_name']})"
        board.append(_fmt_ret_block(row.get("fx"), label=fx_label))
        board.append("")

    for note in dashboard.get("notes") or []:
        board.append(f"<i>{note}</i>")
    board.append("<i>Not financial advice.</i>")
    messages.append({"text": "\n".join(board).strip(), "parse_mode": "HTML"})
    return messages


def run_idx_dashboard() -> dict:
    dashboard = build_idx_dashboard()
    return {
        "dashboard": dashboard,
        "telegram_messages": format_idx_telegram(dashboard),
    }
