"""US-listed ETF current holdings (top weights) for /etf memb.

Primary source: Yahoo Finance funds_data.top_holdings (works across issuers).
Optional enrichment: iShares AJAX full CU table when the ticker is in
``etf_holdings.ISHARES_PRODUCTS`` (live or Wayback), for a fuller Excel export.

Korean ETF memb remains ``/dart etf memb``. Weight *history* for one holding
remains ``/etf_holdings EEM 005930``.
"""

from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import pandas as pd

from dart_data import PROJECT_DIR, _esc
from stock_crawler import _quiet_yfinance

KST = ZoneInfo("Asia/Seoul")
SNAPSHOT_DIR = PROJECT_DIR / "data" / "etf_memb_us"
OUTPUT_DIR = PROJECT_DIR / "data" / "etf_memb_us"
TOP_N = 10

_MEMB_ALIASES = {"memb", "member", "members", "composition", "holdings_top"}


def is_etf_memb_command(command: str) -> bool:
    """Match `/etf memb EEM`, `/etf_memb EEM`, `/memb EEM` (not `/etf holdings`)."""
    parts = command.strip().split()
    if not parts:
        return False
    head = parts[0].lower().split("@", 1)[0]
    if head in {"/etf_memb", "/etfmemb", "/memb"}:
        return True
    if head == "/etf" and len(parts) >= 2 and parts[1].lower() in _MEMB_ALIASES:
        return True
    return False


def parse_etf_memb_query(command: str) -> str:
    """Parse ticker from `/etf memb EEM` / `/etf_memb EEM` / `/memb EEM`."""
    parts = command.strip().split()
    if not parts:
        raise ValueError("missing ETF ticker")
    head = parts[0].lower().split("@", 1)[0]
    rest = parts[1:]
    if head == "/etf" and rest and rest[0].lower() in _MEMB_ALIASES:
        rest = rest[1:]
    elif head in {"/etf_memb", "/etfmemb", "/memb"}:
        pass
    else:
        raise ValueError("expected /etf memb <TICKER>")
    if not rest:
        raise ValueError(
            "Usage: /etf memb <TICKER>\n"
            "Example: /etf memb EEM\n"
            "Example: /etf_memb QQQ"
        )
    ticker = rest[0].strip().upper()
    if not re.fullmatch(r"[A-Z][A-Z0-9.\-]{0,9}", ticker):
        raise ValueError(f"Invalid US ETF ticker: {ticker!r}")
    return ticker


def _snapshot_path(ticker: str) -> Path:
    return SNAPSHOT_DIR / f"{ticker.upper()}.json"


def load_snapshot(ticker: str) -> dict | None:
    path = _snapshot_path(ticker)
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def save_snapshot(profile: dict[str, Any]) -> None:
    SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)
    payload = {
        "ticker": profile["ticker"],
        "name": profile["name"],
        "as_of": profile["generated_at"],
        "holdings": [
            {
                "code": row["code"],
                "name": row["name"],
                "weight_pct": row.get("weight_pct"),
            }
            for row in profile.get("holdings") or []
        ],
    }
    _snapshot_path(profile["ticker"]).write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def compare_holdings(
    current: list[dict[str, Any]], previous: list[dict[str, Any]] | None
) -> dict[str, Any]:
    if not previous:
        return {
            "has_previous": False,
            "changed": [],
            "note": "첫 조회 — 다음 실행부터 Top 편입비 변경을 비교합니다.",
        }
    prev_map = {row["code"]: row for row in previous}
    curr_map = {row["code"]: row for row in current}
    changed: list[dict[str, Any]] = []
    for code in curr_map.keys() & prev_map.keys():
        before = prev_map[code].get("weight_pct")
        after = curr_map[code].get("weight_pct")
        if before is None or after is None:
            continue
        delta = after - before
        if abs(delta) >= 0.05:
            changed.append(
                {
                    "code": code,
                    "name": curr_map[code].get("name") or code,
                    "before": before,
                    "after": after,
                    "delta": delta,
                }
            )
    changed.sort(key=lambda row: abs(row["delta"]), reverse=True)
    return {"has_previous": True, "changed": changed, "note": ""}


def _fetch_yahoo_top_holdings(ticker: str) -> tuple[str, list[dict[str, Any]], str]:
    """Return (display_name, holdings, source_note)."""
    import yfinance as yf

    with _quiet_yfinance():
        yt = yf.Ticker(ticker)
        info = {}
        try:
            info = yt.info or {}
        except Exception:
            info = {}
        name = (
            str(info.get("longName") or info.get("shortName") or ticker).strip()
            or ticker
        )
        try:
            funds = yt.funds_data
            top = funds.top_holdings
        except Exception as exc:
            raise RuntimeError(
                f"Yahoo funds_data unavailable for {ticker}: {exc}"
            ) from exc

    if top is None or getattr(top, "empty", True):
        raise RuntimeError(
            f"No top holdings on Yahoo for '{ticker}'. "
            "Confirm it is a US-listed ETF with published holdings."
        )

    holdings: list[dict[str, Any]] = []
    for symbol, row in top.iterrows():
        code = str(symbol).strip()
        hname = str(row.get("Name") or code).strip()
        raw = row.get("Holding Percent")
        try:
            frac = float(raw)
        except (TypeError, ValueError):
            continue
        # Yahoo usually reports fraction (0.15); sometimes already percent.
        weight = frac * 100.0 if frac <= 1.5 else frac
        holdings.append(
            {
                "code": code,
                "name": hname,
                "weight_pct": weight,
                "shares": None,
                "market_value": None,
            }
        )

    holdings.sort(
        key=lambda row: (row.get("weight_pct") is None, -(row.get("weight_pct") or 0))
    )
    return name, holdings, "Yahoo Finance funds_data.top_holdings"


def _looks_like_cash_or_fx(ticker: str, name: str) -> bool:
    t = (ticker or "").strip().upper()
    n = (name or "").strip().upper()
    if not t:
        return True
    if t in {"USD", "EUR", "JPY", "GBP", "CNY", "HKD", "KRW", "TWD", "INR", "BRL"}:
        return True
    if "/" in t and len(t) <= 7:
        return True
    if "CASH" in n or n.endswith(" CASH"):
        return True
    if re.fullmatch(r"[A-Z]{3}", t) and ("CASH" in n or "CURRENCY" in n):
        return True
    return False


def _fetch_ishares_full_holdings(ticker: str) -> list[dict[str, Any]] | None:
    """Best-effort full CU table for curated iShares products."""
    from etf_holdings import (
        ISHARES_PRODUCTS,
        _cdx_snapshots,
        _cell_text,
        _fetch_ishares_live,
        _fetch_wayback_json,
        _row_weight_shares_mkt,
    )

    product = ISHARES_PRODUCTS.get(ticker.upper())
    if not product:
        return None

    payload = _fetch_ishares_live(product, None)
    source = "iShares live"
    if payload is None:
        snaps = _cdx_snapshots(product, limit=60)
        # Prefer dated JSON snapshots (more reliable column layout)
        dated = [(ts, orig) for ts, orig in snaps if "asOfDate=" in orig]
        undated = [(ts, orig) for ts, orig in snaps if "asOfDate=" not in orig]
        ordered = sorted(dated, key=lambda x: x[0], reverse=True) + sorted(
            undated, key=lambda x: x[0], reverse=True
        )
        for ts, orig in ordered[:12]:
            payload = _fetch_wayback_json(ts, orig)
            if payload and isinstance(payload.get("aaData"), list):
                source = f"iShares Wayback {ts[:8]}"
                break

    if not payload:
        return None
    rows = payload.get("aaData")
    if not isinstance(rows, list):
        return None

    holdings: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, (list, tuple)) or len(row) < 2:
            continue
        code = _cell_text(row[0]).strip()
        name = _cell_text(row[1]).strip()
        if _looks_like_cash_or_fx(code, name):
            continue
        weight, shares, mkt = _row_weight_shares_mkt(row)
        if weight is None or weight <= 0 or weight > 40:
            # Skip FX/cash mis-parses that dominate the table
            continue
        holdings.append(
            {
                "code": code,
                "name": name or code,
                "weight_pct": weight,
                "shares": shares,
                "market_value": mkt,
                "source": source,
            }
        )

    if len(holdings) < 5:
        return None
    holdings.sort(
        key=lambda row: (row.get("weight_pct") is None, -(row.get("weight_pct") or 0))
    )
    for row in holdings:
        row.pop("source", None)
    return holdings


def build_etf_memb_us_profile(ticker: str) -> dict[str, Any]:
    ticker_u = ticker.strip().upper()
    name, yahoo_holdings, yahoo_src = _fetch_yahoo_top_holdings(ticker_u)
    full = _fetch_ishares_full_holdings(ticker_u)
    sources = [yahoo_src]
    excel_holdings = yahoo_holdings
    if full:
        sources.append("iShares holdings AJAX (full CU for Excel)")
        excel_holdings = full

    # Chart / Telegram always use Yahoo top-N (stable, issuer-agnostic)
    top = yahoo_holdings[:TOP_N]
    previous = load_snapshot(ticker_u)
    changes = compare_holdings(top, (previous or {}).get("holdings"))

    profile = {
        "ticker": ticker_u,
        "name": name,
        "holdings": top,
        "all_holdings": excel_holdings,
        "n_holdings_excel": len(excel_holdings),
        "top_n": TOP_N,
        "changes": changes,
        "sources": sources,
        "generated_at": datetime.now(KST).strftime("%Y-%m-%d %H:%M KST"),
    }
    save_snapshot({**profile, "holdings": top})
    return profile


def format_etf_memb_us_telegram(profile: dict[str, Any]) -> str:
    lines = [
        f"<b>US ETF 편입 비중</b> — {_esc(profile['ticker'])}",
        f"{_esc(profile['name'])}",
        f"Top {profile['top_n']} (Yahoo) · Excel 행 {_esc(str(profile['n_holdings_excel']))}",
        "",
        "<pre>",
    ]
    for idx, row in enumerate(profile.get("holdings") or [], start=1):
        w = row.get("weight_pct")
        w_txt = f"{w:6.2f}%" if isinstance(w, (int, float)) else "   n/a"
        code = str(row.get("code") or "")[:12]
        name = str(row.get("name") or "")[:28]
        lines.append(f"{idx:2d}. {code:<12s} {w_txt}  {name}")
    lines.append("</pre>")

    changed = (profile.get("changes") or {}).get("changed") or []
    if changed:
        lines.append("")
        lines.append("<b>vs 이전 스냅샷 (Top)</b>")
        for row in changed[:5]:
            lines.append(
                f"• {_esc(row['code'])}: {row['before']:.2f}% → {row['after']:.2f}% "
                f"({row['delta']:+.2f}%p)"
            )
    elif (profile.get("changes") or {}).get("note"):
        lines.append("")
        lines.append(_esc(profile["changes"]["note"]))

    lines.extend(
        [
            "",
            f"출처: {_esc(', '.join(profile.get('sources') or []) or 'n/a')}",
            f"생성: {_esc(profile['generated_at'])}",
            "",
            "※ 특정 종목 편입비 <b>시계열</b>은 "
            f"<code>/etf_holdings {profile['ticker']} &lt;종목&gt;</code>",
            "※ 국내 ETF는 <code>/dart etf memb &lt;티커|이름&gt;</code>",
        ]
    )
    return "\n".join(lines)


def format_etf_memb_us_chart_caption(profile: dict[str, Any]) -> str:
    return (
        f"{profile['ticker']} Top {profile['top_n']} holdings "
        f"({profile['generated_at']})"
    )


def export_etf_memb_us_excel(profile: dict[str, Any], run_id: str | None = None) -> Path:
    run_id = run_id or datetime.now(KST).strftime("%Y%m%d_%H%M%S")
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    ticker = profile["ticker"]
    path = OUTPUT_DIR / f"etf_memb_{ticker}_{run_id}.xlsx"

    notes = pd.DataFrame(
        [
            {"field": "Generated at (KST)", "value": profile["generated_at"]},
            {"field": "ETF", "value": f"{profile['ticker']} — {profile['name']}"},
            {"field": "Top N (chart)", "value": profile["top_n"]},
            {"field": "Excel rows", "value": profile["n_holdings_excel"]},
            {"field": "Sources", "value": "; ".join(profile.get("sources") or [])},
        ]
    )
    rows = profile.get("all_holdings") or profile.get("holdings") or []
    holdings_df = pd.DataFrame(
        [
            {
                "rank": i,
                "ticker": row.get("code"),
                "name": row.get("name"),
                "weight_pct": row.get("weight_pct"),
                "shares": row.get("shares"),
                "market_value": row.get("market_value"),
            }
            for i, row in enumerate(rows, start=1)
        ]
    )
    top_df = holdings_df.head(profile["top_n"]).copy()

    with pd.ExcelWriter(path, engine="openpyxl") as writer:
        notes.to_excel(writer, sheet_name="README", index=False)
        top_df.to_excel(writer, sheet_name="Top10", index=False)
        holdings_df.to_excel(writer, sheet_name="Holdings", index=False)
        workbook = writer.book
        for sheet_name in workbook.sheetnames:
            ws = workbook[sheet_name]
            for col in ws.columns:
                letter = col[0].column_letter
                max_len = 0
                for cell in col:
                    if cell.value is not None:
                        max_len = max(max_len, len(str(cell.value)))
                ws.column_dimensions[letter].width = min(max(max_len + 2, 12), 56)
    return path


def plot_etf_memb_us_chart(profile: dict[str, Any]):
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    from chart_buffers import figure_to_png_buffer
    from cjk_font import configure_matplotlib_cjk

    configure_matplotlib_cjk()
    palette = {
        "bg": "#0b1220",
        "panel": "#121b2d",
        "grid": "#243049",
        "text": "#e8edf7",
        "muted": "#93a4c3",
    }
    bar_colors = [
        "#60a5fa",
        "#34d399",
        "#fbbf24",
        "#fb923c",
        "#a78bfa",
        "#f472b6",
        "#2dd4bf",
        "#f87171",
        "#94a3b8",
        "#c084fc",
    ]

    holdings = (profile.get("holdings") or [])[: profile.get("top_n", TOP_N)]
    changes = (profile.get("changes") or {}).get("changed") or []

    fig, axes = plt.subplots(1, 2, figsize=(14, 7), facecolor=palette["bg"])
    fig.suptitle(
        f"{profile['ticker']} — {profile['name'][:48]}",
        color=palette["text"],
        fontsize=12,
        y=0.98,
    )

    ax = axes[0]
    ax.set_facecolor(palette["panel"])
    if holdings:
        labels = [str(row.get("code") or "")[:14] for row in reversed(holdings)]
        weights = [float(row.get("weight_pct") or 0) for row in reversed(holdings)]
        colors = [bar_colors[i % len(bar_colors)] for i in range(len(labels))][::-1]
        ax.barh(labels, weights, color=colors)
        for y, weight in enumerate(weights):
            ax.text(
                weight + 0.15,
                y,
                f"{weight:.2f}%",
                va="center",
                color=palette["muted"],
                fontsize=8,
            )
        ax.set_xlabel("Weight %", color=palette["muted"])
    else:
        ax.text(
            0.5,
            0.5,
            "No holdings",
            ha="center",
            va="center",
            color=palette["muted"],
            transform=ax.transAxes,
        )
    ax.set_title(f"Top {len(holdings)} composition", color=palette["text"], fontsize=11)
    ax.tick_params(colors=palette["muted"], labelsize=8)
    for spine in ax.spines.values():
        spine.set_color(palette["grid"])
    ax.grid(True, axis="x", color=palette["grid"], alpha=0.35)

    ax2 = axes[1]
    ax2.set_facecolor(palette["panel"])
    changed = changes[:10]
    if changed:
        labels = [str(row.get("code") or "")[:14] for row in reversed(changed)]
        deltas = [float(row["delta"]) for row in reversed(changed)]
        colors = ["#34d399" if d >= 0 else "#f87171" for d in deltas]
        ax2.barh(labels, deltas, color=colors)
        ax2.axvline(0, color=palette["muted"], linewidth=0.8)
        ax2.set_xlabel("Weight change (%p)", color=palette["muted"])
        ax2.set_title("vs previous snapshot", color=palette["text"], fontsize=11)
    else:
        msg = (
            "First snapshot saved.\nRun again later for changes."
            if not (profile.get("changes") or {}).get("has_previous")
            else "No meaningful weight changes"
        )
        ax2.text(
            0.5,
            0.5,
            msg,
            ha="center",
            va="center",
            color=palette["muted"],
            transform=ax2.transAxes,
            fontsize=10,
        )
        ax2.set_title("vs previous snapshot", color=palette["text"], fontsize=11)
    ax2.tick_params(colors=palette["muted"], labelsize=8)
    for spine in ax2.spines.values():
        spine.set_color(palette["grid"])
    ax2.grid(True, axis="x", color=palette["grid"], alpha=0.35)

    fig.tight_layout(rect=(0, 0, 1, 0.95))
    return figure_to_png_buffer(
        fig,
        dpi=130,
        facecolor=palette["bg"],
        bbox_inches="tight",
    )


def run_etf_memb_us(ticker: str) -> dict[str, Any]:
    profile = build_etf_memb_us_profile(ticker)
    chart = plot_etf_memb_us_chart(profile)
    xlsx = export_etf_memb_us_excel(profile)
    text = format_etf_memb_us_telegram(profile)
    telegram_messages: list[dict] = [
        {
            "text": format_etf_memb_us_chart_caption(profile),
            "photo": chart,
        },
        {
            "text": text,
            "parse_mode": "HTML",
        },
        {
            "text": f"Excel: {xlsx.name}",
            "document_path": str(xlsx),
        },
    ]
    return {
        "profile": profile,
        "chart": chart,
        "excel_path": xlsx,
        "text_summary": text,
        "telegram_messages": telegram_messages,
    }
