"""Telegram pipeline for /seasonality stock seasonality studies."""

from __future__ import annotations

from typing import Any

from seasonality import DEFAULT_FOCUS_MONTHS, run_seasonality_analysis
from seasonality_charts import plot_monthly_seasonality_bar


def _format_telegram_message(result: dict[str, Any]) -> str:
    display = result.get("display") or result.get("symbol") or ""
    symbol = result.get("symbol") or ""
    years = result.get("lookback_years") or 10
    focus_label = result.get("focus_label_ko") or ""
    verdict = result.get("verdict") or {}

    lines = [
        f"<b>📊 계절성 분석 — {display}</b>",
        f"<code>{symbol}</code> · 최근 {years}년 "
        f"({result.get('start_date')} ~ {result.get('end_date')})",
        "",
        f"<b>집중 시즌</b>: {focus_label}",
        f"<b>판정</b>: {verdict.get('label', '?')}",
        "",
        f"· 집중 시즌 평균 월수익률: <b>{result.get('focus_mean_pct', 0):+.2f}%</b>",
        f"· 나머지 달 평균: <b>{result.get('other_mean_pct', 0):+.2f}%</b>",
        f"· 차이: <b>{result.get('diff_focus_minus_other_pct', 0):+.2f}%p</b>",
    ]

    p_val = result.get("ttest_p")
    if p_val is not None and p_val == p_val:
        sig = "유의 (p&lt;0.05)" if verdict.get("significant") else f"p={p_val:.3f}"
        lines.append(f"· Welch t-검정: {sig}")

    summary = (verdict.get("summary_ko") or "").strip()
    if summary:
        lines.extend(["", f"<i>{summary}</i>"])

    lines.extend(["", "<b>월별 평균 수익률</b>"])
    for row in result.get("monthly_stats") or []:
        marker = "★" if row.get("in_focus") else "·"
        mean = row.get("mean_pct")
        win = row.get("win_rate_pct")
        mean_txt = f"{mean:+.2f}%" if mean == mean else "n/a"
        win_txt = f"{win:.0f}%" if win == win else "n/a"
        lines.append(
            f"{marker} {row.get('label_ko')}: {mean_txt} "
            f"(승률 {win_txt}, n={row.get('n', 0)})"
        )

    return "\n".join(lines).strip()


def run_seasonality_pipeline(
    command: str,
    *,
    focus_months: tuple[int, ...] = DEFAULT_FOCUS_MONTHS,
) -> dict[str, Any]:
    from seasonality import parse_seasonality_ticker

    token = parse_seasonality_ticker(command)
    result = run_seasonality_analysis(token, focus_months=focus_months)

    chart_buf = plot_monthly_seasonality_bar(result)
    message = _format_telegram_message(result)

    return {
        "result": result,
        "telegram_messages": [
            {"text": message, "parse_mode": "HTML"},
            {"photo": chart_buf, "caption": f"월별 평균 수익률 — {result.get('display')}"},
        ],
    }
