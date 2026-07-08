"""Minimal Eikon client helpers (App Key via env var only)."""

from __future__ import annotations

import os

import pandas as pd


def _get_ek():
    try:
        import eikon as ek  # type: ignore
    except Exception as exc:  # pragma: no cover
        raise RuntimeError(
            "Eikon package not installed. Run: pip install -r requirements.txt"
        ) from exc

    app_key = os.environ.get("EIKON_APP_KEY", "").strip()
    if not app_key:
        raise RuntimeError("Missing EIKON_APP_KEY (set it in .env).")

    ek.set_app_key(app_key)
    return ek


DEFAULT_BASIC_FIELDS: list[str] = [
    "TR.CommonName",
    "TR.ExchangeName",
    "TR.ICBIndustry",
    "TR.ICBSector",
    "TR.CompanyMarketCap",
    "TR.PE",
    "TR.PriceClose",
    "TR.Volume",
    "TR.TotalReturn1W",
    "TR.TotalReturn1M",
    "TR.TotalReturn1Y",
    "TR.Revenue",
    "TR.EBITDA",
    "TR.NetIncome",
]


def load_basic_stock_info(symbol: str, fields: list[str] | None = None) -> pd.DataFrame:
    """
    Return a 1-row DataFrame with basic financial items for the instrument.

    Notes:
    - Requires Eikon/Workspace running and logged in on the same machine/session.
    - Prefer RIC symbols like AAPL.O, MSFT.O, 005930.KS
    """
    ek = _get_ek()
    query = symbol.strip()
    if not query:
        raise ValueError("Empty symbol.")

    use_fields = fields or DEFAULT_BASIC_FIELDS
    df, err = ek.get_data([query], use_fields)
    if err:
        raise RuntimeError(str(err))
    if df is None or getattr(df, "empty", True):
        raise RuntimeError(f"No Eikon data returned for {symbol}")
    return df

