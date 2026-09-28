"""Upbit / Binance API master switch — off until CRYPTO_EXCHANGE_API_ENABLED=true."""

from __future__ import annotations

import os

SUSPENDED_MSG = "업비트·바이낸스 API 사용 중단 중 (재개: CRYPTO_EXCHANGE_API_ENABLED=true)"


def exchange_api_enabled() -> bool:
    raw = (os.environ.get("CRYPTO_EXCHANGE_API_ENABLED") or "").strip().lower()
    return raw in {"1", "true", "yes", "on"}


def require_exchange_api() -> None:
    if not exchange_api_enabled():
        raise RuntimeError(SUSPENDED_MSG)
