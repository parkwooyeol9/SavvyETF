"""Binance REST client — USDT-M futures (바이낸스엔진)."""

from __future__ import annotations

import hashlib
import hmac
import math
import os
import time
from typing import Any
from urllib.parse import urlencode

import requests

FUTURES_API = "https://fapi.binance.com"
REQUEST_TIMEOUT = 20

_SYMBOL_FILTERS: dict[str, dict[str, float]] = {}


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
    method: str,
    path: str,
    params: dict[str, Any] | None = None,
    *,
    signed: bool = False,
) -> Any:
    url = f"{FUTURES_API}{path}"
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


def get_exchange_info() -> dict[str, Any]:
    data = _request("GET", "/fapi/v1/exchangeInfo")
    return data if isinstance(data, dict) else {}


def symbol_exists(symbol: str) -> bool:
    sym = symbol.upper()
    info = get_exchange_info()
    for row in info.get("symbols") or []:
        if str(row.get("symbol") or "").upper() == sym:
            return str(row.get("status") or "").upper() == "TRADING"
    return False


def _load_symbol_filters(symbol: str) -> dict[str, float]:
    sym = symbol.upper()
    if sym in _SYMBOL_FILTERS:
        return _SYMBOL_FILTERS[sym]
    info = get_exchange_info()
    out = {"step_size": 0.001, "min_qty": 0.001, "min_notional": 5.0}
    for row in info.get("symbols") or []:
        if str(row.get("symbol") or "").upper() != sym:
            continue
        for f in row.get("filters") or []:
            ftype = str(f.get("filterType") or "")
            if ftype == "LOT_SIZE":
                out["step_size"] = float(f.get("stepSize") or out["step_size"])
                out["min_qty"] = float(f.get("minQty") or out["min_qty"])
            elif ftype == "MIN_NOTIONAL":
                out["min_notional"] = float(f.get("notional") or f.get("minNotional") or out["min_notional"])
        break
    _SYMBOL_FILTERS[sym] = out
    return out


def round_quantity(symbol: str, quantity: float) -> float:
    filters = _load_symbol_filters(symbol)
    step = filters["step_size"]
    if step <= 0:
        return quantity
    precision = max(0, int(round(-math.log10(step)))) if step < 1 else 0
    rounded = math.floor(quantity / step) * step
    return round(rounded, precision)


def get_futures_account() -> dict[str, Any]:
    data = _request("GET", "/fapi/v2/account", {}, signed=True)
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


def get_futures_position_signed(symbol: str) -> float:
    """Signed position amount (+ long, − short)."""
    acct = get_futures_account()
    for row in acct.get("positions") or []:
        if str(row.get("symbol") or "").upper() == symbol.upper():
            try:
                return float(row.get("positionAmt") or 0)
            except (TypeError, ValueError):
                return 0.0
    return 0.0


def get_futures_position(symbol: str) -> float:
    return abs(get_futures_position_signed(symbol))


def get_futures_prices(symbols: list[str]) -> dict[str, float]:
    out: dict[str, float] = {}
    if not symbols:
        return out
    rows = _request("GET", "/fapi/v1/ticker/price")
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
    qty = round_quantity(symbol, quantity)
    filters = _load_symbol_filters(symbol)
    if qty < filters["min_qty"]:
        raise RuntimeError(f"quantity {qty} below min {filters['min_qty']} for {symbol}")
    data = _request(
        "POST",
        "/fapi/v1/order",
        {
            "symbol": symbol.upper(),
            "side": side.upper(),
            "type": "MARKET",
            "quantity": f"{qty:.8f}".rstrip("0").rstrip("."),
        },
        signed=True,
    )
    return data if isinstance(data, dict) else {}


def futures_market_buy_usdt(symbol: str, usdt_notional: float) -> dict[str, Any]:
    prices = get_futures_prices([symbol])
    px = prices.get(symbol.upper()) or 0.0
    if not (px > 0):
        raise RuntimeError(f"no price for {symbol}")
    qty = usdt_notional / px
    return futures_market_order(symbol, "BUY", qty)


def futures_market_short_usdt(symbol: str, usdt_notional: float) -> dict[str, Any]:
    """Open/increase short via market SELL."""
    prices = get_futures_prices([symbol])
    px = prices.get(symbol.upper()) or 0.0
    if not (px > 0):
        raise RuntimeError(f"no price for {symbol}")
    qty = usdt_notional / px
    return futures_market_order(symbol, "SELL", qty)


def futures_market_sell_all(symbol: str) -> dict[str, Any]:
    signed = get_futures_position_signed(symbol)
    if signed > 0:
        return futures_market_order(symbol, "SELL", signed)
    if signed < 0:
        return futures_market_order(symbol, "BUY", abs(signed))
    return {"skipped": "no_position"}


def futures_close_to_flat(symbol: str) -> dict[str, Any]:
    return futures_market_sell_all(symbol)


def futures_test_snapshot(symbol: str = "BTCUSDT") -> dict[str, Any]:
    """Balance / price / filters for a manual Telegram test trade."""
    sym = symbol.upper()
    if not has_binance_keys():
        return {"ok": False, "error": "BINANCE_API_KEY / BINANCE_SECRET_KEY missing on Render"}
    filters = _load_symbol_filters(sym)
    prices = get_futures_prices([sym])
    px = float(prices.get(sym) or 0)
    usdt = get_usdt_balance()
    equity = estimate_futures_equity_usdt()
    pos = get_futures_position_signed(sym)
    min_qty = float(filters.get("min_qty") or 0)
    min_notional = float(filters.get("min_notional") or 5)
    min_usdt_for_qty = (min_qty * px) if px > 0 else None
    effective_min_usdt = max(
        min_notional,
        min_usdt_for_qty if min_usdt_for_qty is not None else min_notional,
    )
    return {
        "ok": True,
        "venue": "Binance USDT-M Futures (fapi.binance.com)",
        "symbol": sym,
        "contract": "USDT perpetual",
        "price": px if px > 0 else None,
        "usdt_available": usdt,
        "equity_usdt": equity,
        "position_amt": pos,
        "min_qty": min_qty,
        "min_notional": min_notional,
        "min_usdt_to_open": effective_min_usdt,
        "can_open": usdt >= effective_min_usdt and px > 0,
    }


def futures_test_open_long(symbol: str, usdt_notional: float) -> dict[str, Any]:
    """Open a small long on USDT-M perpetual. Raises on filter/balance failure."""
    snap = futures_test_snapshot(symbol)
    if not snap.get("ok"):
        raise RuntimeError(str(snap.get("error") or "snapshot failed"))
    need = float(snap["min_usdt_to_open"])
    avail = float(snap["usdt_available"] or 0)
    px = float(snap["price"] or 0)
    if not (px > 0):
        raise RuntimeError(f"no price for {symbol}")
    spend = float(usdt_notional)
    if spend < need:
        raise RuntimeError(
            f"notional ${spend:.2f} < exchange minimum ~${need:.2f} "
            f"(minQty {snap['min_qty']} × price)"
        )
    if spend > avail:
        raise RuntimeError(f"notional ${spend:.2f} > available USDT ${avail:.2f}")
    order = futures_market_buy_usdt(symbol, spend)
    return {
        "side": "BUY/LONG",
        "symbol": symbol.upper(),
        "spend_usdt": spend,
        "price": px,
        "order": order,
        "position_after": get_futures_position_signed(symbol),
        "usdt_after": get_usdt_balance(),
    }
