"""Charts for /idx rule comparison dashboard."""

from __future__ import annotations

import io
from typing import Sequence

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np

from idx_rules import IndexRule

PALETTE = {
    "bg": "#0f172a",
    "panel": "#1e293b",
    "grid": "#334155",
    "text": "#f1f5f9",
    "muted": "#94a3b8",
    "accent": "#38bdf8",
    "warn": "#fbbf24",
    "danger": "#f87171",
    "ok": "#34d399",
    "soft": "#64748b",
}


def _short(rule: IndexRule) -> str:
    # Compact labels for axis ticks
    mapping = {
        "ucits": "UCITS 5/10/40",
        "msci_parent": "MSCI Parent",
        "msci_1040": "MSCI 10/40",
        "msci_2550": "MSCI 25/50",
        "msci_2020": "MSCI 20/20",
        "msci_capped_generic": "MSCI Cap*",
        "msci_country_cap": "MSCI Country",
        "msci_sector_cap": "MSCI Sector",
        "ftse_parent": "FTSE Parent",
        "ftse_capped": "FTSE Capped",
        "sp500": "S&P 500",
        "ndx": "Nasdaq-100",
        "stoxx": "STOXX Parent",
        "kr_fund": "KR Fund 10%",
    }
    return mapping.get(rule.id, rule.name[:18])


def _fig_to_buf(fig) -> io.BytesIO:
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=140, bbox_inches="tight", facecolor=fig.get_facecolor())
    plt.close(fig)
    buf.seek(0)
    return buf


def plot_issuer_cap_bars(rules: Sequence[IndexRule]) -> io.BytesIO:
    """Horizontal bars: single-issuer hard caps (uncapped → grey stub)."""
    from cjk_font import configure_matplotlib_cjk

    configure_matplotlib_cjk()

    labels = [_short(r) for r in rules]
    values = [r.single_issuer_pct if r.single_issuer_pct is not None else 0.0 for r in rules]
    has_cap = [r.single_issuer_pct is not None for r in rules]
    colors = [PALETTE["accent"] if h else PALETTE["soft"] for h in has_cap]

    fig, ax = plt.subplots(figsize=(11, max(5.0, 0.45 * len(rules) + 1.4)), facecolor=PALETTE["bg"])
    ax.set_facecolor(PALETTE["panel"])
    y = np.arange(len(rules))
    bars = ax.barh(y, values, color=colors, height=0.62, edgecolor=PALETTE["bg"], linewidth=0.8)
    ax.set_yticks(y)
    ax.set_yticklabels(labels, fontsize=9, color=PALETTE["text"])
    ax.invert_yaxis()
    ax.set_xlabel("Single-issuer / constituent hard cap (%)", fontsize=10, color=PALETTE["muted"])
    ax.set_xlim(0, 55)
    ax.set_title(
        "Index & fund concentration rules — single issuer",
        fontsize=13,
        color=PALETTE["text"],
        pad=12,
    )
    ax.axvline(10, color=PALETTE["warn"], ls="--", lw=1.1, alpha=0.9, label="10% (UCITS / 10-40)")
    ax.axvline(25, color=PALETTE["danger"], ls="--", lw=1.0, alpha=0.75, label="25% (RIC / 25-50)")
    ax.tick_params(colors=PALETTE["muted"])
    for spine in ax.spines.values():
        spine.set_color(PALETTE["grid"])
    ax.grid(axis="x", color=PALETTE["grid"], alpha=0.45)
    ax.legend(loc="lower right", fontsize=8, frameon=False, labelcolor=PALETTE["muted"])

    for bar, rule, has in zip(bars, rules, has_cap):
        txt = f"{rule.single_issuer_pct:g}%" if has else "no hard cap"
        ax.text(
            max(bar.get_width(), 1.5) + 0.7,
            bar.get_y() + bar.get_height() / 2,
            txt,
            va="center",
            fontsize=8,
            color=PALETTE["text"] if has else PALETTE["muted"],
        )

    fig.text(
        0.01,
        0.01,
        "*MSCI Cap / Country / Sector = methodology family; exact % set per named index.",
        fontsize=7,
        color=PALETTE["muted"],
    )
    return _fig_to_buf(fig)


def plot_constraint_heatmap(rules: Sequence[IndexRule]) -> io.BytesIO:
    """Heatmap of issuer / large-bucket / country / sector constraint intensity."""
    from cjk_font import configure_matplotlib_cjk

    configure_matplotlib_cjk()

    def issuer_score(r: IndexRule) -> float:
        if r.single_issuer_pct is not None:
            return max(0.0, 40.0 - float(r.single_issuer_pct))
        return 0.0

    def large_score(r: IndexRule) -> float:
        if r.large_bucket_sum_pct is not None:
            return float(r.large_bucket_sum_pct) / 2.0
        return 0.0

    def country_score(r: IndexRule) -> float:
        if r.country_cap_pct is not None:
            return max(0.0, 50.0 - float(r.country_cap_pct))
        return 0.0

    def sector_score(r: IndexRule) -> float:
        if r.sector_cap_pct is not None:
            return max(0.0, 50.0 - float(r.sector_cap_pct))
        return 0.0

    rows = ["Issuer cap\n(tighter ↑)", "Large-bucket\nsum rule", "Country cap", "Sector cap"]
    data = np.array(
        [
            [issuer_score(r) for r in rules],
            [large_score(r) for r in rules],
            [country_score(r) for r in rules],
            [sector_score(r) for r in rules],
        ]
    )

    fig, ax = plt.subplots(figsize=(max(11, 0.9 * len(rules) + 3.2), 5.0), facecolor=PALETTE["bg"])
    ax.set_facecolor(PALETTE["panel"])
    im = ax.imshow(data, aspect="auto", cmap="YlOrRd", vmin=0, vmax=40)
    ax.set_xticks(np.arange(len(rules)))
    ax.set_xticklabels([_short(r) for r in rules], rotation=32, ha="right", fontsize=8, color=PALETTE["text"])
    ax.set_yticks(np.arange(len(rows)))
    ax.set_yticklabels(rows, fontsize=9, color=PALETTE["text"])
    ax.set_title(
        "Constraint intensity — higher = tighter published rule",
        fontsize=12,
        color=PALETTE["text"],
        pad=10,
    )

    for i in range(data.shape[0]):
        for j, rule in enumerate(rules):
            if i == 0:
                cell = f"{rule.single_issuer_pct:g}%" if rule.single_issuer_pct is not None else "—"
            elif i == 1:
                if rule.large_bucket_sum_pct is not None and rule.large_bucket_threshold_pct is not None:
                    cell = f">{rule.large_bucket_threshold_pct:g}/{rule.large_bucket_sum_pct:g}"
                elif rule.large_bucket_sum_pct is not None:
                    cell = f"≤{rule.large_bucket_sum_pct:g}%"
                else:
                    cell = "—"
            elif i == 2:
                cell = f"{rule.country_cap_pct:g}%" if rule.country_cap_pct is not None else "—"
            else:
                cell = f"{rule.sector_cap_pct:g}%" if rule.sector_cap_pct is not None else "—"
            ax.text(j, i, cell, ha="center", va="center", fontsize=7.5, color="#1e293b")

    cbar = fig.colorbar(im, ax=ax, fraction=0.03, pad=0.02)
    cbar.ax.yaxis.set_tick_params(color=PALETTE["muted"])
    plt.setp(cbar.ax.yaxis.get_ticklabels(), color=PALETTE["muted"], fontsize=8)
    cbar.set_label("Intensity", fontsize=8, color=PALETTE["muted"])
    for spine in ax.spines.values():
        spine.set_color(PALETTE["grid"])
    return _fig_to_buf(fig)


def plot_rules_table(rules: Sequence[IndexRule]) -> io.BytesIO:
    """Readable comparison table chart."""
    from cjk_font import configure_matplotlib_cjk

    configure_matplotlib_cjk()

    col_labels = ["Family", "Rule / Index", "Issuer%", "Large-bucket", "Country%", "Sector%"]
    cell_text = []
    for r in rules:
        if r.large_bucket_threshold_pct is not None and r.large_bucket_sum_pct is not None:
            large = f"{r.large_bucket_threshold_pct:g}/{r.large_bucket_sum_pct:g}"
        else:
            large = "—"
        cell_text.append(
            [
                r.family,
                r.name if len(r.name) <= 28 else r.name[:26] + "…",
                f"{r.single_issuer_pct:g}" if r.single_issuer_pct is not None else "—",
                large,
                f"{r.country_cap_pct:g}" if r.country_cap_pct is not None else "—",
                f"{r.sector_cap_pct:g}" if r.sector_cap_pct is not None else "—",
            ]
        )

    fig, ax = plt.subplots(figsize=(12.5, max(4.8, 0.38 * len(rules) + 1.8)), facecolor=PALETTE["bg"])
    ax.set_facecolor(PALETTE["panel"])
    ax.axis("off")
    ax.set_title(
        "Index / fund weight-cap comparison",
        fontsize=13,
        color=PALETTE["text"],
        pad=14,
    )
    table = ax.table(
        cellText=cell_text,
        colLabels=col_labels,
        loc="center",
        cellLoc="center",
    )
    table.auto_set_font_size(False)
    table.set_fontsize(8.5)
    table.scale(1.0, 1.35)

    for (row, col), cell in table.get_celld().items():
        cell.set_edgecolor(PALETTE["grid"])
        if row == 0:
            cell.set_facecolor("#0ea5e9")
            cell.set_text_props(color="white", fontweight="bold", fontsize=8)
        else:
            cell.set_facecolor(PALETTE["panel"] if row % 2 else "#243044")
            cell.set_text_props(color=PALETTE["text"])
            # Left-align name column
            if col == 1:
                cell.set_text_props(color=PALETTE["text"], ha="left")

    fig.text(
        0.5,
        0.02,
        "Large-bucket = threshold% / max sum% of names above threshold (e.g. 5/40, 5/50, 4.5/48)",
        ha="center",
        fontsize=7.5,
        color=PALETTE["muted"],
    )
    return _fig_to_buf(fig)


def plot_family_summary(rules: Sequence[IndexRule]) -> io.BytesIO:
    """Grouped bars by family."""
    from cjk_font import configure_matplotlib_cjk

    configure_matplotlib_cjk()

    families: dict[str, list[IndexRule]] = {}
    for r in rules:
        families.setdefault(r.family, []).append(r)

    names = list(families.keys())
    avg_issuer = []
    with_country = []
    with_sector = []
    with_large = []
    for fam in names:
        items = families[fam]
        hard = [r.single_issuer_pct for r in items if r.single_issuer_pct is not None]
        avg_issuer.append(sum(hard) / len(hard) if hard else 0.0)
        with_country.append(100.0 * sum(1 for r in items if r.country_cap_pct is not None) / len(items))
        with_sector.append(100.0 * sum(1 for r in items if r.sector_cap_pct is not None) / len(items))
        with_large.append(
            100.0
            * sum(1 for r in items if r.large_bucket_sum_pct is not None)
            / len(items)
        )

    x = np.arange(len(names))
    w = 0.2
    fig, ax = plt.subplots(figsize=(11, 5.4), facecolor=PALETTE["bg"])
    ax.set_facecolor(PALETTE["panel"])
    ax.bar(x - 1.5 * w, avg_issuer, w, label="Avg issuer hard cap %", color=PALETTE["accent"])
    ax.bar(x - 0.5 * w, with_large, w, label="% with large-bucket rule", color=PALETTE["ok"])
    ax.bar(x + 0.5 * w, with_country, w, label="% with country cap", color=PALETTE["warn"])
    ax.bar(x + 1.5 * w, with_sector, w, label="% with sector cap", color="#fb923c")
    ax.set_xticks(x)
    ax.set_xticklabels(names, fontsize=9, color=PALETTE["text"])
    ax.set_ylabel("%", color=PALETTE["muted"])
    ax.set_ylim(0, 110)
    ax.set_title(
        "By family — typical issuer caps & geo/sector constraints",
        fontsize=12,
        color=PALETTE["text"],
        pad=10,
    )
    ax.tick_params(colors=PALETTE["muted"])
    ax.grid(axis="y", color=PALETTE["grid"], alpha=0.45)
    for spine in ax.spines.values():
        spine.set_color(PALETTE["grid"])
    ax.legend(fontsize=8, frameon=False, labelcolor=PALETTE["muted"], loc="upper right")
    return _fig_to_buf(fig)
