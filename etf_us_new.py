"""US newly listed ETFs for the ETF 시황 tab / Telegram.

Pipeline (no paid API key):
  1) Nasdaq ETF screener universe (~5k symbols)
  2) Yahoo ``fundInceptionDate`` to find recent launches
  3) Yahoo top holdings via ``etf_memb_us`` for a few newest names

Persistent inception cache avoids re-probing the full universe every run.
"""

from __future__ import annotations

import json
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from dart_data import PROJECT_DIR, _esc

KST = ZoneInfo("Asia/Seoul")
DATA_DIR = PROJECT_DIR / "data" / "etf_us_new"
CACHE_PATH = DATA_DIR / "inception_cache.json"
NASDAQ_PATH = DATA_DIR / "nasdaq_universe.json"

DEFAULT_LOOKBACK_DAYS = 60
DEFAULT_LIST_LIMIT = 12
DEFAULT_HOLDINGS_LIMIT = 5
DEFAULT_MAX_PROBES = 400
DEFAULT_WORKERS = 14

NASDAQ_URL = (
    "https://api.nasdaq.com/api/screener/etf"
    "?tableonly=true&limit=25&offset=0&download=true"
)

_CMD_ALIASES = {
    "/etf_us_new",
    "/etfusnew",
    "/etf_usnew",
    "/us_etf_new",
}


def is_etf_us_new_command(command: str) -> bool:
    """Match `/etf_us_new`, `/etf usnew`, `/etf new us`."""
    parts = command.strip().split()
    if not parts:
        return False
    head = parts[0].lower().split("@", 1)[0]
    if head in _CMD_ALIASES:
        return True
    if head != "/etf" or len(parts) < 2:
        return False
    rest = [p.lower() for p in parts[1:]]
    joined = " ".join(rest)
    if rest[0] in {"usnew", "us_new", "newus", "launches", "launch"}:
        return True
    if rest[:2] == ["new", "us"] or rest[:2] == ["us", "new"]:
        return True
    if joined in {"us new", "new us"}:
        return True
    return False


def _load_json(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return payload if isinstance(payload, dict) else {}


def _save_json(path: Path, payload: dict[str, Any]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def fetch_nasdaq_etf_universe(*, force: bool = False) -> list[dict[str, str]]:
    """Return ``[{symbol, name}, ...]`` from Nasdaq ETF screener download."""
    cached = _load_json(NASDAQ_PATH)
    fetched_at = str(cached.get("fetched_at") or "")
    rows = cached.get("rows") if isinstance(cached.get("rows"), list) else []
    if (
        not force
        and rows
        and fetched_at
        and (datetime.now(timezone.utc) - datetime.fromisoformat(fetched_at)).total_seconds()
        < 12 * 3600
    ):
        return [
            {"symbol": str(r.get("symbol") or "").upper(), "name": str(r.get("name") or "")}
            for r in rows
            if r.get("symbol")
        ]

    import requests

    res = requests.get(
        NASDAQ_URL,
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; SavvyETF/1.0)",
            "Accept": "application/json",
        },
        timeout=60,
    )
    res.raise_for_status()
    payload = res.json()
    raw_rows = (((payload.get("data") or {}).get("data") or {}).get("rows")) or []
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    for row in raw_rows:
        if not isinstance(row, dict):
            continue
        symbol = str(row.get("symbol") or "").strip().upper()
        if not symbol or symbol in seen:
            continue
        if not re.fullmatch(r"[A-Z][A-Z0-9.\-]{0,9}", symbol):
            continue
        seen.add(symbol)
        out.append(
            {
                "symbol": symbol,
                "name": str(row.get("companyName") or "").strip(),
            }
        )
    if len(out) < 100:
        raise RuntimeError(f"Nasdaq ETF universe too small ({len(out)})")
    _save_json(
        NASDAQ_PATH,
        {
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "count": len(out),
            "rows": out,
        },
    )
    return out


def _probe_yahoo_meta(symbol: str) -> dict[str, Any] | None:
    import yfinance as yf

    from stock_crawler import _quiet_yfinance

    try:
        with _quiet_yfinance():
            info = yf.Ticker(symbol).info or {}
    except Exception:
        return None
    quote_type = str(info.get("quoteType") or "").upper()
    ts = info.get("fundInceptionDate")
    inception = None
    if isinstance(ts, (int, float)) and ts > 0:
        inception = datetime.fromtimestamp(int(ts), timezone.utc).date().isoformat()
    aum = info.get("totalAssets")
    try:
        aum_f = float(aum) if aum is not None else None
    except (TypeError, ValueError):
        aum_f = None
    name = str(info.get("longName") or info.get("shortName") or "").strip()
    return {
        "symbol": symbol.upper(),
        "name": name,
        "quote_type": quote_type,
        "inception": inception,
        "aum": aum_f,
        "probed_at": datetime.now(timezone.utc).isoformat(),
    }


def refresh_inception_cache(
    universe: list[dict[str, str]],
    *,
    max_probes: int = DEFAULT_MAX_PROBES,
    workers: int = DEFAULT_WORKERS,
) -> dict[str, Any]:
    """Probe Yahoo for symbols missing from the inception cache."""
    cache = _load_json(CACHE_PATH)
    entries = cache.get("entries") if isinstance(cache.get("entries"), dict) else {}
    unknown: list[str] = []
    for row in universe:
        sym = row["symbol"]
        prev = entries.get(sym) if isinstance(entries.get(sym), dict) else None
        if prev and prev.get("inception"):
            # Keep Nasdaq display name if Yahoo name empty
            if not prev.get("name") and row.get("name"):
                prev["name"] = row["name"]
            continue
        unknown.append(sym)

    to_probe = unknown[: max(0, max_probes)]
    probed = 0
    if to_probe:
        with ThreadPoolExecutor(max_workers=max(2, min(workers, 24))) as pool:
            futs = {pool.submit(_probe_yahoo_meta, sym): sym for sym in to_probe}
            for fut in as_completed(futs):
                meta = fut.result()
                probed += 1
                if not meta:
                    sym = futs[fut]
                    entries[sym] = {
                        "symbol": sym,
                        "name": next(
                            (r["name"] for r in universe if r["symbol"] == sym), ""
                        ),
                        "quote_type": "",
                        "inception": None,
                        "aum": None,
                        "probed_at": datetime.now(timezone.utc).isoformat(),
                        "error": "probe_failed",
                    }
                    continue
                # Prefer Yahoo name; fall back to Nasdaq
                if not meta.get("name"):
                    meta["name"] = next(
                        (r["name"] for r in universe if r["symbol"] == meta["symbol"]),
                        "",
                    )
                entries[meta["symbol"]] = meta

    cache = {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "entries": entries,
        "last_probe_count": probed,
        "unknown_remaining": max(0, len(unknown) - probed),
    }
    _save_json(CACHE_PATH, cache)
    return cache


def _looks_levered_or_single(name: str) -> bool:
    n = (name or "").lower()
    keys = (
        "2x ",
        "2x-",
        " -2x",
        "1x ",
        "3x ",
        "leveraged",
        "leverage shares",
        "daily etf",
        "long ",
        "short ",
        "bull ",
        "bear ",
    )
    return any(k in n for k in keys)


def find_recent_listings(
    cache: dict[str, Any],
    *,
    lookback_days: int = DEFAULT_LOOKBACK_DAYS,
    limit: int = DEFAULT_LIST_LIMIT,
) -> list[dict[str, Any]]:
    cutoff = date.today() - timedelta(days=max(1, lookback_days))
    entries = cache.get("entries") if isinstance(cache.get("entries"), dict) else {}
    rows: list[dict[str, Any]] = []
    for sym, meta in entries.items():
        if not isinstance(meta, dict):
            continue
        q = str(meta.get("quote_type") or "").upper()
        if q and q not in {"ETF", "MUTUALFUND"}:
            # Keep blank quote_type if inception looks valid (Yahoo sometimes omits)
            if q not in {"", "NONE"}:
                continue
        inception = meta.get("inception")
        if not inception:
            continue
        try:
            d0 = date.fromisoformat(str(inception)[:10])
        except ValueError:
            continue
        if d0 < cutoff:
            continue
        rows.append(
            {
                "symbol": str(meta.get("symbol") or sym).upper(),
                "name": str(meta.get("name") or sym),
                "inception": d0.isoformat(),
                "aum": meta.get("aum"),
                "quote_type": q or "ETF",
            }
        )

    # Mix: newest launches + larger recent AUM names (avoid all 2x single-stock).
    by_new = sorted(
        rows, key=lambda r: (r["inception"], r.get("aum") or 0), reverse=True
    )
    by_aum = sorted(
        [r for r in rows if isinstance(r.get("aum"), (int, float))],
        key=lambda r: float(r["aum"]),
        reverse=True,
    )
    broad = [
        r
        for r in by_new
        if not _looks_levered_or_single(str(r.get("name") or ""))
    ]

    seen: set[str] = set()
    out: list[dict[str, Any]] = []

    def _take(pool: list[dict[str, Any]], n: int) -> None:
        for row in pool:
            if len(out) >= limit or n <= 0:
                return
            sym = row["symbol"]
            if sym in seen:
                continue
            seen.add(sym)
            out.append(row)
            n -= 1

    newest_n = max(4, limit // 2)
    _take(by_new, newest_n)
    _take(broad, max(2, limit // 4))
    _take(by_aum, limit)
    _take(by_new, limit)
    return out


def _fmt_aum(aum: Any) -> str:
    try:
        n = float(aum)
    except (TypeError, ValueError):
        return "—"
    if n >= 1_000_000_000:
        return f"${n / 1_000_000_000:.2f}B"
    if n >= 1_000_000:
        return f"${n / 1_000_000:.1f}M"
    if n >= 1_000:
        return f"${n / 1_000:.0f}K"
    return f"${n:.0f}"


def _refresh_listing_meta(row: dict[str, Any]) -> dict[str, Any]:
    """Slow re-probe for AUM/name on the short recent list."""
    meta = _probe_yahoo_meta(str(row.get("symbol") or ""))
    if not meta:
        return row
    out = dict(row)
    if meta.get("name"):
        out["name"] = meta["name"]
    if meta.get("aum") is not None:
        out["aum"] = meta["aum"]
    if meta.get("inception"):
        out["inception"] = meta["inception"]
    return out


def enrich_with_holdings(
    listings: list[dict[str, Any]],
    *,
    limit: int = DEFAULT_HOLDINGS_LIMIT,
) -> list[dict[str, Any]]:
    from etf_memb_us import build_etf_memb_us_profile

    out: list[dict[str, Any]] = []
    for idx, row in enumerate(listings):
        item = _refresh_listing_meta(row) if idx < max(limit, 8) else dict(row)
        time.sleep(0.35)
        if idx >= max(0, limit):
            item["holdings"] = []
            item.setdefault("holdings_error", None)
            out.append(item)
            continue

        last_err = None
        for attempt in range(3):
            try:
                profile = build_etf_memb_us_profile(item["symbol"])
                item["holdings"] = (profile.get("holdings") or [])[:10]
                item["holdings_name"] = profile.get("name") or item.get("name")
                item["holdings_error"] = None
                if profile.get("name"):
                    item["name"] = profile["name"]
                last_err = None
                break
            except Exception as exc:
                last_err = str(exc)[:160]
                time.sleep(1.2 * (attempt + 1))
        if last_err:
            item["holdings"] = []
            item["holdings_error"] = last_err
        out.append(item)
        time.sleep(0.6)
    return out


def build_etf_us_new_brief(
    *,
    lookback_days: int = DEFAULT_LOOKBACK_DAYS,
    list_limit: int = DEFAULT_LIST_LIMIT,
    holdings_limit: int = DEFAULT_HOLDINGS_LIMIT,
    max_probes: int = DEFAULT_MAX_PROBES,
    force_nasdaq: bool = False,
) -> dict[str, Any]:
    universe = fetch_nasdaq_etf_universe(force=force_nasdaq)
    cache = refresh_inception_cache(universe, max_probes=max_probes)
    recent = find_recent_listings(
        cache, lookback_days=lookback_days, limit=list_limit
    )
    enriched = enrich_with_holdings(recent, limit=holdings_limit) if recent else []
    generated = datetime.now(KST).strftime("%Y-%m-%d %H:%M KST")
    return {
        "ok": bool(enriched),
        "generated_at": generated,
        "lookback_days": lookback_days,
        "universe_count": len(universe),
        "cache_size": len((cache.get("entries") or {})),
        "probed": cache.get("last_probe_count") or 0,
        "unknown_remaining": cache.get("unknown_remaining") or 0,
        "listings": enriched,
        "sources": [
            "Nasdaq ETF screener",
            "Yahoo fundInceptionDate",
            "Yahoo funds_data.top_holdings",
        ],
    }


def format_etf_us_new_telegram(brief: dict[str, Any]) -> str:
    listings = brief.get("listings") or []
    lines = [
        "<b>미국 신규 상장 ETF</b>",
        f"최근 {brief.get('lookback_days')}일 · Nasdaq 유니버스 + Yahoo inception",
        f"생성 {_esc(brief.get('generated_at') or '')}",
        "",
    ]
    if not listings:
        lines.append("최근 상장 ETF를 찾지 못했습니다. 캐시가 채워지면 자동으로 표시됩니다.")
        if brief.get("unknown_remaining"):
            lines.append(
                f"(캐시 미완료: 남은 probe ≈ {_esc(str(brief.get('unknown_remaining')))})"
            )
        return "\n".join(lines)

    lines.append("<pre>")
    for row in listings:
        aum = _fmt_aum(row.get("aum"))
        lines.append(
            f"{row.get('inception')}  {str(row.get('symbol') or ''):<6s}  "
            f"{aum:>8s}  {str(row.get('name') or '')[:34]}"
        )
    lines.append("</pre>")

    with_h = [r for r in listings if r.get("holdings")]
    for row in with_h[:3]:
        lines.append("")
        lines.append(
            f"<b>{_esc(row.get('symbol'))}</b> Top holdings "
            f"({_esc(row.get('inception'))})"
        )
        lines.append("<pre>")
        for idx, h in enumerate(row.get("holdings") or [], start=1):
            w = h.get("weight_pct")
            w_txt = f"{w:5.2f}%" if isinstance(w, (int, float)) else "  n/a"
            lines.append(
                f"{idx:2d}. {str(h.get('code') or '')[:10]:<10s} {w_txt}  "
                f"{str(h.get('name') or '')[:26]}"
            )
        lines.append("</pre>")

    lines.extend(
        [
            "",
            f"출처: {_esc(', '.join(brief.get('sources') or []))}",
            "※ 개별 편입 Top10: <code>/etf memb TICKER</code>",
            "※ 국내 신규상장은 /etfcheck · etf_memb 슬롯",
        ]
    )
    return "\n".join(lines)


def plot_etf_us_new_chart(brief: dict[str, Any]):
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
        "accent": "#60a5fa",
        "bar": "#34d399",
    }
    listings = brief.get("listings") or []
    fig, axes = plt.subplots(1, 2, figsize=(14, 7), facecolor=palette["bg"])
    fig.suptitle(
        f"US new ETF launches · last {brief.get('lookback_days')}d",
        color=palette["text"],
        fontsize=12,
        y=0.98,
    )

    ax = axes[0]
    ax.set_facecolor(palette["panel"])
    aum_rows = [r for r in listings if isinstance(r.get("aum"), (int, float))][:10]
    if aum_rows:
        labels = [str(r.get("symbol") or "") for r in reversed(aum_rows)]
        values = [float(r["aum"]) / 1_000_000.0 for r in reversed(aum_rows)]
        ax.barh(labels, values, color=palette["bar"])
        ax.set_xlabel("AUM ($M)", color=palette["muted"])
        for y, v in enumerate(values):
            ax.text(
                v + max(values) * 0.01,
                y,
                f"{v:.1f}",
                va="center",
                color=palette["muted"],
                fontsize=8,
            )
    else:
        ax.text(
            0.5,
            0.5,
            "No AUM yet",
            ha="center",
            va="center",
            color=palette["muted"],
            transform=ax.transAxes,
        )
    ax.set_title("Recent launches by AUM", color=palette["text"], fontsize=11)
    ax.tick_params(colors=palette["muted"], labelsize=8)
    for spine in ax.spines.values():
        spine.set_color(palette["grid"])
    ax.grid(True, axis="x", color=palette["grid"], alpha=0.35)

    ax2 = axes[1]
    ax2.set_facecolor(palette["panel"])
    featured = next((r for r in listings if r.get("holdings")), None)
    if featured:
        holds = list(reversed(featured.get("holdings") or []))
        labels = [str(h.get("code") or "")[:12] for h in holds]
        weights = [float(h.get("weight_pct") or 0) for h in holds]
        ax2.barh(labels, weights, color=palette["accent"])
        ax2.set_xlabel("Weight %", color=palette["muted"])
        ax2.set_title(
            f"{featured.get('symbol')} Top holdings",
            color=palette["text"],
            fontsize=11,
        )
        for y, w in enumerate(weights):
            ax2.text(
                w + 0.1,
                y,
                f"{w:.2f}%",
                va="center",
                color=palette["muted"],
                fontsize=8,
            )
    else:
        ax2.text(
            0.5,
            0.5,
            "Holdings unavailable",
            ha="center",
            va="center",
            color=palette["muted"],
            transform=ax2.transAxes,
        )
        ax2.set_title("Featured holdings", color=palette["text"], fontsize=11)
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


def publish_etf_us_new_brief(brief: dict[str, Any] | None = None) -> bool:
    """Publish ``etf`` / ``etf_us_new`` slot to R2 + Vercel ingest."""
    from web_publish import chart_to_image_payload, publish_brief, section_from_html

    brief = brief or build_etf_us_new_brief()
    text = format_etf_us_new_telegram(brief)
    images = []
    if brief.get("listings"):
        try:
            chart = plot_etf_us_new_chart(brief)
            images = [
                chart_to_image_payload(
                    chart,
                    id="us_new_launches",
                    caption=f"US new ETFs · {brief.get('generated_at')}",
                )
            ]
        except Exception as exc:
            print(f"etf_us_new chart skipped: {exc}")

    return publish_brief(
        "etf",
        "etf_us_new",
        title="미국 신규 상장 ETF",
        generated_at=brief.get("generated_at"),
        sections=section_from_html(text, heading="US new listings"),
        images=images,
        meta={
            "lookback_days": brief.get("lookback_days"),
            "count": len(brief.get("listings") or []),
            "universe_count": brief.get("universe_count"),
            "probed": brief.get("probed"),
            "unknown_remaining": brief.get("unknown_remaining"),
            "tickers": [r.get("symbol") for r in (brief.get("listings") or [])],
        },
    )


def run_etf_us_new(**kwargs: Any) -> dict[str, Any]:
    brief = build_etf_us_new_brief(**kwargs)
    chart = None
    if brief.get("listings"):
        try:
            chart = plot_etf_us_new_chart(brief)
        except Exception as exc:
            print(f"etf_us_new chart failed: {exc}")
    text = format_etf_us_new_telegram(brief)
    try:
        publish_etf_us_new_brief(brief)
    except Exception as pub_exc:
        print(f"web_publish etf_us_new skipped: {pub_exc}")

    messages: list[dict[str, Any]] = []
    if chart is not None:
        chart.seek(0)
        messages.append(
            {
                "text": f"US new ETFs · {brief.get('generated_at')}",
                "photo": chart,
            }
        )
    messages.append({"text": text, "parse_mode": "HTML"})
    return {
        "brief": brief,
        "chart": chart,
        "text_summary": text,
        "telegram_messages": messages,
    }
