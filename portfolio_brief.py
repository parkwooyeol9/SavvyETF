"""US portfolio telegram brief helpers (future bot broadcast).

The webapp stores ``PortfolioTelegramSnapshot`` in browser localStorage history.
When wiring a weekly bot job, load the snapshot JSON (user paste / R2 / API)
and call ``format_us_portfolio_brief``.
"""

from __future__ import annotations

from typing import Any


def format_us_portfolio_brief(snap: dict[str, Any]) -> str:
    def pct(value: Any) -> str:
        try:
            n = float(value)
        except (TypeError, ValueError):
            return "—"
        sign = "+" if n > 0 else ""
        return f"{sign}{n:.2f}%"

    lines = [
        f"📊 {snap.get('name') or 'US Portfolio'}",
        f"기준 {snap.get('as_of') or '—'}",
        f"주간 {pct(snap.get('week_return_pct'))} · 누적 {pct(snap.get('cumulative_return_pct'))}",
        f"S&P500(SPY) 대비 {pct(snap.get('excess_vs_spy_pct'))}",
        f"MDD {pct(snap.get('max_drawdown_pct'))}",
        "",
        "업종 기여 Top",
    ]
    for row in (snap.get("sector_attribution") or [])[:5]:
        lines.append(f"· {row.get('label')} {pct(row.get('contribution_pct'))}")
    lines.append("")
    lines.append("종목 기여 Top")
    for row in (snap.get("stock_attribution") or [])[:5]:
        lines.append(f"· {row.get('label')} {pct(row.get('contribution_pct'))}")
    return "\n".join(lines)
