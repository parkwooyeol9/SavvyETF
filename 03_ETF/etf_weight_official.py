"""Issuer-official holdings files for the ETF weight monitor.

Why this exists
---------------
etfcheck (Morningstar feed) returns a *price* date, not the portfolio date, and its
weights can lag the issuer by weeks (2026-11-05 check: XLK NVDA 77.3M shares on
etfcheck vs 87.6M in SSGA's 11/03 file). For the priority set we read the issuer's
own file and store the issuer's holdings date as ``as_of``.

Sources (verified 2026-11-05)
-----------------------------
iShares   https://www.ishares.com/{product_path}/latest-holdings.csv
          daily, T-1. (The old ``1467271812596.ajax?fileType=csv`` URL now returns
          the product HTML page, so that path is dead.)
SPDR      https://www.ssga.com/us/en/intermediary/library-content/products/
          fund-data/etfs/us/holdings-daily-us-en-{ticker}.xlsx — daily, T-1.
Vanguard  https://investor.vanguard.com/irr/funds/profile/{TICKER}-AdditionalFundData
          ``holdingDetails`` = official full list, **month-end** (published with
          about a 1-month lag). Daily PCF exists but is a creation basket, not weights.
Victory   advisor.vcm.com product page → "All Holdings" CSV is built in the browser
          from investorapi.vcm.com, which returns 403 to plain HTTP clients. The page
          also embeds ``window.ajaxData_toptenholdings`` (official **daily top 10**).
          etfcheck's VFLO list is internally inconsistent (SNDK 7.54% weight vs
          ~2.4% implied by its own shares × price), so the scheduler does NOT publish
          it; VFLO is refreshed by importing the official top 10 / full CSV:
            python etf_weight_official.py --victory-json VFLO path/to/top10.json
            python etf_weight_official.py --victory-csv  VFLO path/to/All_Holdings.csv
"""

from __future__ import annotations
import path_setup  # noqa: F401  # numbered folders on sys.path

import csv
import io
import json
import re
from datetime import datetime
from typing import Any, Callable

from etf_weight_monitor import (
    SESSION,
    _ishares_snapshot_from_etfcheck,
    build_snapshot,
    load_latest,
    publish_to_r2,
    save_snapshot,
    sync_snapshots_from_r2,
)

# Priority set the user asked to keep current (2026-11-05). Extend here.
OFFICIAL_SOURCES: dict[str, dict[str, str]] = {
    "DGRO": {
        "issuer": "iShares",
        "kind": "ishares_csv",
        "path": "us/products/264623/ishares-core-dividend-growth-etf",
    },
    "HDV": {
        "issuer": "iShares",
        "kind": "ishares_csv",
        "path": "us/products/239563/ishares-core-high-dividend-etf",
    },
    "XLK": {"issuer": "SPDR", "kind": "ssga_xlsx"},
    "VYM": {"issuer": "Vanguard", "kind": "vanguard_json"},
    "VFLO": {
        "issuer": "VictoryShares",
        "kind": "victory_import",
        "page": "https://advisor.vcm.com/products/victoryshares-etfs/victoryshares-etfs-list/"
        "victoryshares-free-cash-flow-etf",
    },
}
PRIORITY_TICKERS: tuple[str, ...] = tuple(OFFICIAL_SOURCES)


def _num(raw: Any) -> float | None:
    if raw is None:
        return None
    if isinstance(raw, (int, float)):
        return float(raw)
    s = str(raw).strip().replace(",", "").replace("$", "").replace("%", "")
    if s in {"", "-", "--"}:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _date_iso(raw: str, fmts: tuple[str, ...]) -> str:
    raw = (raw or "").strip()
    for fmt in fmts:
        try:
            return datetime.strptime(raw, fmt).date().isoformat()
        except ValueError:
            continue
    raise ValueError(f"unrecognized holdings date: {raw!r}")


def _sorted(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows.sort(key=lambda r: -(r.get("weight_pct") or 0))
    return rows


def _check_weights(ticker: str, rows: list[dict[str, Any]]) -> None:
    total = sum(r.get("weight_pct") or 0 for r in rows)
    if len(rows) < 5 or not (90 <= total <= 110):
        raise RuntimeError(f"{ticker}: implausible holdings ({len(rows)} rows, Σ{total:.1f}%)")


# ---------------------------------------------------------------------------
# iShares
# ---------------------------------------------------------------------------


def ishares_product_path(ticker: str) -> str | None:
    t = ticker.upper()
    src = OFFICIAL_SOURCES.get(t)
    if src and src.get("kind") == "ishares_csv":
        return src["path"]
    try:
        from etf_holdings import ISHARES_PRODUCTS

        prod = ISHARES_PRODUCTS.get(t)
        return prod["path"] if prod else None
    except Exception:
        return None


def ishares_official_snapshot(
    ticker: str, *, aum_usd: float | None = None
) -> tuple[dict[str, Any], str]:
    t = ticker.upper()
    path = ishares_product_path(t)
    if not path:
        raise RuntimeError(f"no iShares product path for {t}")
    url = f"https://www.ishares.com/{path}/latest-holdings.csv"
    resp = SESSION.get(url, timeout=30)
    resp.raise_for_status()
    text = resp.content.decode("utf-8-sig", errors="replace")
    if text.lstrip().startswith("<"):
        raise RuntimeError(f"{t}: iShares returned HTML instead of CSV")

    lines = text.splitlines()
    name = lines[0].strip().strip('"') if lines else f"iShares {t}"
    as_of = None
    header_idx = None
    for i, line in enumerate(lines[:30]):
        if line.startswith("Fund Holdings as of"):
            as_of = _date_iso(next(csv.reader([line]))[1], ("%b %d, %Y",))
        if line.startswith("Ticker,"):
            header_idx = i
            break
    if as_of is None or header_idx is None:
        raise RuntimeError(f"{t}: unexpected iShares CSV layout")

    rows: list[dict[str, Any]] = []
    for rec in csv.DictReader(io.StringIO("\n".join(lines[header_idx:]))):
        # Layout varies by fund: "Weight (%)" (DGRO/HDV) vs "Market Weight" (IVV).
        weight = _num(rec.get("Weight (%)") or rec.get("Market Weight"))
        if weight is None or not (rec.get("Ticker") or rec.get("Name")):
            continue  # footer / disclaimer lines
        rows.append(
            {
                "ticker": (rec.get("Ticker") or "").strip(),
                "name": (rec.get("Name") or "").strip(),
                "cusip": "",
                "sector": (rec.get("Sector") or "").strip(),
                "asset_class": (rec.get("Asset Class") or "").strip(),
                "weight_pct": weight,
                "shares": _num(rec.get("Quantity")),
                "price": _num(rec.get("Price")),
                "market_value": _num(rec.get("Market Value")),
                "date": as_of,
            }
        )
    _check_weights(t, rows)
    snap = build_snapshot(
        ticker=t,
        name=name,
        issuer="iShares",
        source="ishares_latest_holdings_csv",
        source_url=f"https://www.ishares.com/{path}",
        source_note="iShares 공식 일간 보유종목 CSV(latest-holdings.csv). 기준일 = 'Fund Holdings as of'.",
        as_of=as_of,
        holdings=_sorted(rows),
        aum_usd=aum_usd,
        extra={"holdings_as_of": as_of, "as_of_basis": "issuer_file", "disclosure": "daily"},
    )
    return snap, text


# ---------------------------------------------------------------------------
# SPDR (State Street)
# ---------------------------------------------------------------------------


def ssga_official_snapshot(ticker: str) -> tuple[dict[str, Any], str]:
    import openpyxl

    t = ticker.upper()
    url = (
        "https://www.ssga.com/us/en/intermediary/library-content/products/fund-data/"
        f"etfs/us/holdings-daily-us-en-{t.lower()}.xlsx"
    )
    resp = SESSION.get(url, timeout=30)
    resp.raise_for_status()
    wb = openpyxl.load_workbook(io.BytesIO(resp.content), read_only=True, data_only=True)
    ws = wb.active
    name, as_of, header = f"SPDR {t}", None, None
    rows: list[dict[str, Any]] = []
    raw_lines: list[list[Any]] = []
    for r in ws.iter_rows(values_only=True):
        cells = list(r)
        if not any(c is not None for c in cells):
            if header and rows:
                break  # end of table; disclaimers follow
            continue
        raw_lines.append(cells)
        first = str(cells[0] or "").strip()
        if first == "Fund Name:":
            name = str(cells[1] or name).strip()
        elif first == "Holdings:":
            m = re.search(r"(\d{2}-[A-Za-z]{3}-\d{4})", str(cells[1] or ""))
            if m:
                as_of = _date_iso(m.group(1), ("%d-%b-%Y",))
        elif first == "Name" and "Weight" in [str(c) for c in cells]:
            header = [str(c or "").strip() for c in cells]
        elif header:
            rec = dict(zip(header, cells))
            weight = _num(rec.get("Weight"))
            if weight is None:
                continue
            tick = str(rec.get("Ticker") or "").strip()
            rows.append(
                {
                    "ticker": "" if tick == "-" else tick,
                    "name": str(rec.get("Name") or "").strip(),
                    "cusip": str(rec.get("Identifier") or "").strip(),
                    "weight_pct": weight,
                    "shares": _num(rec.get("Shares Held")),
                    "price": None,
                    "market_value": None,
                    "date": as_of,
                }
            )
    if not as_of or not header:
        raise RuntimeError(f"{t}: unexpected SSGA xlsx layout")
    _check_weights(t, rows)
    buf = io.StringIO()
    csv.writer(buf).writerows(raw_lines)
    snap = build_snapshot(
        ticker=t,
        name=name,
        issuer="SPDR",
        source="ssga_holdings_daily_xlsx",
        source_url=url,
        source_note="State Street 공식 일간 보유종목 xlsx. 현금·선물 포함(음수 비중 = 선물).",
        as_of=as_of,
        holdings=_sorted(rows),
        extra={"holdings_as_of": as_of, "as_of_basis": "issuer_file", "disclosure": "daily"},
    )
    return snap, buf.getvalue()


# ---------------------------------------------------------------------------
# Vanguard
# ---------------------------------------------------------------------------


def vanguard_official_snapshot(ticker: str) -> tuple[dict[str, Any], str]:
    t = ticker.upper()
    url = f"https://investor.vanguard.com/irr/funds/profile/{t}-AdditionalFundData"
    resp = SESSION.get(url, headers={"Content-Type": "application/json"}, timeout=40)
    resp.raise_for_status()
    data = resp.json()
    hd = data.get("holdingDetails") or {}
    as_of = _date_iso(str(hd.get("asOfDate") or ""), ("%m/%d/%Y",))
    rows: list[dict[str, Any]] = []
    for bucket in ("equityHoldings", "shortTermReservesHoldings", "derivativeHoldings"):
        for h in hd.get(bucket) or []:
            weight = _num(h.get("marketValuePercentage"))
            if weight is None:
                continue
            rows.append(
                {
                    "ticker": str(h.get("ticker") or "").strip(),
                    "name": str(
                        h.get("securityLongDescription") or h.get("securityShortDescription") or ""
                    ).strip(),
                    "cusip": str(h.get("cusip") or "").strip(),
                    "asset_class": str(h.get("securityMainType") or "").strip(),
                    "weight_pct": weight,
                    "shares": _num(h.get("shareQuantity")),
                    "price": None,
                    "market_value": _num(h.get("marketValueBaseCurrency")),
                    "date": as_of,
                }
            )
    _check_weights(t, rows)
    snap = build_snapshot(
        ticker=t,
        name=f"Vanguard {t}",
        issuer="Vanguard",
        source="vanguard_additional_fund_data",
        source_url=f"https://investor.vanguard.com/investment-products/etfs/profile/{t.lower()}",
        source_note=(
            "Vanguard 공식 전체 보유종목 — 월말 기준, 약 1개월 지연 공시. "
            "일간 PCF는 설정·환매 바스켓이라 편입비로 쓰지 않음."
        ),
        as_of=as_of,
        holdings=_sorted(rows),
        extra={"holdings_as_of": as_of, "as_of_basis": "issuer_file", "disclosure": "monthly"},
    )
    # Fund name is not in this payload; keep the nicer one from a prior snapshot.
    prev = load_latest(t)
    if prev and prev.get("name") and not str(prev["name"]).startswith("Vanguard " + t):
        snap["name"] = prev["name"]
    elif t == "VYM":
        snap["name"] = "Vanguard High Dividend Yield ETF"
    return snap, json.dumps(hd, ensure_ascii=False)


# ---------------------------------------------------------------------------
# Victory (manual import of the issuer's own data)
# ---------------------------------------------------------------------------


def _victory_ticker(raw: str) -> str:
    # Victory uses Bloomberg-ish tickers: "ACN US", "INTU U", "XOM".
    return str(raw or "").strip().split(" ")[0].upper()


def victory_snapshot_from_top10(ticker: str, payload: dict[str, Any]) -> dict[str, Any]:
    t = ticker.upper()
    as_of = _date_iso(str(payload.get("as_of_date") or ""), ("%m/%d/%Y",))
    rows = [
        {
            "ticker": _victory_ticker(h.get("holding_ticker")),
            "name": str(h.get("holding_name") or "").strip(),
            "cusip": "",
            "weight_pct": _num(h.get("portfolio_percentage")),
            "shares": _num(h.get("shares")),
            "price": None,
            "market_value": _num(h.get("market_value")),
            "date": as_of,
        }
        for h in payload.get("holdings") or []
        if _num(h.get("portfolio_percentage")) is not None
    ]
    if len(rows) < 5:
        raise RuntimeError(f"{t}: Victory top-10 payload has {len(rows)} rows")
    src = OFFICIAL_SOURCES.get(t, {})
    return build_snapshot(
        ticker=t,
        name="VictoryShares Free Cash Flow ETF" if t == "VFLO" else f"VictoryShares {t}",
        issuer="VictoryShares",
        source="victory_top10_page",
        source_url=src.get("page"),
        source_note=(
            "VictoryShares 공식 상품 페이지의 일간 Top 10 (전체 목록 아님, Top10 합계 "
            f"{sum(r['weight_pct'] for r in rows):.1f}%). 전체 CSV는 브라우저 다운로드만 제공."
        ),
        as_of=as_of,
        holdings=_sorted(rows),
        extra={
            "holdings_as_of": as_of,
            "as_of_basis": "issuer_file",
            "disclosure": "daily",
            "coverage": "top10",
        },
    )


def victory_snapshot_from_csv(ticker: str, text: str) -> dict[str, Any]:
    """Parse the advisor.vcm.com 'All Holdings' CSV (layout tolerant)."""
    t = ticker.upper()
    lines = text.lstrip("\ufeff").splitlines()
    hdr = next(
        (i for i, l in enumerate(lines[:40]) if re.search(r"(?i)ticker|symbol", l) and re.search(r"(?i)%|percent|weight", l)),
        None,
    )
    if hdr is None:
        raise RuntimeError(f"{t}: Victory CSV header not found")
    as_of = None
    for l in lines[:hdr]:
        m = re.search(r"(\d{1,2}/\d{1,2}/\d{4})", l)
        if m:
            as_of = _date_iso(m.group(1), ("%m/%d/%Y",))
    rows: list[dict[str, Any]] = []
    for rec in csv.DictReader(io.StringIO("\n".join(lines[hdr:]))):
        low = {str(k or "").strip().lower(): v for k, v in rec.items()}
        wkey = next((k for k in low if "%" in k or "percent" in k or "weight" in k), None)
        weight = _num(low.get(wkey)) if wkey else None
        if weight is None:
            continue
        # 2026-11 layout: Date,Stock Symbol,ETF Name,ISIN,Holding,Security Type,
        # Shares,Market Value,Portfolio %  ("ETF Name" is the fund, not the holding)
        tkey = next((k for k in low if "ticker" in k or "symbol" in k), None)
        nkey = next(
            (k for k in low if k == "holding" or "holding name" in k or "description" in k),
            None,
        ) or next((k for k in low if "name" in k and "etf" not in k and "fund" not in k), None)
        skey = next((k for k in low if "shares" in k or "quantity" in k), None)
        mkey = next((k for k in low if "market" in k and "value" in k), None)
        dkey = next((k for k in low if "date" in k), None)
        if as_of is None and dkey and low.get(dkey):
            as_of = _date_iso(str(low[dkey]).strip(), ("%m/%d/%Y", "%Y-%m-%d"))
        rows.append(
            {
                "ticker": _victory_ticker(low.get(tkey, "")) if tkey else "",
                "name": str(low.get(nkey) or "").strip() if nkey else "",
                "cusip": str(low.get("isin") or "").strip(),
                "asset_class": str(low.get("security type") or "").strip(),
                "weight_pct": weight,
                "shares": _num(low.get(skey)) if skey else None,
                "price": None,
                "market_value": _num(low.get(mkey)) if mkey else None,
                "date": as_of,
            }
        )
    if not as_of:
        raise RuntimeError(f"{t}: Victory CSV has no as-of date")
    _check_weights(t, rows)
    for r in rows:
        r["date"] = as_of
    src = OFFICIAL_SOURCES.get(t, {})
    return build_snapshot(
        ticker=t,
        name="VictoryShares Free Cash Flow ETF" if t == "VFLO" else f"VictoryShares {t}",
        issuer="VictoryShares",
        source="victory_all_holdings_csv",
        source_url=src.get("page"),
        source_note="VictoryShares 공식 'All Holdings' CSV (상품 페이지 다운로드) 수동 적재.",
        as_of=as_of,
        holdings=_sorted(rows),
        extra={"holdings_as_of": as_of, "as_of_basis": "issuer_file", "disclosure": "daily", "coverage": "full"},
    )


def victory_snapshot(ticker: str) -> tuple[dict[str, Any], None]:
    raise RuntimeError(
        f"{ticker}: no automated official feed — import via --victory-json/--victory-csv "
        "(etfcheck VFLO data is inconsistent and is intentionally not published)"
    )


def import_snapshot(snap: dict[str, Any], raw: str | None) -> dict[str, Any]:
    t = snap["ticker"]
    sync_snapshots_from_r2(t)
    _attach_aum(snap)
    save_snapshot(snap, csv_text=raw)
    r2 = publish_to_r2(snap, csv_text=raw)
    return {"ticker": t, "as_of": snap["as_of"], "count": snap["count"], "r2": r2}


_FETCHERS: dict[str, Callable[[str], tuple[dict[str, Any], str | None]]] = {
    "ishares_csv": lambda t: ishares_official_snapshot(t),
    "ssga_xlsx": ssga_official_snapshot,
    "vanguard_json": vanguard_official_snapshot,
    "victory_import": victory_snapshot,
}


def official_snapshot(ticker: str) -> tuple[dict[str, Any], str | None]:
    t = ticker.upper()
    src = OFFICIAL_SOURCES[t]
    return _FETCHERS[src["kind"]](t)


def _attach_aum(snap: dict[str, Any]) -> None:
    if snap.get("aum_usd"):
        return
    try:
        import yfinance as yf

        info = yf.Ticker(snap["ticker"]).info or {}
        aum = info.get("totalAssets") or info.get("netAssets")
        if aum:
            snap["aum_usd"] = float(aum)
        if str(snap.get("name", "")).startswith(("SPDR ", "Vanguard ")) and info.get("longName"):
            snap["name"] = info["longName"]
    except Exception as exc:
        print(f"aum lookup skipped {snap.get('ticker')}: {exc}")


def collect_priority(tickers: tuple[str, ...] = PRIORITY_TICKERS) -> dict[str, Any]:
    saved: list[dict[str, Any]] = []
    errors: list[str] = []
    for t in tickers:
        try:
            sync_snapshots_from_r2(t)
            snap, raw = official_snapshot(t)
            _attach_aum(snap)
            save_snapshot(snap, csv_text=raw)
            publish_to_r2(snap, csv_text=raw)
            saved.append(
                {
                    "ticker": t,
                    "issuer": snap.get("issuer"),
                    "as_of": snap.get("as_of"),
                    "as_of_basis": snap.get("as_of_basis"),
                    "source": snap.get("source"),
                    "count": snap.get("count"),
                }
            )
        except Exception as exc:
            errors.append(f"{t}: {exc}")
            print(f"priority collect failed {t}: {exc}")
    return {"ok": bool(saved), "saved": saved, "errors": errors}


if __name__ == "__main__":
    import sys

    args = sys.argv[1:]
    if args and args[0] in ("--victory-json", "--victory-csv"):
        tick, path = args[1].upper(), args[2]
        body = open(path, encoding="utf-8-sig").read()
        if args[0] == "--victory-json":
            snap = victory_snapshot_from_top10(tick, json.loads(body))
        else:
            snap = victory_snapshot_from_csv(tick, body)
        out = import_snapshot(snap, body)
    else:
        picks = tuple(a.upper() for a in args) or PRIORITY_TICKERS
        out = collect_priority(picks)
        # Render one-off jobs do not run a shell, so collection and the R2
        # universe merge have to happen in this one process. Local runs without
        # R2 keys still only collect.
        try:
            from r2_briefs import r2_configured

            if r2_configured():
                from etf_weight_push_local import push

                out["push"] = push(picks, apply=True, archive_etfcheck=True)
        except Exception as exc:
            out["push_error"] = str(exc)
    print(json.dumps(out, ensure_ascii=False, indent=2))
