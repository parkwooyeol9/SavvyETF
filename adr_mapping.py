"""ADR symbol registry + US listing date resolution."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

import yfinance as yf


@dataclass(frozen=True)
class AdrProfile:
    adr_symbol: str
    underlying_symbol: str
    home_exchange: str
    company_name: str
    adr_to_ordinary_ratio: float
    listing_date: date | None  # US ADR listing date, if curated
    listing_source: str


# Curated ADR → underlying map (Yahoo Finance symbols).
# listing_date: US ADR / NYSE-NASDAQ debut when available (YYYY-MM-DD). Optional.
ADR_REGISTRY: dict[str, dict] = {
    "TSM": {
        "underlying": "2330.TW",
        "exchange": "TWSE",
        "name": "Taiwan Semiconductor",
        "ratio": 5.0,
        "listing_date": "1996-10-17",
    },
    "ASML": {
        "underlying": "ASML.AS",
        "exchange": "Euronext Amsterdam",
        "name": "ASML Holding",
        "ratio": 1.0,
        "listing_date": "1995-03-15",
    },
    "ARM": {
        "underlying": "ARM",
        "exchange": "NASDAQ (IPO)",
        "name": "Arm Holdings",
        "ratio": 1.0,
        "listing_date": "2023-09-14",
    },
    "BABA": {
        "underlying": "9988.HK",
        "exchange": "HKEX",
        "name": "Alibaba Group",
        "ratio": 8.0,
        "listing_date": "2014-09-19",
    },
    "TM": {
        "underlying": "7203.T",
        "exchange": "TSE",
        "name": "Toyota Motor",
        "ratio": 2.0,
        "listing_date": "1999-09-29",
    },
    "NVO": {
        "underlying": "NOVO-B.CO",
        "exchange": "OMX Copenhagen",
        "name": "Novo Nordisk",
        "ratio": 1.0,
        "listing_date": "1981-10-30",
    },
    "SAP": {
        "underlying": "SAP.DE",
        "exchange": "XETRA",
        "name": "SAP SE",
        "ratio": 1.0,
        "listing_date": "1988-08-03",
    },
    "SONY": {
        "underlying": "6758.T",
        "exchange": "TSE",
        "name": "Sony Group",
        "ratio": 1.0,
        "listing_date": "1970-09-17",
    },
    "BIDU": {
        "underlying": "9888.HK",
        "exchange": "HKEX",
        "name": "Baidu",
        "ratio": 8.0,
        "listing_date": "2005-08-05",
    },
    "NVS": {
        "underlying": "NOVN.SW",
        "exchange": "SIX Swiss",
        "name": "Novartis",
        "ratio": 1.0,
        "listing_date": "1996-12-11",
    },
    "UL": {
        "underlying": "ULVR.L",
        "exchange": "LSE",
        "name": "Unilever",
        "ratio": 1.0,
        "listing_date": "1961-11-15",
    },
    "HSBC": {
        "underlying": "0005.HK",
        "exchange": "HKEX",
        "name": "HSBC Holdings",
        "ratio": 5.0,
        "listing_date": "1991-07-29",
    },
    "BP": {
        "underlying": "BP.L",
        "exchange": "LSE",
        "name": "BP plc",
        "ratio": 6.0,
        "listing_date": "1987-10-22",
    },
    "SNY": {
        "underlying": "SAN.PA",
        "exchange": "Euronext Paris",
        "name": "Sanofi",
        "ratio": 0.5,
        "listing_date": "1995-12-18",
    },
    "TCEHY": {
        "underlying": "0700.HK",
        "exchange": "HKEX",
        "name": "Tencent (OTC ADR)",
        "ratio": 1.0,
        "listing_date": None,
    },
}


def _parse_date(value: str | None) -> date | None:
    if not value:
        return None
    return date.fromisoformat(value)


def resolve_adr(symbol: str) -> AdrProfile:
    key = symbol.strip().upper()
    if key not in ADR_REGISTRY:
        known = ", ".join(sorted(ADR_REGISTRY))
        raise ValueError(f"Unknown ADR '{symbol}'. Add it to ADR_REGISTRY. Known: {known}")
    row = ADR_REGISTRY[key]
    return AdrProfile(
        adr_symbol=key,
        underlying_symbol=row["underlying"],
        home_exchange=row["exchange"],
        company_name=row["name"],
        adr_to_ordinary_ratio=float(row.get("ratio", 1.0)),
        listing_date=_parse_date(row.get("listing_date")),
        listing_source="registry",
    )


def detect_us_listing_date(adr_symbol: str) -> tuple[date, str]:
    """First US trading date for the ADR via yfinance."""
    ticker = yf.Ticker(adr_symbol)
    info = ticker.info or {}
    epoch = info.get("firstTradeDateEpochUtc")
    if epoch:
        import datetime as dt

        return dt.datetime.utcfromtimestamp(epoch).date(), "yfinance:firstTradeDate"

    history = ticker.history(period="max", auto_adjust=True)
    if history.empty:
        raise ValueError(f"No price history for ADR {adr_symbol}")

    first = history.index.min()
    if hasattr(first, "date"):
        first = first.date()
    return first, "yfinance:history_start"


def get_listing_date(profile: AdrProfile) -> tuple[date, str]:
    """US ADR listing date: registry override, else first US trade on ADR ticker."""
    if profile.listing_date:
        return profile.listing_date, profile.listing_source
    return detect_us_listing_date(profile.adr_symbol)

