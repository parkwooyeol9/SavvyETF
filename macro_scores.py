"""Macro stress scoring and regime labels."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime


@dataclass
class StressResult:
    score: int
    regime: str
    emoji: str
    drivers: list[str]
    components: dict[str, float]


def _clip_score(value: float) -> float:
    return max(0.0, min(100.0, value))


def _curve_stress(t10y2y: float | None, t10y3m: float | None) -> tuple[float, list[str]]:
    notes: list[str] = []
    score = 35.0
    if t10y2y is not None:
        if t10y2y < -0.5:
            score = 85.0
            notes.append(f"10Y-2Y deeply inverted ({t10y2y:+.2f}%)")
        elif t10y2y < 0:
            score = 68.0
            notes.append(f"10Y-2Y inverted ({t10y2y:+.2f}%)")
        elif t10y2y < 0.5:
            score = 48.0
            notes.append(f"10Y-2Y flat ({t10y2y:+.2f}%)")
        else:
            score = 22.0
    if t10y3m is not None and t10y3m < 0:
        score = max(score, 75.0)
        notes.append(f"10Y-3M inverted ({t10y3m:+.2f}%)")
    return score, notes


def _credit_stress(hy_oas: float | None, ig_oas: float | None) -> tuple[float, list[str]]:
    notes: list[str] = []
    if hy_oas is None:
        return 40.0, notes
    # FRED HY OAS is in percent (e.g. 3.5 = 350 bps)
    if hy_oas >= 6.0:
        score = 92.0
        notes.append(f"HY OAS very wide ({hy_oas:.2f}%)")
    elif hy_oas >= 5.0:
        score = 78.0
        notes.append(f"HY OAS elevated ({hy_oas:.2f}%)")
    elif hy_oas >= 4.0:
        score = 58.0
        notes.append(f"HY OAS above average ({hy_oas:.2f}%)")
    elif hy_oas >= 3.0:
        score = 35.0
    else:
        score = 18.0
        notes.append(f"HY OAS tight ({hy_oas:.2f}%)")
    if ig_oas is not None and ig_oas >= 1.5:
        score = max(score, score + 8)
        notes.append(f"IG OAS widening ({ig_oas:.2f}%)")
    return _clip_score(score), notes


def _vol_stress(vix: float | None, spy_20d: float | None) -> tuple[float, list[str]]:
    notes: list[str] = []
    score = 30.0
    if vix is not None:
        if vix >= 35:
            score = 95.0
            notes.append(f"VIX crisis-level ({vix:.1f})")
        elif vix >= 28:
            score = 78.0
            notes.append(f"VIX elevated ({vix:.1f})")
        elif vix >= 22:
            score = 58.0
            notes.append(f"VIX rising ({vix:.1f})")
        elif vix >= 18:
            score = 40.0
        else:
            score = 18.0
    if spy_20d is not None:
        if spy_20d <= -10:
            score = max(score, 88.0)
            notes.append(f"S&P 500 20d drawdown ({spy_20d:+.1f}%)")
        elif spy_20d <= -5:
            score = max(score, 65.0)
            notes.append(f"S&P 500 soft ({spy_20d:+.1f}% / 20d)")
        elif spy_20d >= 8:
            score = min(score, 25.0)
    return _clip_score(score), notes


def _risk_appetite_stress(hyg_tlt_20d: float | None) -> tuple[float, list[str]]:
    if hyg_tlt_20d is None:
        return 40.0, []
    if hyg_tlt_20d <= -6:
        return 82.0, [f"Risk-off: HYG/TLT down {hyg_tlt_20d:+.1f}% (20d)"]
    if hyg_tlt_20d <= -3:
        return 62.0, [f"Credit risk fading: HYG/TLT {hyg_tlt_20d:+.1f}% (20d)"]
    if hyg_tlt_20d >= 4:
        return 18.0, [f"Risk-on: HYG/TLT up {hyg_tlt_20d:+.1f}% (20d)"]
    return 35.0, []


def _regime_for_score(score: int) -> tuple[str, str]:
    if score >= 75:
        return "High Stress", "🔴"
    if score >= 55:
        return "Elevated", "🟠"
    if score >= 35:
        return "Caution", "🟡"
    return "Calm", "🟢"


def compute_macro_stress(
    snapshot: dict,
    edgar: dict | None = None,
    finnhub: dict | None = None,
) -> StressResult:
    curve_score, curve_notes = _curve_stress(snapshot.get("T10Y2Y"), snapshot.get("T10Y3M"))
    credit_score, credit_notes = _credit_stress(snapshot.get("HY_OAS"), snapshot.get("IG_OAS"))
    vol_score, vol_notes = _vol_stress(snapshot.get("VIX"), snapshot.get("SPY_20D"))
    appetite_score, appetite_notes = _risk_appetite_stress(snapshot.get("HYG_TLT_20D"))

    components = {
        "curve": curve_score,
        "credit": credit_score,
        "volatility": vol_score,
        "risk_appetite": appetite_score,
    }
    weights = {"curve": 0.25, "credit": 0.30, "volatility": 0.25, "risk_appetite": 0.20}
    score = int(round(sum(components[k] * weights[k] for k in components)))
    regime, emoji = _regime_for_score(score)

    drivers = curve_notes + credit_notes + vol_notes + appetite_notes

    if edgar:
        mentions = (edgar.get("macro_mentions") or {}).get("mention_count")
        pulse_count = (edgar.get("pulse") or {}).get("filing_count")
        if mentions is not None and mentions >= 150:
            drivers.append(f"SEC filings: elevated macro-theme mentions ({mentions} / 14d)")
        if pulse_count is not None and pulse_count >= 800:
            drivers.append(f"SEC filings: heavy 8-K flow ({pulse_count} / 7d)")

    if finnhub and finnhub.get("available"):
        upcoming = finnhub.get("high_impact_upcoming") or []
        if len(upcoming) >= 3:
            drivers.append(f"Finnhub: {len(upcoming)} high-impact US macro events ahead")
        today = datetime.now().date().isoformat()
        today_events = [row for row in upcoming if str(row.get("date", "")).startswith(today)]
        if today_events:
            drivers.append(f"Finnhub: US macro calendar busy today ({len(today_events)} high-impact)")

    if not drivers:
        drivers = ["No major stress signals in current snapshot."]

    return StressResult(
        score=score,
        regime=regime,
        emoji=emoji,
        drivers=drivers[:5],
        components=components,
    )
