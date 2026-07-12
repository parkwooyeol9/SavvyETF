"""Global index dashboard (/idx): MSCI country weights → major markets → index/futures/FX."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import requests

from yahoo_market import fetch_daily_candles

KST = ZoneInfo("Asia/Seoul")
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}

# iShares US product pages (MSCI proxies for country weights)
ISHARES_PRODUCTS = {
    "acwi": {
        "label": "MSCI ACWI",
        "etf": "ACWI",
        "url": "https://www.ishares.com/us/products/239600/ishares-msci-acwi-etf",
    },
    "eem": {
        "label": "MSCI EM",
        "etf": "EEM",
        "url": "https://www.ishares.com/us/products/239637/ishares-msci-emerging-markets-etf",
    },
}

# MSCI developed / emerging membership (for deriving World from ACWI).
MSCI_DM = {
    "United States",
    "Japan",
    "United Kingdom",
    "Canada",
    "France",
    "Germany",
    "Switzerland",
    "Australia",
    "Netherlands",
    "Sweden",
    "Spain",
    "Italy",
    "Hong Kong",
    "Denmark",
    "Singapore",
    "Belgium",
    "Finland",
    "Israel",
    "Norway",
    "Ireland",
    "Austria",
    "New Zealand",
    "Portugal",
}
MSCI_EM = {
    "China",
    "Taiwan",
    "India",
    "Korea (South)",
    "South Korea",
    "Brazil",
    "Saudi Arabia",
    "South Africa",
    "Mexico",
    "Indonesia",
    "Malaysia",
    "Thailand",
    "Poland",
    "Turkey",
    "Chile",
    "Philippines",
    "Qatar",
    "Kuwait",
    "United Arab Emirates",
    "Greece",
    "Hungary",
    "Peru",
    "Colombia",
    "Czech Republic",
    "Egypt",
}

COUNTRY_ALLOWLIST = MSCI_DM | MSCI_EM

# Fallback weights if live scrape fails (approx from recent MSCI/iShares factsheets).
FALLBACK_WEIGHTS: dict[str, list[tuple[str, float]]] = {
    "acwi": [
        ("United States", 63.6),
        ("Japan", 5.0),
        ("Taiwan", 3.3),
        ("United Kingdom", 3.0),
        ("Canada", 2.9),
    ],
    "world": [
        ("United States", 71.5),
        ("Japan", 5.6),
        ("United Kingdom", 3.5),
        ("Canada", 3.3),
        ("France", 2.8),
    ],
    "eem": [
        ("Taiwan", 20.0),
        ("China", 25.0),
        ("India", 18.0),
        ("Korea (South)", 12.0),
        ("Brazil", 4.5),
    ],
}

COUNTRY_ALIASES = {
    "Korea (South)": "South Korea",
    "South Korea": "South Korea",
    "United States": "United States",
    "United Kingdom": "United Kingdom",
}


@dataclass(frozen=True)
class MarketInstruments:
    country: str
    index_symbol: str
    index_name: str
    futures_symbol: str | None
    futures_name: str | None
    fx_symbol: str | None
    fx_name: str | None


# Representative cash index + futures + FX (vs USD) for major MSCI countries.
MARKET_MAP: dict[str, MarketInstruments] = {
    "United States": MarketInstruments(
        "United States", "^GSPC", "S&P 500", "ES=F", "E-mini S&P 500", None, "USD (base)"
    ),
    "Japan": MarketInstruments(
        "Japan", "^N225", "Nikkei 225", "NKD=F", "Nikkei USD futures", "JPY=X", "USD/JPY"
    ),
    "United Kingdom": MarketInstruments(
        "United Kingdom", "^FTSE", "FTSE 100", None, None, "GBPUSD=X", "GBP/USD"
    ),
    "Canada": MarketInstruments(
        "Canada", "^GSPTSE", "S&P/TSX Composite", None, None, "CAD=X", "USD/CAD"
    ),
    "France": MarketInstruments(
        "France", "^FCHI", "CAC 40", None, None, "EURUSD=X", "EUR/USD"
    ),
    "Germany": MarketInstruments(
        "Germany", "^GDAXI", "DAX", None, None, "EURUSD=X", "EUR/USD"
    ),
    "Switzerland": MarketInstruments(
        "Switzerland", "^SSMI", "SMI", None, None, "CHF=X", "USD/CHF"
    ),
    "Australia": MarketInstruments(
        "Australia", "^AXJO", "ASX 200", None, None, "AUDUSD=X", "AUD/USD"
    ),
    "Netherlands": MarketInstruments(
        "Netherlands", "^AEX", "AEX", None, None, "EURUSD=X", "EUR/USD"
    ),
    "Hong Kong": MarketInstruments(
        "Hong Kong", "^HSI", "Hang Seng", None, None, "HKD=X", "USD/HKD"
    ),
    "Taiwan": MarketInstruments(
        "Taiwan", "^TWII", "TAIEX", None, None, "TWD=X", "USD/TWD"
    ),
    "China": MarketInstruments(
        "China", "MCHI", "iShares MSCI China (proxy)", None, None, "CNY=X", "USD/CNY"
    ),
    "India": MarketInstruments(
        "India", "^NSEI", "Nifty 50", None, None, "INR=X", "USD/INR"
    ),
    "South Korea": MarketInstruments(
        "South Korea", "^KS11", "KOSPI", None, None, "KRW=X", "USD/KRW"
    ),
    "Brazil": MarketInstruments(
        "Brazil", "^BVSP", "Bovespa", None, None, "BRL=X", "USD/BRL"
    ),
    "Saudi Arabia": MarketInstruments(
        "Saudi Arabia", "^TASI.SR", "Tadawul All Share", None, None, "SAR=X", "USD/SAR"
    ),
    "South Africa": MarketInstruments(
        "South Africa", "^JN0U.JO", "JSE Top 40", None, None, "ZAR=X", "USD/ZAR"
    ),
    "Mexico": MarketInstruments(
        "Mexico", "^MXX", "IPC Mexico", None, None, "MXN=X", "USD/MXN"
    ),
    "Sweden": MarketInstruments(
        "Sweden", "^OMX", "OMX Stockholm 30", None, None, "SEK=X", "USD/SEK"
    ),
    "Spain": MarketInstruments(
        "Spain", "^IBEX", "IBEX 35", None, None, "EURUSD=X", "EUR/USD"
    ),
    "Italy": MarketInstruments(
        "Italy", "FTSEMIB.MI", "FTSE MIB", None, None, "EURUSD=X", "EUR/USD"
    ),
    "Singapore": MarketInstruments(
        "Singapore", "^STI", "Straits Times", None, None, "SGD=X", "USD/SGD"
    ),
    "Indonesia": MarketInstruments(
        "Indonesia", "^JKSE", "Jakarta Composite", None, None, "IDR=X", "USD/IDR"
    ),
    "Thailand": MarketInstruments(
        "Thailand", "^SET.BK", "SET Index", None, None, "THB=X", "USD/THB"
    ),
    "Malaysia": MarketInstruments(
        "Malaysia", "^KLSE", "FTSE Malaysia KLCI", None, None, "MYR=X", "USD/MYR"
    ),
    "Poland": MarketInstruments(
        "Poland", "WIG20.WA", "WIG20", None, None, "PLN=X", "USD/PLN"
    ),
    "Turkey": MarketInstruments(
        "Turkey", "XU100.IS", "BIST 100", None, None, "TRY=X", "USD/TRY"
    ),
    "Israel": MarketInstruments(
        "Israel", "TA35.TA", "TA-35", None, None, "ILS=X", "USD/ILS"
    ),
    "Denmark": MarketInstruments(
        "Denmark", "^OMXC25", "OMX Copenhagen 25", None, None, "DKK=X", "USD/DKK"
    ),
    "Belgium": MarketInstruments(
        "Belgium", "^BFX", "BEL 20", None, None, "EURUSD=X", "EUR/USD"
    ),
    "Norway": MarketInstruments(
        "Norway", "OSEBX.OL", "OSEBX", None, None, "NOK=X", "USD/NOK"
    ),
    "Finland": MarketInstruments(
        "Finland", "^OMXH25", "OMX Helsinki 25", None, None, "EURUSD=X", "EUR/USD"
    ),
    "Ireland": MarketInstruments(
        "Ireland", "^ISEQ", "ISEQ Overall", None, None, "EURUSD=X", "EUR/USD"
    ),
    "Austria": MarketInstruments(
        "Austria", "^ATX", "ATX", None, None, "EURUSD=X", "EUR/USD"
    ),
    "New Zealand": MarketInstruments(
        "New Zealand", "^NZ50", "NZX 50", None, None, "NZDUSD=X", "NZD/USD"
    ),
    "Chile": MarketInstruments(
        "Chile", "^IPSA", "IPSA", None, None, "CLP=X", "USD/CLP"
    ),
    "Philippines": MarketInstruments(
        "Philippines", "PSEI.PS", "PSEi", None, None, "PHP=X", "USD/PHP"
    ),
    "Qatar": MarketInstruments(
        "Qatar", "^QSI", "QE Index", None, None, "QAR=X", "USD/QAR"
    ),
    "Kuwait": MarketInstruments(
        "Kuwait", "^KWSE", "Premier Market", None, None, "KWD=X", "USD/KWD"
    ),
    "United Arab Emirates": MarketInstruments(
        "United Arab Emirates", "DFMGI.AE", "DFM General", None, None, "AED=X", "USD/AED"
    ),
    "Greece": MarketInstruments(
        "Greece", "GD.AT", "ATHEX Composite", None, None, "EURUSD=X", "EUR/USD"
    ),
    "Hungary": MarketInstruments(
        "Hungary", "BUX.BD", "BUX", None, None, "HUF=X", "USD/HUF"
    ),
    "Peru": MarketInstruments(
        "Peru", "^SPBLPGPT", "S&P/BVL Peru General", None, None, "PEN=X", "USD/PEN"
    ),
    "Colombia": MarketInstruments(
        "Colombia", "^COLCAP", "COLCAP", None, None, "COP=X", "USD/COP"
    ),
    "Czech Republic": MarketInstruments(
        "Czech Republic", "PX.PR", "PX Index", None, None, "CZK=X", "USD/CZK"
    ),
    "Egypt": MarketInstruments(
        "Egypt", "^CASE30", "EGX 30", None, None, "EGP=X", "USD/EGP"
    ),
    "Portugal": MarketInstruments(
        "Portugal", "PSI20.LS", "PSI 20", None, None, "EURUSD=X", "EUR/USD"
    ),
}

WEIGHT_ROW_RE = re.compile(
    r"([A-Za-z][A-Za-z \-\(\)\.]+)</td><td class=\"_ws-colFund[^\"]*\"[^>]*>([\d.]+)%</td>"
)


def _normalize_country(name: str) -> str:
    name = name.strip()
    return COUNTRY_ALIASES.get(name, name)


def _parse_ishares_country_weights(html: str) -> list[tuple[str, float]]:
    seen: set[str] = set()
    rows: list[tuple[str, float]] = []
    for raw_name, raw_w in WEIGHT_ROW_RE.findall(html):
        raw_name = raw_name.strip()
        if raw_name not in COUNTRY_ALLOWLIST and _normalize_country(raw_name) not in COUNTRY_ALLOWLIST:
            continue
        name = _normalize_country(raw_name)
        try:
            weight = float(raw_w)
        except ValueError:
            continue
        if weight <= 0 or weight > 95:
            continue
        if name in seen:
            continue
        seen.add(name)
        rows.append((name, weight))
    rows.sort(key=lambda item: item[1], reverse=True)
    return rows


def fetch_ishares_country_weights(url: str) -> list[tuple[str, float]]:
    response = requests.get(url, headers=HEADERS, timeout=40)
    response.raise_for_status()
    rows = _parse_ishares_country_weights(response.text)
    if not rows:
        raise RuntimeError("No country rows parsed from iShares page")
    return rows


def _renormalize(rows: list[tuple[str, float]]) -> list[tuple[str, float]]:
    total = sum(w for _, w in rows)
    if total <= 0:
        return []
    return [(c, round(w / total * 100.0, 2)) for c, w in rows]


def load_msci_country_weights() -> dict[str, dict[str, Any]]:
    """Return ACWI / World / EM country weight packs (top list + metadata)."""
    packs: dict[str, dict[str, Any]] = {}

    # ACWI live
    acwi_meta = ISHARES_PRODUCTS["acwi"]
    try:
        acwi_rows = fetch_ishares_country_weights(acwi_meta["url"])
        acwi_source = f"iShares {acwi_meta['etf']} geographic breakdown"
    except Exception as exc:
        acwi_rows = list(FALLBACK_WEIGHTS["acwi"])
        acwi_source = f"fallback weights ({exc})"

    packs["acwi"] = {
        "key": "acwi",
        "label": "MSCI ACWI",
        "etf": "ACWI",
        "source": acwi_source,
        "weights": acwi_rows,
        "top5": acwi_rows[:5],
    }

    # World = ACWI developed markets, renormalized
    dm_rows = [(c, w) for c, w in acwi_rows if c in MSCI_DM or _normalize_country(c) in MSCI_DM]
    if len(dm_rows) >= 3:
        world_rows = _renormalize(dm_rows)
        world_source = "Derived from ACWI developed-market slice (renormalized)"
    else:
        world_rows = list(FALLBACK_WEIGHTS["world"])
        world_source = "fallback weights (ACWI DM slice unavailable)"
    packs["world"] = {
        "key": "world",
        "label": "MSCI World",
        "etf": "URTH*",
        "source": world_source,
        "weights": world_rows,
        "top5": world_rows[:5],
    }

    # EM live
    eem_meta = ISHARES_PRODUCTS["eem"]
    try:
        eem_rows = fetch_ishares_country_weights(eem_meta["url"])
        eem_source = f"iShares {eem_meta['etf']} geographic breakdown"
    except Exception as exc:
        eem_rows = list(FALLBACK_WEIGHTS["eem"])
        eem_source = f"fallback weights ({exc})"
    packs["eem"] = {
        "key": "eem",
        "label": "MSCI EM",
        "etf": "EEM",
        "source": eem_source,
        "weights": eem_rows,
        "top5": eem_rows[:5],
    }
    return packs


def select_major_countries(packs: dict[str, dict[str, Any]]) -> list[str]:
    """Union of top-5 countries across ACWI / World / EM, ranked by max weight seen."""
    best: dict[str, float] = {}
    for pack in packs.values():
        for country, weight in pack.get("top5") or []:
            country = _normalize_country(country)
            best[country] = max(best.get(country, 0.0), float(weight))
    ranked = sorted(best.items(), key=lambda item: item[1], reverse=True)
    return [country for country, _ in ranked]


def _last_session_return(symbol: str) -> dict[str, Any]:
    """Latest available daily close-to-close return for a Yahoo symbol."""
    try:
        frame = fetch_daily_candles(symbol, range_="1mo", interval="1d")
    except Exception as exc:
        return {"symbol": symbol, "error": str(exc)}
    if frame is None or frame.empty or "close" not in frame.columns:
        return {"symbol": symbol, "error": "no data"}
    closes = frame["close"].dropna()
    if len(closes) < 2:
        return {"symbol": symbol, "error": "insufficient bars", "last": float(closes.iloc[-1]) if len(closes) else None}
    last = float(closes.iloc[-1])
    prev = float(closes.iloc[-2])
    if prev == 0:
        return {"symbol": symbol, "error": "bad prev close", "last": last}
    ret = (last / prev - 1.0) * 100.0
    asof = closes.index[-1]
    asof_txt = asof.strftime("%Y-%m-%d") if hasattr(asof, "strftime") else str(asof)[:10]
    return {
        "symbol": symbol,
        "last": last,
        "prev": prev,
        "return_pct": ret,
        "asof": asof_txt,
        "error": None,
    }


def resolve_market(country: str) -> MarketInstruments | None:
    country = _normalize_country(country)
    return MARKET_MAP.get(country)


def build_country_market_rows(countries: list[str]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for country in countries:
        instruments = resolve_market(country)
        if instruments is None:
            rows.append(
                {
                    "country": country,
                    "error": "No representative index mapping configured",
                }
            )
            continue
        index = _last_session_return(instruments.index_symbol)
        futures = (
            _last_session_return(instruments.futures_symbol)
            if instruments.futures_symbol
            else {"symbol": None, "return_pct": None, "error": "n/a"}
        )
        if instruments.fx_symbol:
            fx = _last_session_return(instruments.fx_symbol)
        else:
            fx = {
                "symbol": None,
                "return_pct": None,
                "error": None,
                "note": instruments.fx_name or "USD base",
            }
        rows.append(
            {
                "country": country,
                "index_name": instruments.index_name,
                "index_symbol": instruments.index_symbol,
                "index": index,
                "futures_name": instruments.futures_name,
                "futures_symbol": instruments.futures_symbol,
                "futures": futures,
                "fx_name": instruments.fx_name,
                "fx_symbol": instruments.fx_symbol,
                "fx": fx,
            }
        )
    return rows


def build_idx_dashboard() -> dict[str, Any]:
    packs = load_msci_country_weights()
    majors = select_major_countries(packs)
    markets = build_country_market_rows(majors)
    return {
        "generated_at": datetime.now(KST).strftime("%Y-%m-%d %H:%M KST"),
        "packs": packs,
        "major_countries": majors,
        "markets": markets,
        "notes": [
            "Country weights from iShares MSCI ETF geographic breakdown (ACWI/EEM); "
            "MSCI World approximated from ACWI developed-market slice.",
            "Index/futures/FX returns are latest Yahoo daily close-to-close (%).",
            "Futures symbols are best-effort Yahoo contracts; shown as n/a when unavailable.",
        ],
    }
