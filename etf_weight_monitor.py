"""ETF weight monitor — daily issuer holdings → durable time series.

Issuers
-------
1) Roundhill — one Filepoint CSV covers *all* funds (Account column).
   https://www.roundhillinvestments.com/assets/data/
     FilepointRoundhill.40RU.RU_Holdings_{MMDDYYYY}.csv
   Website PDF/CSV buttons are client-generated from this feed.

2) iShares — top N by Yahoo ``totalAssets``. Official ishares.com AJAX is often
   bot-blocked, so daily snapshots use etfcheck holdings (same pipeline we already
   operate) and accumulate our own date series on disk/R2.

Layout
------
  data/etf_weights/{TICKER}/snapshots/{YYYY-MM-DD}.json
  data/etf_weights/{TICKER}/latest.json
  data/etf_weights/universe.json
  R2: etf_weights/...
"""

from __future__ import annotations

import csv
import io
import json
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import requests

KST = ZoneInfo("Asia/Seoul")
ET = ZoneInfo("America/New_York")
PROJECT_DIR = Path(__file__).resolve().parent
DATA_ROOT = PROJECT_DIR / "data" / "etf_weights"
UNIVERSE_PATH = DATA_ROOT / "universe.json"

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)
SESSION = requests.Session()
SESSION.headers.update({"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9"})

FILEPOINT_BASE = (
    "https://www.roundhillinvestments.com/assets/data/"
    "FilepointRoundhill.40RU.RU_Holdings_"
)

# Skip non-product / internal accounts if any appear.
ROUNDHILL_SKIP_ACCOUNTS = {"", "CASH", "TOTAL"}

# Economic exposure groups — Roundhill UI merges cash equity + TRS for DRAM.
DRAM_GROUPS: dict[str, dict[str, Any]] = {
    "MU": {
        "label": "Micron Technology",
        "tickers": {"MU"},
        "name_tokens": ("micron technology",),
        "cusip_prefixes": ("595112103",),
    },
    "005930": {
        "label": "Samsung Electronics",
        "tickers": {"005930 KS", "005930"},
        "name_tokens": ("samsung electronics",),
        "cusip_prefixes": ("6771720", "6773812"),
    },
    "000660": {
        "label": "SK hynix",
        "tickers": {"000660 KS", "000660"},
        "name_tokens": ("sk hynix", "skhynix"),
        "cusip_prefixes": ("6450267", "78392B206"),
    },
    "SNDK": {
        "label": "Sandisk",
        "tickers": {"SNDK"},
        "name_tokens": ("sandisk",),
        "cusip_prefixes": (),
    },
    "WDC": {
        "label": "Western Digital",
        "tickers": {"WDC"},
        "name_tokens": ("western digital",),
        "cusip_prefixes": (),
    },
    "STX": {
        "label": "Seagate Technology",
        "tickers": {"STX"},
        "name_tokens": ("seagate",),
        "cusip_prefixes": (),
    },
    "285A": {
        "label": "Kioxia",
        "tickers": {"285A JP", "285A"},
        "name_tokens": ("kioxia",),
        "cusip_prefixes": (),
    },
}

# Seed universe for Yahoo AUM ranking (must be iShares US-listed).
ISHARES_AUM_CANDIDATES: tuple[str, ...] = (
    "IVV",
    "IEFA",
    "IEMG",
    "AGG",
    "IWF",
    "IJH",
    "IJR",
    "SGOV",
    "ITOT",
    "IWM",
    "IWD",
    "EFA",
    "IVW",
    "IXUS",
    "IWB",
    "IEF",
    "QUAL",
    "MUB",
    "GOVT",
    "IUSB",
    "HYG",
    "LQD",
    "EEM",
    "ACWI",
    "TLT",
    "SHY",
    "DGRO",
    "IUSG",
    "IUSV",
    "DVY",
)

DEFAULT_ISHARES_TOP_N = 15


def _ticker_dir(ticker: str) -> Path:
    return DATA_ROOT / ticker.upper()


def _snapshot_path(ticker: str, day: str) -> Path:
    return _ticker_dir(ticker) / "snapshots" / f"{day}.json"


def _latest_path(ticker: str) -> Path:
    return _ticker_dir(ticker) / "latest.json"


def _mmddyyyy(d: date) -> str:
    return f"{d.month:02d}{d.day:02d}{d.year}"


def _parse_pct(raw: str | None) -> float | None:
    if raw is None:
        return None
    s = str(raw).strip().replace(",", "").rstrip("%")
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _parse_num(raw: str | None) -> float | None:
    if raw is None:
        return None
    s = str(raw).strip().replace(",", "").replace('"', "")
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _parse_csv_date(raw: str | None) -> str | None:
    if not raw:
        return None
    s = str(raw).strip()
    for fmt in ("%m/%d/%Y", "%m/%d/%y", "%Y-%m-%d", "%Y%m%d"):
        try:
            return datetime.strptime(s, fmt).date().isoformat()
        except ValueError:
            continue
    return None


def _is_real_csv(text: str) -> bool:
    head = text.lstrip()[:200].lower()
    if head.startswith("<!doctype") or head.startswith("<html"):
        return False
    return "stockticker" in text[:2000].lower() and "account" in text[:2000].lower()


def fetch_filepoint_csv(day: date) -> tuple[str, str] | None:
    key = _mmddyyyy(day)
    url = f"{FILEPOINT_BASE}{key}.csv"
    res = SESSION.get(url, timeout=30)
    if res.status_code != 200:
        return None
    text = res.content.decode("utf-8-sig", errors="replace")
    if not _is_real_csv(text):
        return None
    return key, text


def find_latest_filepoint_csv(*, lookback_days: int = 15) -> tuple[date, str, str] | None:
    base = datetime.now(ET).date()
    for i in range(lookback_days):
        day = base - timedelta(days=i)
        hit = fetch_filepoint_csv(day)
        if hit:
            return day, hit[0], hit[1]
    return None


def list_filepoint_accounts(csv_text: str) -> list[str]:
    reader = csv.DictReader(io.StringIO(csv_text))
    accounts: set[str] = set()
    for row in reader:
        acct = (row.get("Account") or "").strip().upper()
        if not acct or acct in ROUNDHILL_SKIP_ACCOUNTS:
            continue
        accounts.add(acct)
    return sorted(accounts)


def parse_account_rows(csv_text: str, account: str) -> list[dict[str, Any]]:
    reader = csv.DictReader(io.StringIO(csv_text))
    out: list[dict[str, Any]] = []
    for row in reader:
        if (row.get("Account") or "").strip().upper() != account.upper():
            continue
        ticker = (row.get("StockTicker") or "").strip()
        name = (row.get("SecurityName") or "").strip()
        cusip = (row.get("CUSIP") or "").strip()
        weight = _parse_pct(row.get("Weightings"))
        if weight is None:
            continue
        out.append(
            {
                "ticker": ticker,
                "name": name,
                "cusip": cusip,
                "weight_pct": weight,
                "shares": _parse_num(row.get("Shares")),
                "price": _parse_num(row.get("Price")),
                "market_value": _parse_num(row.get("MarketValue")),
                "date": _parse_csv_date(row.get("Date")),
            }
        )
    out.sort(key=lambda r: -(r.get("weight_pct") or 0))
    return out


def _matches_group(row: dict[str, Any], group: dict[str, Any]) -> bool:
    ticker = (row.get("ticker") or "").strip().upper()
    name = (row.get("name") or "").strip().lower()
    cusip = (row.get("cusip") or "").strip().upper()
    for t in group.get("tickers") or ():
        if ticker == str(t).upper():
            return True
    for pref in group.get("cusip_prefixes") or ():
        if cusip.startswith(str(pref).upper()):
            return True
    for tok in group.get("name_tokens") or ():
        if tok.lower() in name:
            return True
    return False


def aggregate_economic(
    rows: list[dict[str, Any]], groups: dict[str, dict[str, Any]]
) -> list[dict[str, Any]]:
    used: set[int] = set()
    result: list[dict[str, Any]] = []
    for gid, group in groups.items():
        matched = []
        for i, row in enumerate(rows):
            if i in used:
                continue
            if _matches_group(row, group):
                matched.append(row)
                used.add(i)
        if not matched:
            continue
        result.append(
            {
                "id": gid,
                "label": group["label"],
                "weight_pct": round(sum(float(r["weight_pct"]) for r in matched), 4),
                "market_value": sum(float(r["market_value"] or 0) for r in matched) or None,
                "legs": [
                    {
                        "ticker": r["ticker"],
                        "name": r["name"],
                        "cusip": r["cusip"],
                        "weight_pct": r["weight_pct"],
                        "market_value": r.get("market_value"),
                    }
                    for r in matched
                ],
            }
        )
    result.sort(key=lambda r: -r["weight_pct"])
    return result


def top_holdings_as_economic(rows: list[dict[str, Any]], *, top_n: int = 12) -> list[dict[str, Any]]:
    """For non-DRAM funds: track top holdings as chart series ids."""
    out: list[dict[str, Any]] = []
    for row in rows[:top_n]:
        tid = (row.get("ticker") or row.get("name") or "?").strip() or "?"
        out.append(
            {
                "id": tid,
                "label": (row.get("name") or tid)[:48],
                "weight_pct": float(row.get("weight_pct") or 0),
                "market_value": row.get("market_value"),
                "legs": [
                    {
                        "ticker": row.get("ticker"),
                        "name": row.get("name"),
                        "cusip": row.get("cusip"),
                        "weight_pct": row.get("weight_pct"),
                        "market_value": row.get("market_value"),
                    }
                ],
            }
        )
    return out


def build_snapshot(
    *,
    ticker: str,
    name: str,
    issuer: str,
    source: str,
    source_url: str | None,
    source_note: str,
    as_of: str,
    holdings: list[dict[str, Any]],
    file_day: str | None = None,
    file_key: str | None = None,
    aum_usd: float | None = None,
) -> dict[str, Any]:
    ticker = ticker.upper()
    if ticker == "DRAM":
        economic = aggregate_economic(holdings, DRAM_GROUPS)
    else:
        economic = top_holdings_as_economic(holdings)
    generated_at = datetime.now(KST).isoformat()
    return {
        "ok": True,
        "ticker": ticker,
        "name": name,
        "issuer": issuer,
        "as_of": as_of,
        "file_day": file_day,
        "file_key": file_key,
        "aum_usd": aum_usd,
        "source": source,
        "source_url": source_url,
        "source_note": source_note,
        "generated_at": generated_at,
        "generated_at_display": datetime.now(KST).strftime("%Y-%m-%d %H:%M KST"),
        "count": len(holdings),
        "holdings": holdings,
        "economic": economic,
        "top10": holdings[:10],
    }


def save_snapshot(snapshot: dict[str, Any], *, csv_text: str | None = None) -> Path:
    ticker = snapshot["ticker"]
    day = snapshot["as_of"]
    root = _ticker_dir(ticker)
    (root / "snapshots").mkdir(parents=True, exist_ok=True)
    path = _snapshot_path(ticker, day)
    path.write_text(json.dumps(snapshot, ensure_ascii=False), encoding="utf-8")
    _latest_path(ticker).write_text(
        json.dumps(snapshot, ensure_ascii=False), encoding="utf-8"
    )
    if csv_text:
        raw = root / "raw"
        raw.mkdir(parents=True, exist_ok=True)
        (raw / f"{day}.csv").write_text(csv_text, encoding="utf-8")
    return path


def list_snapshot_days(ticker: str) -> list[str]:
    snap_dir = _ticker_dir(ticker) / "snapshots"
    if not snap_dir.is_dir():
        return []
    return sorted(p.stem for p in snap_dir.glob("*.json"))


def load_snapshot(ticker: str, day: str) -> dict[str, Any] | None:
    path = _snapshot_path(ticker, day)
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def load_latest(ticker: str) -> dict[str, Any] | None:
    path = _latest_path(ticker)
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def publish_to_r2(snapshot: dict[str, Any], *, csv_text: str | None = None) -> dict[str, Any]:
    result: dict[str, Any] = {"ok": False}
    try:
        from r2_briefs import r2_configured
        from r2_data import put_bytes, put_json

        if not r2_configured():
            result["error"] = "R2 not configured"
            return result
        ticker = snapshot["ticker"]
        day = snapshot["as_of"]
        put_json(f"etf_weights/{ticker}/latest.json", snapshot)
        put_json(f"etf_weights/{ticker}/snapshots/{day}.json", snapshot)
        if csv_text:
            put_bytes(
                f"etf_weights/{ticker}/raw/{day}.csv",
                csv_text.encode("utf-8"),
                "text/csv; charset=utf-8",
            )
        result["ok"] = True
    except Exception as exc:
        result["error"] = str(exc)
        print(f"etf_weight_monitor R2 publish failed ({snapshot.get('ticker')}): {exc}")
    return result


def sync_snapshots_from_r2(ticker: str) -> int:
    try:
        from r2_briefs import r2_configured
        from r2_data import get_json, list_prefix_keys

        if not r2_configured():
            return 0
        written = 0
        for key in list_prefix_keys(f"etf_weights/{ticker}/snapshots/"):
            if not key.endswith(".json"):
                continue
            day = key.rsplit("/", 1)[-1].removesuffix(".json")
            dest = _snapshot_path(ticker, day)
            if dest.is_file():
                continue
            data = get_json(key)
            if not data:
                continue
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
            written += 1
        return written
    except Exception as exc:
        print(f"etf_weight_monitor R2 sync skipped ({ticker}): {exc}")
        return 0


def save_universe(entries: list[dict[str, Any]]) -> None:
    DATA_ROOT.mkdir(parents=True, exist_ok=True)
    payload = {
        "updated_at": datetime.now(KST).isoformat(),
        "count": len(entries),
        "tickers": entries,
    }
    UNIVERSE_PATH.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    try:
        from r2_briefs import r2_configured
        from r2_data import put_json

        if r2_configured():
            put_json("etf_weights/universe.json", payload)
    except Exception as exc:
        print(f"universe R2 publish skipped: {exc}")


def load_universe() -> dict[str, Any]:
    if UNIVERSE_PATH.is_file():
        try:
            return json.loads(UNIVERSE_PATH.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            pass
    try:
        from r2_briefs import r2_configured
        from r2_data import get_json

        if r2_configured():
            remote = get_json("etf_weights/universe.json")
            if remote:
                return remote
    except Exception:
        pass
    # Fallback: scan local dirs
    tickers = []
    if DATA_ROOT.is_dir():
        for p in sorted(DATA_ROOT.iterdir()):
            if p.is_dir() and (p / "latest.json").is_file():
                latest = load_latest(p.name)
                tickers.append(
                    {
                        "ticker": p.name,
                        "name": (latest or {}).get("name") or p.name,
                        "issuer": (latest or {}).get("issuer"),
                        "as_of": (latest or {}).get("as_of"),
                        "aum_usd": (latest or {}).get("aum_usd"),
                    }
                )
    return {"updated_at": None, "count": len(tickers), "tickers": tickers}


# ---------------------------------------------------------------------------
# Roundhill
# ---------------------------------------------------------------------------


def collect_roundhill_from_csv(
    csv_text: str,
    *,
    file_day: date,
    file_key: str,
    accounts: list[str] | None = None,
) -> dict[str, Any]:
    accounts = accounts or list_filepoint_accounts(csv_text)
    saved: list[str] = []
    errors: list[str] = []
    for acct in accounts:
        try:
            rows = parse_account_rows(csv_text, acct)
            if not rows:
                continue
            as_of = rows[0].get("date") or file_day.isoformat()
            snap = build_snapshot(
                ticker=acct,
                name=f"Roundhill {acct}",
                issuer="Roundhill",
                source="roundhill_filepoint_csv",
                source_url=f"{FILEPOINT_BASE}{file_key}.csv",
                source_note=(
                    "Roundhill Filepoint daily holdings CSV (all funds in one file). "
                    "Website PDF/CSV downloads are generated from this feed."
                ),
                as_of=as_of,
                holdings=rows,
                file_day=file_day.isoformat(),
                file_key=file_key,
            )
            # Prefer DRAM display name
            if acct == "DRAM":
                snap["name"] = "Roundhill Memory ETF"
            save_snapshot(snap, csv_text=csv_text if acct == accounts[0] else None)
            publish_to_r2(snap)
            saved.append(acct)
        except Exception as exc:
            errors.append(f"{acct}: {exc}")
    return {
        "ok": bool(saved),
        "issuer": "Roundhill",
        "file_day": file_day.isoformat(),
        "file_key": file_key,
        "accounts": accounts,
        "saved": saved,
        "errors": errors,
    }


def collect_roundhill_all(*, backfill_days: int = 0) -> dict[str, Any]:
    results: list[dict[str, Any]] = []
    base = datetime.now(ET).date()
    days = list(range(max(0, backfill_days))) or [0]
    # Always include today lookback via find_latest for day=0 path
    if backfill_days <= 0:
        hit = find_latest_filepoint_csv(lookback_days=15)
        if not hit:
            return {"ok": False, "error": "No Roundhill Filepoint CSV in lookback"}
        file_day, file_key, csv_text = hit
        return collect_roundhill_from_csv(
            csv_text, file_day=file_day, file_key=file_key
        )

    seen_keys: set[str] = set()
    for i in range(backfill_days):
        day = base - timedelta(days=i)
        hit = fetch_filepoint_csv(day)
        if not hit:
            continue
        file_key, csv_text = hit
        if file_key in seen_keys:
            continue
        seen_keys.add(file_key)
        results.append(
            collect_roundhill_from_csv(csv_text, file_day=day, file_key=file_key)
        )
    saved_all = sorted({t for r in results for t in r.get("saved") or []})
    return {
        "ok": bool(saved_all),
        "issuer": "Roundhill",
        "days_processed": len(results),
        "saved_tickers": saved_all,
        "results": results,
    }


# ---------------------------------------------------------------------------
# iShares (top N by AUM)
# ---------------------------------------------------------------------------


def resolve_ishares_top_n(n: int = DEFAULT_ISHARES_TOP_N) -> list[dict[str, Any]]:
    """Rank candidate iShares tickers by Yahoo totalAssets; return top N."""
    import yfinance as yf

    ranked: list[dict[str, Any]] = []
    for ticker in ISHARES_AUM_CANDIDATES:
        try:
            info = yf.Ticker(ticker).info or {}
            aum = info.get("totalAssets") or info.get("netAssets") or 0
            name = info.get("longName") or info.get("shortName") or f"iShares {ticker}"
            ranked.append(
                {
                    "ticker": ticker,
                    "name": name,
                    "aum_usd": float(aum or 0),
                    "issuer": "iShares",
                }
            )
        except Exception as exc:
            ranked.append(
                {
                    "ticker": ticker,
                    "name": f"iShares {ticker}",
                    "aum_usd": 0.0,
                    "issuer": "iShares",
                    "error": str(exc),
                }
            )
    ranked.sort(key=lambda r: -float(r.get("aum_usd") or 0))
    return ranked[: max(1, n)]


def _ishares_snapshot_from_etfcheck(ticker: str, aum_usd: float | None = None) -> dict[str, Any]:
    from etfcheck_client import (
        EtfCheckClient,
        fetch_global_etf_item_info,
        fetch_global_etf_mast,
        fetch_global_etf_pdf_detail,
    )

    client = EtfCheckClient()
    mast = fetch_global_etf_mast(client)
    row = next(
        (
            r
            for r in mast
            if isinstance(r, dict) and str(r.get("SYMBOL") or "").upper() == ticker.upper()
        ),
        None,
    )
    if not row or not row.get("MSTARID"):
        raise RuntimeError(f"etfcheck mast missing {ticker}")
    mstar = str(row["MSTARID"])
    info = fetch_global_etf_item_info(client, mstar) or {}
    detail = fetch_global_etf_pdf_detail(client, mstar, limit=600)
    if not detail:
        raise RuntimeError(f"etfcheck holdings empty for {ticker}")

    as_of = (
        _parse_csv_date(str(info.get("TRADEDATE") or ""))
        or _parse_csv_date(str(info.get("W01010_date") or ""))
        or datetime.now(ET).date().isoformat()
    )
    name = (
        str(info.get("FUNDNAME") or row.get("FUNDNAME") or f"iShares {ticker}").strip()
    )
    aum = aum_usd
    if aum is None:
        try:
            aum = float(info.get("CLSNETASSETS") or 0) or None
        except (TypeError, ValueError):
            aum = None

    holdings: list[dict[str, Any]] = []
    for d in detail:
        weight = _parse_num(d.get("WEIGHT") if d.get("WEIGHT") is not None else d.get("HLDWGHT"))
        if weight is None:
            continue
        holdings.append(
            {
                "ticker": str(d.get("HLDTICKER") or d.get("TICKER") or "").strip(),
                "name": str(d.get("HLDNAME") or d.get("HLDSENM") or "").strip(),
                "cusip": "",
                "weight_pct": float(weight),
                "shares": _parse_num(d.get("HLDSHAR")),
                "price": None,
                "market_value": None,
                "date": as_of,
            }
        )
    holdings.sort(key=lambda r: -(r.get("weight_pct") or 0))
    return build_snapshot(
        ticker=ticker,
        name=name,
        issuer="iShares",
        source="etfcheck_global_pdf_detail",
        source_url="https://www.etfcheck.co.kr",
        source_note=(
            "iShares official AJAX is often blocked from cloud egress; daily snapshot "
            "uses etfcheck holdings and is archived to R2 so weight history accumulates "
            "on our side (unlike the live etfcheck page alone)."
        ),
        as_of=as_of,
        holdings=holdings,
        aum_usd=aum,
    )


def collect_ishares_top_n(n: int = DEFAULT_ISHARES_TOP_N) -> dict[str, Any]:
    top = resolve_ishares_top_n(n)
    saved: list[dict[str, Any]] = []
    errors: list[str] = []
    for meta in top:
        ticker = meta["ticker"]
        try:
            sync_snapshots_from_r2(ticker)
            snap = _ishares_snapshot_from_etfcheck(ticker, aum_usd=meta.get("aum_usd"))
            save_snapshot(snap)
            publish_to_r2(snap)
            saved.append(
                {
                    "ticker": ticker,
                    "as_of": snap.get("as_of"),
                    "aum_usd": snap.get("aum_usd"),
                    "count": snap.get("count"),
                }
            )
        except Exception as exc:
            errors.append(f"{ticker}: {exc}")
            print(f"ishares collect failed {ticker}: {exc}")
    return {
        "ok": bool(saved),
        "issuer": "iShares",
        "requested": n,
        "ranked": top,
        "saved": saved,
        "errors": errors,
    }


# ---------------------------------------------------------------------------
# Orchestration / API payloads
# ---------------------------------------------------------------------------


def collect_all(
    *,
    backfill_roundhill_days: int = 0,
    ishares_top_n: int = DEFAULT_ISHARES_TOP_N,
) -> dict[str, Any]:
    rh = collect_roundhill_all(backfill_days=backfill_roundhill_days)
    ishares = collect_ishares_top_n(ishares_top_n)

    # Rebuild universe index from latest snapshots
    entries: list[dict[str, Any]] = []
    rh_tickers = rh.get("saved") or rh.get("saved_tickers") or []
    if not rh_tickers and rh.get("results"):
        rh_tickers = sorted({t for r in rh["results"] for t in (r.get("saved") or [])})
    for t in rh_tickers:
        latest = load_latest(t)
        if not latest:
            continue
        entries.append(
            {
                "ticker": t,
                "name": latest.get("name") or t,
                "issuer": "Roundhill",
                "as_of": latest.get("as_of"),
                "aum_usd": latest.get("aum_usd"),
                "holdings": latest.get("count"),
            }
        )
    for row in ishares.get("saved") or []:
        t = row["ticker"]
        latest = load_latest(t)
        entries.append(
            {
                "ticker": t,
                "name": (latest or {}).get("name") or t,
                "issuer": "iShares",
                "as_of": (latest or {}).get("as_of") or row.get("as_of"),
                "aum_usd": (latest or {}).get("aum_usd") or row.get("aum_usd"),
                "holdings": (latest or {}).get("count") or row.get("count"),
            }
        )
    # de-dupe by ticker (prefer richer entry)
    by_t = {e["ticker"]: e for e in entries}
    save_universe(sorted(by_t.values(), key=lambda e: (e.get("issuer") or "", e["ticker"])))
    return {
        "ok": bool(rh.get("ok") or ishares.get("ok")),
        "roundhill": rh,
        "ishares": ishares,
        "universe_count": len(by_t),
    }


def build_history_payload(ticker: str = "DRAM") -> dict[str, Any]:
    ticker = ticker.upper()
    days = list_snapshot_days(ticker)
    series_by_id: dict[str, dict[str, float | None]] = {}
    labels: dict[str, str] = {}
    dates: list[str] = []
    for day in days:
        snap = load_snapshot(ticker, day)
        if not snap:
            continue
        dates.append(day)
        for item in snap.get("economic") or []:
            gid = str(item.get("id") or "")
            if not gid:
                continue
            labels[gid] = str(item.get("label") or gid)
            series_by_id.setdefault(gid, {})[day] = item.get("weight_pct")

    if ticker == "DRAM":
        preferred = [k for k in DRAM_GROUPS if k in series_by_id]
        others = [k for k in series_by_id if k not in preferred]
        order = preferred + others
    else:
        # keep series ordered by latest weight
        latest_day = dates[-1] if dates else None
        order = sorted(
            series_by_id.keys(),
            key=lambda k: -(series_by_id[k].get(latest_day) or 0) if latest_day else k,
        )[:12]

    series = {gid: [series_by_id[gid].get(d) for d in dates] for gid in order}
    latest = load_latest(ticker)
    return {
        "ticker": ticker,
        "dates": dates,
        "labels": {k: labels[k] for k in order if k in labels},
        "series": series,
        "snapshot_count": len(dates),
        "latest_as_of": (latest or {}).get("as_of"),
    }


def weight_monitor_payload(ticker: str = "DRAM") -> dict[str, Any]:
    ticker = ticker.upper()
    sync_snapshots_from_r2(ticker)
    latest = load_latest(ticker)
    history = build_history_payload(ticker)

    if not latest:
        try:
            from r2_briefs import r2_configured
            from r2_data import get_json

            if r2_configured():
                remote = get_json(f"etf_weights/{ticker}/latest.json")
                if remote:
                    save_snapshot(remote)
                    latest = remote
                    history = build_history_payload(ticker)
        except Exception:
            pass

    if not latest:
        return {
            "ok": False,
            "ticker": ticker,
            "error": f"No snapshot for {ticker}. Wait for scheduler or run collect_all.",
            "universe": load_universe(),
        }

    return {
        "ok": True,
        "ticker": ticker,
        "name": latest.get("name"),
        "issuer": latest.get("issuer"),
        "as_of": latest.get("as_of"),
        "aum_usd": latest.get("aum_usd"),
        "generated_at": latest.get("generated_at"),
        "generated_at_display": latest.get("generated_at_display"),
        "source": latest.get("source"),
        "source_url": latest.get("source_url"),
        "source_note": latest.get("source_note"),
        "holdings": latest.get("holdings") or [],
        "economic": latest.get("economic") or [],
        "top10": latest.get("top10") or [],
        "history": history,
        "universe": load_universe(),
        "notes": [
            "Roundhill: Filepoint 일간 CSV 1개로 전 상품 적재.",
            "iShares: Yahoo AUM 상위 15개 — etfcheck 편입 스냅샷을 우리 R2에 일자별 축적.",
            "DRAM은 현물+TRS 경제노출 합산, 그 외는 Top holdings 시계열.",
        ],
    }


# Back-compat alias used by early scheduler
def collect_ticker(ticker: str = "DRAM", *, backfill_days: int = 0) -> dict[str, Any]:
    ticker = ticker.upper()
    hit = find_latest_filepoint_csv(lookback_days=15)
    if hit and ticker in list_filepoint_accounts(hit[2]):
        if backfill_days > 0:
            collect_roundhill_all(backfill_days=backfill_days)
        else:
            collect_roundhill_from_csv(hit[2], file_day=hit[0], file_key=hit[1])
        snap = load_latest(ticker)
        return {
            "ok": bool(snap),
            "snapshot": snap,
            "r2": {"ok": True},
            "history": build_history_payload(ticker),
        }
    try:
        snap = _ishares_snapshot_from_etfcheck(ticker)
        save_snapshot(snap)
        r2 = publish_to_r2(snap)
        return {
            "ok": True,
            "snapshot": snap,
            "r2": r2,
            "history": build_history_payload(ticker),
        }
    except Exception as exc:
        return {"ok": False, "error": str(exc), "history": build_history_payload(ticker)}
