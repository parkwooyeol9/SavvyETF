"""Binance REST client — spot + USDT-M futures (바이낸스엔진)."""

from __future__ import annotations

import hashlib
import hmac
import os
import time
from typing import Any
from urllib.parse import urlencode

import requests

SPOT_API = "https://api.binance.com"
FUTURES_API = "https://fapi.binance.com"
REQUEST_TIMEOUT = 20


def _keys() -> tuple[str, str] | None:
    key = (os.environ.get("BINANCE_API_KEY") or "").strip()
    secret = (os.environ.get("BINANCE_SECRET_KEY") or "").strip()
    if key and secret:
        return key, secret
    return None


def has_binance_keys() -> bool:
    return _keys() is not None


def _sign(params: dict[str, Any]) -> dict[str, Any]:
    pair = _keys()
    if not pair:
        raise RuntimeError("BINANCE_API_KEY / BINANCE_SECRET_KEY not configured")
    _, secret = pair
    params = dict(params)
    params["timestamp"] = int(time.time() * 1000)
    qs = urlencode(params, doseq=True)
    sig = hmac.new(secret.encode("utf-8"), qs.encode("utf-8"), hashlib.sha256).hexdigest()
    params["signature"] = sig
    return params


def _headers() -> dict[str, str]:
    pair = _keys()
    if not pair:
        raise RuntimeError("BINANCE_API_KEY / BINANCE_SECRET_KEY not configured")
    key, _ = pair
    return {"X-MBX-APIKEY": key, "Accept": "application/json"}


def _request(
    base: str,
    method: str,
    path: str,
    params: dict[str, Any] | None = None,
    *,
    signed: bool = False,
) -> Any:
    url = f"{base}{path}"
    p = dict(params or {})
    headers = {"Accept": "application/json"}
    if signed:
        p = _sign(p)
        headers.update(_headers())
    resp = requests.request(
        method.upper(),
        url,
        params=p if method.upper() in {"GET", "DELETE"} else None,
        data=p if method.upper() == "POST" else None,
        headers=headers,
        timeout=REQUEST_TIMEOUT,
    )
    if resp.status_code >= 400:
        raise RuntimeError(f"Binance {method} {path} failed ({resp.status_code}): {resp.text[:500]}")
    if not resp.text:
        return None
    return resp.json()


def get_futures_account() -> dict[str, Any]:
    data = _request(FUTURES_API, "GET", "/fapi/v2/account", {}, signed=True)
    return data if isinstance(data, dict) else {}


def get_usdt_balance() -> float:
    acct = get_futures_account()
    for row in acct.get("assets") or []:
        if str(row.get("asset") or "").upper() == "USDT":
            try:
                return float(row.get("availableBalance") or row.get("walletBalance") or 0)
            except (TypeError, ValueError):
                return 0.0
    return 0.0


def estimate_futures_equity_usdt() -> float:
    acct = get_futures_account()
    try:
        return float(acct.get("totalWalletBalance") or 0)
    except (TypeError, ValueError):
        return 0.0


def get_futures_position(symbol: str) -> float:
    acct = get_futures_account()
    for row in acct.get("positions") or []:
        if str(row.get("symbol") or "").upper() == symbol.upper():
            try:
                return abs(float(row.get("positionAmt") or 0))
            except (TypeError, ValueError):
                return 0.0
    return 0.0


def get_futures_prices(symbols: list[str]) -> dict[str, float]:
    out: dict[str, float] = {}
    if not symbols:
        return out
    rows = _request(FUTURES_API, "GET", "/fapi/v1/ticker/price")
    want = {s.upper() for s in symbols}
    for row in rows or []:
        sym = str(row.get("symbol") or "").upper()
        if sym in want:
            try:
                out[sym] = float(row.get("price") or 0)
            except (TypeError, ValueError):
                continue
    return out


def futures_market_order(symbol: str, side: str, quantity: float) -> dict[str, Any]:
    data = _request(
        FUTURES_API,
        "POST",
        "/fapi/v1/order",
        {
            "symbol": symbol.upper(),
            "side": side.upper(),
            "type": "MARKET",
            "quantity": f"{quantity:.6f}".rstrip("0").rstrip("."),
        },
        signed=True,
    )
    return data if isinstance(data, dict) else {}


def futures_market_buy_usdt(symbol: str, usdt_notional: float) -> dict[str, Any]:
    prices = get_futures_prices([symbol])
    px = prices.get(symbol.upper()) or 0.0
    if not (px > 0):
        raise RuntimeError(f"no price for {symbol}")
    qty = max(usdt_notional / px, 0.001)
    return futures_market_order(symbol, "BUY", qty)


def futures_market_sell_all(symbol: str) -> dict[str, Any]:
    qty = get_futures_position(symbol)
    if qty <= 0:
        return {"skipped": "no_position"}
    return futures_market_order(symbol, "SELL", qty)
