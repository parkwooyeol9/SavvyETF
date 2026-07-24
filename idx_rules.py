"""Index construction / regulatory weight-cap comparison for ``/idx rule``.

Compares major equity-index regimes (MSCI parent vs capped, FTSE, UCITS fund
law, US RIC, Nasdaq-100, S&P 500, Korea) on:
  - single issuer / constituent weight limits
  - aggregate “large holding” rules (e.g. 5/10/40, 25/50)
  - country / sector caps (when part of the published methodology)

Knowledge is curated from public methodology PDFs (MSCI 10/40, 25/50, Capped
Indexes; UCITS directive; Nasdaq-100 methodology notes). Values are *rules*,
not live portfolio weights — rebalance buffers are noted separately.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

KST = ZoneInfo("Asia/Seoul")


@dataclass(frozen=True)
class IndexRule:
    id: str
    family: str
    name: str
    region: str
    # Numeric caps in percent; None = no hard methodology/law cap
    single_issuer_pct: float | None
    large_bucket_threshold_pct: float | None  # e.g. 5% in 5/10/40
    large_bucket_sum_pct: float | None  # e.g. 40%
    country_cap_pct: float | None
    sector_cap_pct: float | None
    rebalance_buffer_note: str
    applies_to: str
    notes: str
    sources: tuple[str, ...]


# Curated comparison set — Telegram + charts.
INDEX_RULES: tuple[IndexRule, ...] = (
    IndexRule(
        id="ucits",
        family="UCITS",
        name="UCITS fund law (5/10/40)",
        region="EU",
        single_issuer_pct=10.0,
        large_bucket_threshold_pct=5.0,
        large_bucket_sum_pct=40.0,
        country_cap_pct=None,
        sector_cap_pct=None,
        rebalance_buffer_note="Fund-level law (not an index). Index trackers often use MSCI 10/40.",
        applies_to="UCITS funds / many EU-domiciled ETFs",
        notes="Issuer = same body (group look-through). No statutory country/sector %.",
        sources=("UCITS Directive concentration limits",),
    ),
    IndexRule(
        id="msci_parent",
        family="MSCI",
        name="MSCI Parent (free-float mcap)",
        region="Global",
        single_issuer_pct=None,
        large_bucket_threshold_pct=None,
        large_bucket_sum_pct=None,
        country_cap_pct=None,
        sector_cap_pct=None,
        rebalance_buffer_note="No hard % cap — weights follow free-float market cap.",
        applies_to="MSCI ACWI / World / EM / Country Standard parents",
        notes="Concentration can be high in single-country or mega-cap heavy parents.",
        sources=("MSCI Global Investable Market Indexes methodology",),
    ),
    IndexRule(
        id="msci_1040",
        family="MSCI",
        name="MSCI 10/40 Capped",
        region="Global",
        single_issuer_pct=10.0,
        large_bucket_threshold_pct=5.0,
        large_bucket_sum_pct=40.0,
        country_cap_pct=None,
        sector_cap_pct=None,
        rebalance_buffer_note="At rebalance: typically 9% single / 36% large-bucket (10% buffer).",
        applies_to="UCITS-friendly benchmarks derived from MSCI parents",
        notes="Caps group entities; iterative optimizer vs parent. No country/sector hard %. ",
        sources=("MSCI 10/40 Indexes Methodology",),
    ),
    IndexRule(
        id="msci_2550",
        family="MSCI",
        name="MSCI 25/50 Capped",
        region="US/Global",
        single_issuer_pct=25.0,
        large_bucket_threshold_pct=5.0,
        large_bucket_sum_pct=50.0,
        country_cap_pct=None,
        sector_cap_pct=None,
        rebalance_buffer_note="At rebalance: ~22.5% / 45% with 10% buffer (typical).",
        applies_to="US RIC-friendly benchmarks",
        notes="Needs enough issuers (discontinued if <12 group entities).",
        sources=("MSCI 25/50 Indexes Methodology",),
    ),
    IndexRule(
        id="msci_2020",
        family="MSCI",
        name="MSCI 20/20 Capped",
        region="Global",
        single_issuer_pct=20.0,
        large_bucket_threshold_pct=None,
        large_bucket_sum_pct=None,
        country_cap_pct=None,
        sector_cap_pct=None,
        rebalance_buffer_note="Simple group/issuer cap at 20% (see MSCI Capped Indexes).",
        applies_to="Selected MSCI Capped variants",
        notes="Part of MSCI generic capped framework (group criterion configurable).",
        sources=("MSCI Capped Indexes Methodology",),
    ),
    IndexRule(
        id="msci_country_cap",
        family="MSCI",
        name="MSCI Country Capped (typical 20%)",
        region="Global",
        single_issuer_pct=None,
        large_bucket_threshold_pct=None,
        large_bucket_sum_pct=None,
        country_cap_pct=20.0,
        sector_cap_pct=None,
        rebalance_buffer_note="Max country weight set per named index (20% is a common template).",
        applies_to="MSCI indexes with country group criterion",
        notes="Issuer may still be uncapped unless combined with issuer capping.",
        sources=("MSCI Capped Indexes Methodology",),
    ),
    IndexRule(
        id="msci_sector_cap",
        family="MSCI",
        name="MSCI Sector Capped (typical 25%)",
        region="Global",
        single_issuer_pct=None,
        large_bucket_threshold_pct=None,
        large_bucket_sum_pct=None,
        country_cap_pct=None,
        sector_cap_pct=25.0,
        rebalance_buffer_note="Max GICS sector weight set per named index (25% common template).",
        applies_to="MSCI indexes with sector group criterion",
        notes="Exact % is index-specific; chart uses a representative published template.",
        sources=("MSCI Capped Indexes Methodology",),
    ),
    IndexRule(
        id="ftse_parent",
        family="FTSE",
        name="FTSE Global Equity (parent)",
        region="Global",
        single_issuer_pct=None,
        large_bucket_threshold_pct=None,
        large_bucket_sum_pct=None,
        country_cap_pct=None,
        sector_cap_pct=None,
        rebalance_buffer_note="Free-float mcap; no UCITS-style hard issuer cap on parent.",
        applies_to="FTSE All-World / Developed / Emerging parents",
        notes="Capped / capped-component variants exist separately for funds.",
        sources=("FTSE Global Equity Index Series Ground Rules",),
    ),
    IndexRule(
        id="ftse_capped",
        family="FTSE",
        name="FTSE Capped / Capped Component",
        region="Global",
        single_issuer_pct=10.0,
        large_bucket_threshold_pct=None,
        large_bucket_sum_pct=None,
        country_cap_pct=None,
        sector_cap_pct=None,
        rebalance_buffer_note="Common retail variants cap companies at 5–15% (often 10%).",
        applies_to="FTSE Capped indexes used by UCITS/retail products",
        notes="Exact cap depends on the named FTSE capped index; 10% shown as typical.",
        sources=("FTSE Capped Index Series / product ground rules",),
    ),
    IndexRule(
        id="sp500",
        family="S&P DJI",
        name="S&P 500",
        region="US",
        single_issuer_pct=None,
        large_bucket_threshold_pct=None,
        large_bucket_sum_pct=None,
        country_cap_pct=None,
        sector_cap_pct=None,
        rebalance_buffer_note="Float-adjusted mcap; no hard single-stock % ceiling.",
        applies_to="S&P 500 and many US large-cap parents",
        notes="Concentration via committee + float, not a UCITS 10% rule. No country/sector %.",
        sources=("S&P U.S. Indices Methodology",),
    ),
    IndexRule(
        id="ndx",
        family="Nasdaq",
        name="Nasdaq-100 (modified mcap)",
        region="US",
        single_issuer_pct=24.0,
        large_bucket_threshold_pct=4.5,
        large_bucket_sum_pct=48.0,
        country_cap_pct=None,
        sector_cap_pct=None,
        rebalance_buffer_note="Special rebalance if largest >24% or >4.5% names sum >48%.",
        applies_to="Nasdaq-100 / QQQ family benchmarks",
        notes="Not identical to RIC 25/50, but similar concentration guardrails.",
        sources=("Nasdaq-100 Index Methodology",),
    ),
    IndexRule(
        id="stoxx",
        family="STOXX",
        name="STOXX Europe 600 / 50 parents",
        region="Europe",
        single_issuer_pct=None,
        large_bucket_threshold_pct=None,
        large_bucket_sum_pct=None,
        country_cap_pct=None,
        sector_cap_pct=None,
        rebalance_buffer_note="Free-float mcap parents; capped variants published separately.",
        applies_to="STOXX Europe benchmarks",
        notes="UCITS ETFs often track capped or use internal fund-level limits.",
        sources=("STOXX Index Methodology Guides",),
    ),
    IndexRule(
        id="kr_fund",
        family="Korea",
        name="Korea fund concentration (typical)",
        region="KR",
        single_issuer_pct=10.0,
        large_bucket_threshold_pct=None,
        large_bucket_sum_pct=None,
        country_cap_pct=None,
        sector_cap_pct=None,
        rebalance_buffer_note="Fund regulation (집합투자) — index parents themselves usually uncapped.",
        applies_to="Many KR mutual funds; index/ETF trackers may get exceptions",
        notes="KOSPI200 / KRX parents are free-float mcap without UCITS 10/40.",
        sources=("Korea Capital Markets Act / fund concentration practice",),
    ),
)


def is_idx_rule_command(command: str) -> bool:
    parts = command.strip().split()
    if len(parts) < 2:
        return False
    head = parts[0].lower().split("@", 1)[0]
    if head != "/idx":
        return False
    return parts[1].lower() in {"rule", "rules", "cap", "caps", "limit", "limits", "한도"}


def _sort_key(row: dict[str, Any]) -> tuple:
    cap = row.get("single_issuer_pct")
    return (cap is None, cap if cap is not None else 999.0, row["family"], row["name"])


def build_idx_rules_dashboard() -> dict[str, Any]:
    rows = [asdict(rule) for rule in INDEX_RULES]
    rows_sorted = sorted(rows, key=_sort_key)
    return {
        "generated_at": datetime.now(KST).strftime("%Y-%m-%d %H:%M KST"),
        "rules": rows_sorted,
        "rule_objects": tuple(sorted(INDEX_RULES, key=lambda r: _sort_key(asdict(r)))),
        "disclaimer": (
            "Methodology snapshot for education — verify the current official "
            "ground rules / prospectus before trading. Caps are index or fund "
            "rules, not today’s live ETF weights."
        ),
    }


def _fmt_cap(value: float | None) -> str:
    return f"{value:g}%" if value is not None else "—"


def _fmt_large(rule: IndexRule) -> str:
    if rule.large_bucket_threshold_pct is not None and rule.large_bucket_sum_pct is not None:
        return f"{rule.large_bucket_threshold_pct:g}/{rule.large_bucket_sum_pct:g}"
    return "—"


def format_idx_rules_telegram(dashboard: dict[str, Any]) -> list[dict]:
    """Text summary + chart photos for Telegram."""
    from idx_rules_charts import (
        plot_constraint_heatmap,
        plot_family_summary,
        plot_issuer_cap_bars,
        plot_rules_table,
    )

    rules: tuple[IndexRule, ...] = dashboard.get("rule_objects") or INDEX_RULES
    generated = dashboard.get("generated_at", "")
    disclaimer = dashboard.get("disclaimer", "")

    lines = [
        "<b>📐 /idx rule — Index &amp; fund weight caps</b>",
        f"<i>{generated}</i>",
        "",
        "MSCI · FTSE · UCITS · Nasdaq · S&amp;P · STOXX · KR 비교",
        "단일종목(issuer) · 대형주 합산 · 국가 · 산업 한도",
        "",
        "<b>Quick read</b>",
        "• <b>UCITS / MSCI 10/40</b> — issuer ≤10%, &gt;5% names sum ≤40%",
        "• <b>MSCI 25/50</b> — RIC style: ≤25% / sum of &gt;5% ≤50%",
        "• <b>Nasdaq-100</b> — ~24% / 4.5%·48% special rebalance",
        "• <b>Parents (MSCI/FTSE/S&amp;P/STOXX)</b> — usually <i>no</i> hard issuer %",
        "• <b>Country/Sector</b> — optional MSCI/FTSE capped variants (not parents)",
        "",
        "<b>Detail table</b>",
    ]
    for rule in rules:
        geo = []
        if rule.country_cap_pct is not None:
            geo.append(f"country ≤{_fmt_cap(rule.country_cap_pct)}")
        if rule.sector_cap_pct is not None:
            geo.append(f"sector ≤{_fmt_cap(rule.sector_cap_pct)}")
        geo_bit = f" · {', '.join(geo)}" if geo else ""
        lines.append(
            f"• <b>{rule.name}</b> [{rule.family}] — "
            f"issuer {_fmt_cap(rule.single_issuer_pct)} · "
            f"bucket {_fmt_large(rule)}{geo_bit}"
        )
    lines.append("")
    lines.append(f"<i>{disclaimer}</i>")
    lines.append("<i>Not financial advice.</i>")

    messages: list[dict] = [
        {"text": "\n".join(lines).strip(), "parse_mode": "HTML"},
        {"text": "Issuer hard-cap comparison", "photo": plot_issuer_cap_bars(rules)},
        {"text": "Constraint heatmap (issuer / bucket / country / sector)", "photo": plot_constraint_heatmap(rules)},
        {"text": "Comparison table", "photo": plot_rules_table(rules)},
        {"text": "By family — cap coverage", "photo": plot_family_summary(rules)},
    ]
    return messages


def run_idx_rules() -> dict[str, Any]:
    dashboard = build_idx_rules_dashboard()
    return {
        "dashboard": dashboard,
        "telegram_messages": format_idx_rules_telegram(dashboard),
    }
