"""ETF constituent weight history for /etf_holdings.

Verdict (research, 2026-07):
- Major US ETF issuers (e.g. iShares EEM) *publish* holdings daily, including
  weight (%) for each name (Samsung Electronics = 005930 inside EEM).
- Free *historical* retrieval is uneven:
  - iShares AJAX supports `asOfDate=YYYYMMDD` (daily-capable). Live downloads are
    often bot-blocked; Internet Archive CDX retains many dated snapshots
    (not only month-ends — e.g. 2024-10-03, 2025-01-07).
  - Paid APIs (FMP / Bloomberg) offer cleaner daily history.
  - Korean ETFs: Naver exposes the current CU table; multi-year daily history is
    not openly available → we cache snapshots locally for forward accumulation.

This module builds a weight time series for (ETF, holding), charts it, and
exports Excel. Primary path: iShares (+ Wayback fallback). KR path: Naver + cache.
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import pandas as pd
import requests

from dart_data import PROJECT_DIR, _esc

KST = ZoneInfo("Asia/Seoul")
CACHE_DIR = PROJECT_DIR / "data" / "etf_holdings"
UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
SESSION = requests.Session()
SESSION.headers.update({"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9"})

# Curated iShares product paths (US site). Extend as needed.
ISHARES_PRODUCTS: dict[str, dict[str, str]] = {
    "EEM": {
        "name": "iShares MSCI Emerging Markets ETF",
        "path": "us/products/239637/ishares-msci-emerging-markets-etf",
        "ajax": "1467271812596",
    },
    "IEMG": {
        "name": "iShares Core MSCI Emerging Markets ETF",
        "path": "us/products/244050/ishares-core-msci-emerging-markets-etf",
        "ajax": "1467271812596",
    },
    "IVV": {
        "name": "iShares Core S&P 500 ETF",
        "path": "us/products/239726/ishares-core-sp-500-etf",
        "ajax": "1467271812596",
    },
    "IWM": {
        "name": "iShares Russell 2000 ETF",
        "path": "us/products/239710/ishares-russell-2000-etf",
        "ajax": "1467271812596",
    },
    "EFA": {
        "name": "iShares MSCI EAFE ETF",
        "path": "us/products/239623/ishares-msci-eafe-etf",
        "ajax": "1467271812596",
    },
    "AGG": {
        "name": "iShares Core U.S. Aggregate Bond ETF",
        "path": "us/products/239458/ishares-core-total-us-bond-market-etf",
        "ajax": "1467271812596",
    },
    "SOXX": {
        "name": "iShares Semiconductor ETF",
        "path": "us/products/239705/ishares-phlx-semiconductor-etf",
        "ajax": "1467271812596",
    },
    "ACWI": {
        "name": "iShares MSCI ACWI ETF",
        "path": "us/products/239600/ishares-msci-acwi-etf",
        "ajax": "1467271812596",
    },
}

# Common holding aliases → issuer ticker / search tokens
HOLDING_ALIASES: dict[str, list[str]] = {
    "삼성전자": ["005930", "SAMSUNG ELECTRONICS"],
    "삼성": ["005930", "SAMSUNG ELECTRONICS"],
    "samsung": ["005930", "SAMSUNG ELECTRONICS"],
    "samsung electronics": ["005930", "SAMSUNG ELECTRONICS"],
    "005930": ["005930", "KR7005930003", "SAMSUNG ELECTRONICS"],
    "하이닉스": ["000660", "SK HYNIX"],
    "sk하이닉스": ["000660", "SK HYNIX"],
    "000660": ["000660", "SK HYNIX"],
    "tsmc": ["2330", "TAIWAN SEMICONDUCTOR"],
    "2330": ["2330", "TAIWAN SEMICONDUCTOR"],
    "aapl": ["AAPL", "APPLE INC"],
    "msft": ["MSFT", "MICROSOFT"],
    "nvda": ["NVDA", "NVIDIA"],
}


@dataclass
class WeightPoint:
    asof: date
    weight_pct: float
    shares: float | None = None
    market_value: float | None = None
    holding_ticker: str = ""
    holding_name: str = ""
    source: str = ""


def is_etf_holdings_command(command: str) -> bool:
    parts = command.strip().split()
    if not parts:
        return False
    head = parts[0].lower()
    if head in {"/etf_holdings", "/etfholdings", "/etf_holding", "/holdings"}:
        return True
    if head == "/etf" and len(parts) >= 2 and parts[1].lower() in {
        "holdings",
        "holding",
        "편입",
        "편입비",
    }:
        return True
    return False


def parse_etf_holdings_query(command: str) -> tuple[str, str]:
    """Parse `/etf_holdings EEM 005930` or `/etf holdings EEM 삼성전자`."""
    parts = command.strip().split()
    if not parts:
        raise ValueError("missing args")
    head = parts[0].lower()
    rest = parts[1:]
    if head == "/etf" and rest and rest[0].lower() in {
        "holdings",
        "holding",
        "편입",
        "편입비",
    }:
        rest = rest[1:]
    if len(rest) < 2:
        raise ValueError(
            "Usage: /etf_holdings <ETF> <holding>\n"
            "Example: /etf_holdings EEM 005930\n"
            "Example: /etf holdings EEM 삼성전자"
        )
    etf = rest[0].strip().upper()
    holding = " ".join(rest[1:]).strip()
    if not etf or not holding:
        raise ValueError("ETF ticker and holding code/name required")
    return etf, holding


def _holding_match_tokens(holding: str) -> list[str]:
    key = holding.strip().lower()
    tokens = list(HOLDING_ALIASES.get(key, []))
    raw = holding.strip()
    if raw not in tokens:
        tokens.append(raw)
    if raw.upper() not in {t.upper() for t in tokens}:
        tokens.append(raw.upper())
    # digit-only KR codes
    if re.fullmatch(r"\d{6}", raw):
        tokens.append(raw)
    return tokens


def _row_matches_holding(row_blob: str, tokens: list[str]) -> bool:
    blob = row_blob.upper()
    for tok in tokens:
        t = tok.upper().strip()
        if not t:
            continue
        if t in blob:
            return True
    return False


def _parse_num(raw: Any) -> float | None:
    if raw is None:
        return None
    if isinstance(raw, (int, float)):
        return float(raw)
    if isinstance(raw, dict):
        if "raw" in raw:
            return _parse_num(raw.get("raw"))
        if "display" in raw:
            return _parse_num(raw.get("display"))
    text = str(raw).replace(",", "").replace("%", "").replace("$", "").strip()
    if not text or text in {"-", "N/A", "null"}:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _cell_text(raw: Any) -> str:
    if isinstance(raw, dict):
        return str(raw.get("display") or raw.get("raw") or "")
    return str(raw or "")


def _ishares_ajax_url(product: dict[str, str]) -> str:
    return f"https://www.ishares.com/{product['path']}/{product['ajax']}.ajax"


def _is_json_payload(content: bytes) -> bool:
    sample = content.lstrip().lstrip(b"\xef\xbb\xbf")[:1]
    return sample in (b"{", b"[")


def _fetch_ishares_live(product: dict[str, str], asof: str | None) -> dict | None:
    params: dict[str, str] = {"tab": "all", "fileType": "json"}
    if asof:
        params["asOfDate"] = asof
    url = _ishares_ajax_url(product)
    try:
        resp = SESSION.get(
            url,
            params=params,
            headers={
                "Referer": f"https://www.ishares.com/{product['path']}",
                "X-Requested-With": "XMLHttpRequest",
                "Accept": "application/json, text/javascript, */*; q=0.01",
            },
            timeout=15,
        )
    except requests.RequestException:
        return None
    if resp.status_code != 200 or not _is_json_payload(resp.content):
        return None
    try:
        return json.loads(resp.content.decode("utf-8-sig"))
    except json.JSONDecodeError:
        return None


def _cdx_snapshots(product: dict[str, str], limit: int = 120) -> list[tuple[str, str]]:
    """Return [(wayback_ts, original_url), ...] for iShares holdings AJAX."""
    ajax = _ishares_ajax_url(product).replace("https://", "")
    try:
        resp = SESSION.get(
            "https://web.archive.org/cdx/search/cdx",
            params={
                "url": f"{ajax}*",
                "output": "json",
                "fl": "timestamp,original,statuscode,mimetype",
                "filter": "statuscode:200",
                "limit": str(limit),
            },
            timeout=90,
        )
        resp.raise_for_status()
        rows = resp.json()
    except Exception:
        return []
    out: list[tuple[str, str]] = []
    for row in rows[1:]:
        ts, original, _status, mime = row[0], row[1], row[2], row[3]
        if "json" not in (mime or "") and "fileType=json" not in original:
            continue
        out.append((ts, original))
    return out


def _fetch_wayback_json(ts: str, original: str) -> dict | None:
    urls = [
        f"https://web.archive.org/web/{ts}id_/{original}",
        f"https://web.archive.org/web/{ts}if_/{original}",
    ]
    for url in urls:
        try:
            resp = SESSION.get(url, timeout=20)
        except requests.RequestException:
            continue
        if resp.status_code != 200 or not _is_json_payload(resp.content):
            continue
        try:
            return json.loads(resp.content.decode("utf-8-sig"))
        except json.JSONDecodeError:
            continue
    return None


_ASSET_CLASSES = {
    "equity",
    "money market",
    "futures",
    "cash",
    "bond",
    "commodity",
    "fixed income",
}


def _row_weight_shares_mkt(
    row: list | tuple,
) -> tuple[float | None, float | None, float | None]:
    """iShares aaData column order changed over time — detect weight safely."""
    if len(row) < 4:
        return None, None, None
    c2 = _cell_text(row[2]).strip().lower()
    c3 = _cell_text(row[3]).strip().lower() if len(row) > 3 else ""

    # Modern: ticker, name, sector, assetClass, marketValue, weight%, notional, shares, …
    if len(row) > 5 and (c3 in _ASSET_CLASSES or c3.replace("-", " ") in _ASSET_CLASSES):
        weight = _parse_num(row[5])
        shares = _parse_num(row[7]) if len(row) > 7 else None
        mkt = _parse_num(row[4])
        if weight is not None and 0 <= weight <= 100:
            return weight, shares, mkt

    # Legacy: ticker, name, assetClass, weight%, price, shares, marketValue, …
    if c2 in _ASSET_CLASSES or c2.replace("-", " ") in _ASSET_CLASSES:
        weight = _parse_num(row[3])
        shares = _parse_num(row[5]) if len(row) > 5 else None
        mkt = _parse_num(row[6]) if len(row) > 6 else None
        if weight is not None and 0 <= weight <= 100:
            return weight, shares, mkt

    # Fallback: first percentage-like numeric field in (0, 100]
    for idx, cell in enumerate(row[2:], start=2):
        val = _parse_num(cell)
        if val is None or val <= 0 or val > 100:
            continue
        # skip FX-looking rates near 1000+ already excluded; prefer early columns
        return val, None, None
    return None, None, None


def _extract_holding_from_aa(
    payload: dict, tokens: list[str]
) -> tuple[str, str, float, float | None, float | None] | None:
    rows = payload.get("aaData")
    if not isinstance(rows, list):
        return None
    best = None
    for row in rows:
        if not isinstance(row, (list, tuple)) or len(row) < 4:
            continue
        blob = " | ".join(_cell_text(c) for c in row)
        if not _row_matches_holding(blob, tokens):
            continue
        ticker = _cell_text(row[0]).strip()
        name = _cell_text(row[1]).strip()
        weight, shares, mkt = _row_weight_shares_mkt(row)
        if weight is None:
            continue
        score = 0
        if any(
            t.upper() == ticker.upper()
            for t in tokens
            if re.fullmatch(r"[A-Z0-9.\-]{1,12}", t.upper())
        ):
            score += 5
        if "NON VOTING" in name.upper() or "PREF" in name.upper():
            score -= 2
        cand = (score, ticker, name, weight, shares, mkt)
        if best is None or cand[0] > best[0]:
            best = cand
    if not best:
        return None
    _, ticker, name, weight, shares, mkt = best
    return ticker, name, weight, shares, mkt


def _asof_from_url_or_header(original: str, payload: dict) -> date | None:
    m = re.search(r"asOfDate=(\d{8})", original)
    if m:
        try:
            return datetime.strptime(m.group(1), "%Y%m%d").date()
        except ValueError:
            pass
    # unused payload metadata for now
    _ = payload
    return None


def _month_end_candidates(months: int = 36) -> list[str]:
    """Generate likely iShares asOfDate strings (month-end window)."""
    today = date.today()
    out: list[str] = []
    y, m = today.year, today.month
    for _ in range(months):
        # last calendar day of month
        if m == 12:
            last = date(y, 12, 31)
        else:
            last = date(y, m + 1, 1) - timedelta(days=1)
        for delta in range(0, 6):
            d = last - timedelta(days=delta)
            out.append(d.strftime("%Y%m%d"))
        m -= 1
        if m == 0:
            m = 12
            y -= 1
    # recent trading days for near-daily attempt
    for delta in range(0, 14):
        out.append((today - timedelta(days=delta)).strftime("%Y%m%d"))
    # unique preserve order
    seen: set[str] = set()
    ordered: list[str] = []
    for a in out:
        if a not in seen:
            seen.add(a)
            ordered.append(a)
    return ordered


def fetch_ishares_weight_history(
    etf: str,
    holding: str,
    *,
    max_points: int = 48,
) -> list[WeightPoint]:
    product = ISHARES_PRODUCTS.get(etf.upper())
    if not product:
        raise RuntimeError(
            f"'{etf}' is not in the iShares product map yet. "
            f"Supported: {', '.join(sorted(ISHARES_PRODUCTS))}"
        )
    tokens = _holding_match_tokens(holding)
    points: dict[date, WeightPoint] = {}

    # 1) Wayback CDX dated snapshots (works even when live is blocked)
    snaps = _cdx_snapshots(product)
    dated = [(ts, orig) for ts, orig in snaps if "asOfDate=" in orig]
    undated = [(ts, orig) for ts, orig in snaps if "asOfDate=" not in orig]
    # One snapshot per asOfDate (keep newest archive timestamp)
    by_asof: dict[str, tuple[str, str]] = {}
    for ts, orig in dated:
        m = re.search(r"asOfDate=(\d{8})", orig)
        if not m:
            continue
        key = m.group(1)
        prev = by_asof.get(key)
        if prev is None or ts > prev[0]:
            by_asof[key] = (ts, orig)
    ordered_dated = [by_asof[k] for k in sorted(by_asof.keys())]
    # Prefer recent history; keep request count bounded for Telegram latency
    fetch_list = ordered_dated[-max_points:]
    if len(points) < 8:
        fetch_list = fetch_list + undated[:2]
    for ts, orig in fetch_list:
        if len(points) >= max_points:
            break
        payload = _fetch_wayback_json(ts, orig)
        if not payload:
            continue
        extracted = _extract_holding_from_aa(payload, tokens)
        if not extracted:
            continue
        asof = _asof_from_url_or_header(orig, payload)
        if asof is None:
            try:
                asof = datetime.strptime(ts[:8], "%Y%m%d").date()
            except ValueError:
                continue
        ticker, name, weight, shares, mkt = extracted
        if not (0 <= weight <= 100):
            continue
        points[asof] = WeightPoint(
            asof=asof,
            weight_pct=weight,
            shares=shares,
            market_value=mkt,
            holding_ticker=ticker,
            holding_name=name,
            source="ishares/wayback",
        )
        time.sleep(0.05)

    # 2) Live iShares — probe once; only expand if the endpoint is reachable
    probe = _fetch_ishares_live(product, None)
    if probe is None:
        probe = _fetch_ishares_live(product, date.today().strftime("%Y%m%d"))
    if probe is not None:
        live_payloads: list[tuple[str | None, dict]] = [(None, probe)]
        for asof_s in _month_end_candidates(24)[:36]:
            payload = _fetch_ishares_live(product, asof_s)
            if payload:
                live_payloads.append((asof_s, payload))
        for asof_s, payload in live_payloads:
            if len(points) >= max_points * 2:
                break
            extracted = _extract_holding_from_aa(payload, tokens)
            if not extracted:
                continue
            asof = (
                date.today()
                if asof_s is None
                else datetime.strptime(asof_s, "%Y%m%d").date()
            )
            ticker, name, weight, shares, mkt = extracted
            points[asof] = WeightPoint(
                asof=asof,
                weight_pct=weight,
                shares=shares,
                market_value=mkt,
                holding_ticker=ticker,
                holding_name=name,
                source="ishares/live",
            )

    series = sorted(points.values(), key=lambda p: p.asof)
    if not series:
        raise RuntimeError(
            f"No weight history for {holding} inside {etf}. "
            "iShares live feed may be blocked; Wayback had no matching rows."
        )
    return series


def _kr_current_weight(etf: str, holding: str) -> WeightPoint | None:
    """Current CU weight from Naver for 6-digit KR ETF tickers."""
    if not re.fullmatch(r"[0-9A-Za-z]{6}", etf):
        return None
    try:
        from dart_etf_memb import fetch_etf_holdings, fetch_etf_meta
    except Exception:
        return None
    try:
        holdings = fetch_etf_holdings(etf)
        meta = fetch_etf_meta(etf)
    except Exception:
        return None
    tokens = _holding_match_tokens(holding)
    best = None
    for row in holdings:
        blob = f"{row.get('code','')}|{row.get('name','')}"
        if not _row_matches_holding(blob, tokens):
            continue
        w = row.get("weight_pct")
        if w is None:
            continue
        best = WeightPoint(
            asof=date.today(),
            weight_pct=float(w),
            shares=_parse_num(row.get("shares")),
            market_value=None,
            holding_ticker=str(row.get("code") or ""),
            holding_name=str(row.get("name") or ""),
            source="naver/kr",
        )
        break
    _ = meta
    return best


def _cache_path(etf: str, holding_key: str) -> Path:
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", f"{etf}_{holding_key}".upper())
    return CACHE_DIR / f"{safe}.json"


def _load_cache(etf: str, holding: str) -> list[WeightPoint]:
    path = _cache_path(etf, holding)
    if not path.exists():
        return []
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return []
    out: list[WeightPoint] = []
    for row in raw.get("points") or []:
        try:
            out.append(
                WeightPoint(
                    asof=datetime.strptime(row["asof"], "%Y-%m-%d").date(),
                    weight_pct=float(row["weight_pct"]),
                    shares=row.get("shares"),
                    market_value=row.get("market_value"),
                    holding_ticker=str(row.get("holding_ticker") or ""),
                    holding_name=str(row.get("holding_name") or ""),
                    source=str(row.get("source") or "cache"),
                )
            )
        except Exception:
            continue
    return out


def _save_cache(etf: str, holding: str, points: list[WeightPoint], meta: dict) -> Path:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = _cache_path(etf, holding)
    payload = {
        "etf": etf,
        "holding_query": holding,
        "updated_at": datetime.now(KST).isoformat(),
        "meta": meta,
        "points": [
            {
                "asof": p.asof.isoformat(),
                "weight_pct": p.weight_pct,
                "shares": p.shares,
                "market_value": p.market_value,
                "holding_ticker": p.holding_ticker,
                "holding_name": p.holding_name,
                "source": p.source,
            }
            for p in points
        ],
    }
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def merge_points(*series: list[WeightPoint]) -> list[WeightPoint]:
    by_date: dict[date, WeightPoint] = {}
    for points in series:
        for p in points:
            prev = by_date.get(p.asof)
            # Prefer live over wayback/cache when same date
            if prev is None or (p.source.endswith("/live") and not prev.source.endswith("/live")):
                by_date[p.asof] = p
            elif prev is None:
                by_date[p.asof] = p
    return sorted(by_date.values(), key=lambda p: p.asof)


def build_etf_holdings_profile(etf: str, holding: str) -> dict[str, Any]:
    etf_u = etf.strip().upper()
    holding_q = holding.strip()
    cached = _load_cache(etf_u, holding_q)
    notes: list[str] = []
    points: list[WeightPoint] = []
    etf_name = etf_u
    frequency_note = ""

    if etf_u in ISHARES_PRODUCTS:
        etf_name = ISHARES_PRODUCTS[etf_u]["name"]
        try:
            points = fetch_ishares_weight_history(etf_u, holding_q)
            notes.append("iShares holdings AJAX (+ Wayback archive fallback)")
        except Exception as exc:
            notes.append(f"iShares fetch issue: {exc}")
            points = []
        frequency_note = (
            "발행사는 일간 공시하나, 무료 히스토리는 아카이브/월말 샘플 중심입니다. "
            "라이브 asOfDate가 열리면 일간에 가깝게 채워집니다."
        )
    else:
        kr_pt = _kr_current_weight(etf_u, holding_q)
        if kr_pt:
            points = [kr_pt]
            notes.append("Naver CU (current only)")
            frequency_note = (
                "국내 ETF는 당일 편입비만 공개 소스가 확실합니다. "
                "이후 /etf_holdings 실행·스케줄로 일간 스냅샷을 축적합니다."
            )
            try:
                from dart_etf_memb import fetch_etf_meta

                meta = fetch_etf_meta(etf_u)
                etf_name = str(meta.get("stockName") or etf_u)
            except Exception:
                pass
        else:
            raise RuntimeError(
                f"Unsupported ETF '{etf_u}'. "
                f"iShares map: {', '.join(sorted(ISHARES_PRODUCTS))} "
                "or a 6-digit Korean ETF ticker."
            )

    merged = merge_points(cached, points)
    if not merged:
        raise RuntimeError(f"No weight points for {holding_q} in {etf_u}")

    cache_path = _save_cache(
        etf_u,
        holding_q,
        merged,
        meta={
            "etf_name": etf_name,
            "notes": notes,
            "frequency_note": frequency_note,
        },
    )

    first, last = merged[0], merged[-1]
    delta = last.weight_pct - first.weight_pct
    df = pd.DataFrame(
        [
            {
                "asof": p.asof.isoformat(),
                "weight_pct": round(p.weight_pct, 6),
                "shares": p.shares,
                "market_value": p.market_value,
                "holding_ticker": p.holding_ticker,
                "holding_name": p.holding_name,
                "source": p.source,
            }
            for p in merged
        ]
    )

    return {
        "etf": etf_u,
        "etf_name": etf_name,
        "holding_query": holding_q,
        "holding_ticker": last.holding_ticker,
        "holding_name": last.holding_name,
        "points": merged,
        "dataframe": df,
        "latest_weight_pct": last.weight_pct,
        "first_weight_pct": first.weight_pct,
        "delta_weight_pct": delta,
        "n_points": len(merged),
        "start": first.asof.isoformat(),
        "end": last.asof.isoformat(),
        "notes": notes,
        "frequency_note": frequency_note,
        "cache_path": str(cache_path),
        "generated_at": datetime.now(KST).strftime("%Y-%m-%d %H:%M KST"),
        "feasibility": {
            "daily_published": True if etf_u in ISHARES_PRODUCTS else "KR current CU",
            "historical_free": (
                "partial (iShares asOfDate / Wayback; often sparse)"
                if etf_u in ISHARES_PRODUCTS
                else "accumulate via local snapshots"
            ),
        },
    }


def format_etf_holdings_telegram(profile: dict[str, Any]) -> str:
    lines = [
        f"<b>ETF 편입비 시계열</b> — {_esc(profile['etf'])} / {_esc(profile['holding_ticker'] or profile['holding_query'])}",
        f"{_esc(profile['etf_name'])}",
        f"편입: {_esc(profile['holding_name'] or profile['holding_query'])}",
        "",
        f"관측 {_esc(str(profile['n_points']))}점 · {_esc(profile['start'])} → {_esc(profile['end'])}",
        (
            f"최신 편입비 <b>{profile['latest_weight_pct']:.4f}%</b> "
            f"(기간 Δ {profile['delta_weight_pct']:+.4f}%p)"
        ),
        "",
        "<pre>"
        + _esc(
            profile["dataframe"][["asof", "weight_pct", "source"]]
            .tail(12)
            .to_string(index=False)
        )
        + "</pre>",
        "",
        f"※ {_esc(profile.get('frequency_note') or '')}",
        f"출처: {_esc(', '.join(profile.get('notes') or []) or 'n/a')}",
        f"생성: {_esc(profile['generated_at'])}",
    ]
    return "\n".join(lines)


def format_etf_holdings_chart_caption(profile: dict[str, Any]) -> str:
    return (
        f"{profile['etf']} 내 {profile['holding_ticker'] or profile['holding_query']} "
        f"편입비 추이 ({profile['n_points']} points)"
    )


def run_etf_holdings(etf: str, holding: str) -> dict[str, Any]:
    from etf_holdings_charts import plot_etf_holdings_chart
    from etf_holdings_excel import export_etf_holdings_excel

    profile = build_etf_holdings_profile(etf, holding)
    chart = plot_etf_holdings_chart(profile)
    xlsx = export_etf_holdings_excel(profile)
    text = format_etf_holdings_telegram(profile)
    telegram_messages: list[dict] = [
        {
            "text": format_etf_holdings_chart_caption(profile),
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
