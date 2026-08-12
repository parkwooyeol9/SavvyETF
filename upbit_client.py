"""Upbit REST client — JWT auth for private account and order endpoints."""

from __future__ import annotations

import hashlib
import os
import uuid
from typing import Any
from urllib.parse import urlencode

import jwt
import requests

UPBIT_API_BASE = "https://api.upbit.com/v1"
REQUEST_TIMEOUT = 20


def _keys() -> tuple[str, str] | None:
    access = (os.environ.get("UPBIT_ACCESS_KEY") or "").strip()
    secret = (os.environ.get("UPBIT_SECRET_KEY") or "").strip()
    if access and secret:
        return access, secret
    return None


def has_upbit_keys() -> bool:
    return _keys() is not None


def _auth_headers(params: dict[str, Any] | None = None) -> dict[str, str]:
    pair = _keys()
    if not pair:
        raise RuntimeError("UPBIT_ACCESS_KEY / UPBIT_SECRET_KEY not configured")
    access, secret = pair
    payload: dict[str, str] = {
        "access_key": access,
        "nonce": str(uuid.uuid4()),
    }
    if params:
        qs = urlencode(params, doseq=True)
        digest = hashlib.sha512()
        digest.update(qs.encode("utf-8"))
        payload["query_hash"] = digest.hexdigest()
        payload["query_hash_alg"] = "SHA512"
    token = jwt.encode(payload, secret, algorithm="HS256")
    if isinstance(token, bytes):
        token = token.decode("utf-8")
    return {"Authorization": f"Bearer {token}", "Accept": "application/json"}


def _request(
    method: str,
    path: str,
    params: dict[str, Any] | None = None,
    *,
    private: bool = True,
) -> Any:
    url = f"{UPBIT_API_BASE}{path}"
    headers: dict[str, str] = {"Accept": "application/json"}
    if private:
        headers.update(_auth_headers(params))
    resp = requests.request(
        method.upper(),
        url,
        params=params if method.upper() in {"GET", "DELETE"} else None,
        data=params if method.upper() == "POST" else None,
        headers=headers,
        timeout=REQUEST_TIMEOUT,
    )
    if resp.status_code >= 400:
        detail = resp.text[:500]
        raise RuntimeError(f"Upbit {method} {path} failed ({resp.status_code}): {detail}")
    if not resp.text:
        return None
    return resp.json()


def get_accounts() -> list[dict[str, Any]]:
    data = _request("GET", "/accounts")
    return data if isinstance(data, list) else []


def get_krw_balance() -> float:
    for row in get_accounts():
        if row.get("currency") == "KRW":
            try:
                return float(row.get("balance") or 0)
            except (TypeError, ValueError):
                return 0.0
    return 0.0


def get_coin_balance(market: str) -> float:
    currency = market.split("-", 1)[-1].upper()
    for row in get_accounts():
        if str(row.get("currency") or "").upper() == currency:
            try:
                return float(row.get("balance") or 0)
            except (TypeError, ValueError):
                return 0.0
    return 0.0


def estimate_total_equity_krw(markets: list[str] | None = None) -> float:
    """Best-effort KRW equity: cash + held coins at last trade price."""
    accounts = get_accounts()
    krw = 0.0
    coins: dict[str, float] = {}
    for row in accounts:
        cur = str(row.get("currency") or "").upper()
        try:
            bal = float(row.get("balance") or 0)
        except (TypeError, ValueError):
            bal = 0.0
        if cur == "KRW":
            krw += bal
        elif bal > 0:
            coins[cur] = bal
    if not coins:
        return krw
    tick_markets = markets or [f"KRW-{c}" for c in coins]
    prices = get_ticker_prices(tick_markets)
    for cur, bal in coins.items():
        px = prices.get(f"KRW-{cur}")
        if px:
            krw += bal * px
    return krw


def get_ticker_prices(markets: list[str]) -> dict[str, float]:
    out: dict[str, float] = {}
    if not markets:
        return out
    chunk = 100
    for i in range(0, len(markets), chunk):
        slice_ = markets[i : i + chunk]
        url = f"{UPBIT_API_BASE}/ticker"
        resp = requests.get(
            url,
            params={"markets": ",".join(slice_)},
            headers={"Accept": "application/json"},
            timeout=REQUEST_TIMEOUT,
        )
        if resp.status_code >= 400:
            continue
        for row in resp.json() or []:
            market = str(row.get("market") or "")
            try:
                out[market] = float(row.get("trade_price") or 0)
            except (TypeError, ValueError):
                continue
    return out


def post_order(params: dict[str, Any]) -> dict[str, Any]:
    data = _request("POST", "/orders", params)
    return data if isinstance(data, dict) else {}


def market_buy_krw(market: str, krw_amount: int) -> dict[str, Any]:
    return post_order(
        {
            "market": market,
            "side": "bid",
            "price": str(max(5000, int(krw_amount))),
            "ord_type": "price",
        }
    )


def market_sell_volume(market: str, volume: float) -> dict[str, Any]:
    return post_order(
        {
            "market": market,
            "side": "ask",
            "volume": f"{volume:.8f}".rstrip("0").rstrip("."),
            "ord_type": "market",
        }
    )


def get_order(uuid: str) -> dict[str, Any]:
    data = _request("GET", "/order", {"uuid": uuid})
    return data if isinstance(data, dict) else {}


def order_test(params: dict[str, Any]) -> dict[str, Any]:
    """Validate order params without placing (Upbit order test endpoint)."""
    test_params = dict(params)
    test_params["identifier"] = test_params.get("identifier") or f"test-{uuid.uuid4().hex[:12]}"
    data = _request("POST", "/orders/test", test_params)
    return data if isinstance(data, dict) else {"ok": True}
