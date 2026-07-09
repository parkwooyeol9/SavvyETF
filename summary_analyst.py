"""Leader chart collection and rule-based chart notes for /summary."""

from __future__ import annotations

from typing import Any

from analysis import analyze_stock, stock_ta_snapshot


def collect_leader_charts(summary: dict) -> dict[str, dict[str, Any]]:
    """Build TA snapshots and chart PNGs for each universe leader."""
    leaders: dict[str, dict[str, Any]] = {}
    for universe in summary.get("universes", []):
        ticker = universe.get("leader_ticker")
        if not ticker:
            continue
        try:
            chart = analyze_stock(ticker)
            chart.seek(0)
            leaders[universe["key"]] = {
                "universe": universe["key"],
                "universe_label": universe["name"],
                "ticker": ticker,
                "snapshot": stock_ta_snapshot(ticker),
                "chart_png": chart,
            }
        except Exception as exc:
            leaders[universe["key"]] = {
                "universe": universe["key"],
                "universe_label": universe["name"],
                "ticker": ticker,
                "error": str(exc),
            }
    return leaders


def generate_chart_notes(summary: dict, leaders: dict[str, dict[str, Any]]) -> dict[str, str]:
    """Short Korean notes for each universe leader chart (rule-based)."""
    chart_notes: dict[str, str] = {}
    for ukey, leader in leaders.items():
        snap = leader.get("snapshot")
        if not snap:
            continue
        chart_notes[ukey] = (
            f"{snap['symbol']}: 1일 {snap['daily_return_pct']:+.1f}%, "
            f"RSI {snap.get('rsi', 'n/a')}, MACD {snap['macd_bias']} — "
            f"MA50 {'상회' if snap['price_vs_ma50'] == 'above' else '하회'}"
        )
    return chart_notes
