"""김프 차익거래 — 업비트엔진 + 바이낸스엔진 동시 실행 코디네이터."""

from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any

from r2_data import get_json, put_json

KIMCHI_KEY = "challenge/kimchi_arb_latest.json"
STATE_KEY = "challenge/kimchi_arb_state_v1.json"
LOG_PREFIX = "challenge/kimchi_arb_logs/"


def _env_bool(name: str, default: str = "false") -> bool:
    return os.environ.get(name, default).strip().lower() in {"1", "true", "yes", "on"}


def _live_enabled() -> bool:
    if _env_bool("CHALLENGE_KILL_SWITCH") or _env_bool("KIMCHI_ARB_KILL_SWITCH"):
        return False
    if _env_bool("CHALLENGE_LIVE"):
        return True
    return _env_bool("KIMCHI_ARB_LIVE", "false")


def _engine_live(engine: str) -> bool:
    if _env_bool("CHALLENGE_LIVE"):
        if engine == "upbit":
            return not _env_bool("UPBIT_KILL_SWITCH")
        if engine == "binance":
            return not _env_bool("BINANCE_KILL_SWITCH")
    if engine == "upbit":
        return _env_bool("UPBIT_LIVE", "false")
    if engine == "binance":
        return _env_bool("BINANCE_LIVE", "false")
    return False


def _matched_btc_qty(
    upbit_btc_krw: float | None,
    binance_btc_usdt: float | None,
    max_krw: int,
    max_usdt: float,
) -> float | None:
    if not (upbit_btc_krw and upbit_btc_krw > 0 and binance_btc_usdt and binance_btc_usdt > 0):
        return None
    btc_krw = max_krw / upbit_btc_krw
    btc_usdt = max_usdt / binance_btc_usdt
    qty = min(btc_krw, btc_usdt)
    return qty if qty >= 0.0001 else None


def _exit_legs(arb_type: str, btc_qty: float) -> list[dict[str, Any]]:
    """Reverse legs to close an open kimchi arb."""
    if arb_type == "short_kimchi":
        return [
            {"engine": "upbit", "action": "buy", "symbol": "KRW-BTC", "btc_qty": btc_qty},
            {"engine": "binance", "action": "close", "symbol": "BTCUSDT", "btc_qty": btc_qty},
        ]
    if arb_type == "long_kimchi":
        return [
            {"engine": "upbit", "action": "sell", "symbol": "KRW-BTC", "btc_qty": btc_qty},
            {"engine": "binance", "action": "close", "symbol": "BTCUSDT", "btc_qty": btc_qty},
        ]
    return []


def _execute_leg(leg: dict[str, Any], live: bool, prices: dict[str, float]) -> dict[str, Any]:
    engine = str(leg.get("engine") or "")
    action = str(leg.get("action") or "")
    symbol = str(leg.get("symbol") or "")
    btc_qty = float(leg.get("btc_qty") or 0)
    entry: dict[str, Any] = {
        "engine": engine,
        "action": action,
        "symbol": symbol,
        "btc_qty": btc_qty,
        "status": "dry_run",
    }

    if not live:
        return entry
    if not _engine_live(engine):
        entry["status"] = "skipped"
        entry["reason"] = f"{engine.upper()}_LIVE=false"
        return entry

    try:
        if engine == "upbit":
            from upbit_client import get_coin_balance, has_upbit_keys, market_buy_krw, market_sell_volume

            if not has_upbit_keys():
                entry["status"] = "skipped"
                entry["reason"] = "no_upbit_keys"
                return entry
            px = prices.get(symbol) or 0.0
            if action == "buy":
                krw = int(btc_qty * px) if px > 0 else 0
                if krw < 5000:
                    entry["status"] = "skipped"
                    entry["reason"] = "krw_too_small"
                    return entry
                order = market_buy_krw(symbol, krw)
                entry["order_uuid"] = order.get("uuid")
                entry["spend_krw"] = krw
                entry["status"] = "placed"
            elif action == "sell":
                sell_qty = min(btc_qty, get_coin_balance(symbol)) if btc_qty > 0 else get_coin_balance(symbol)
                if sell_qty <= 0:
                    entry["status"] = "skipped"
                    entry["reason"] = "no_balance"
                    return entry
                order = market_sell_volume(symbol, sell_qty)
                entry["order_uuid"] = order.get("uuid")
                entry["status"] = "placed"

        elif engine == "binance":
            from binance_client import (
                futures_close_to_flat,
                futures_market_buy_usdt,
                futures_market_short_usdt,
                futures_market_order,
                get_futures_prices,
                has_binance_keys,
                round_quantity,
            )

            if not has_binance_keys():
                entry["status"] = "skipped"
                entry["reason"] = "no_binance_keys"
                return entry
            px = (get_futures_prices([symbol]) or {}).get(symbol.upper()) or prices.get(symbol) or 0.0
            if action == "buy":
                usdt = btc_qty * px if px > 0 else 0
                order = futures_market_buy_usdt(symbol, usdt)
                entry["order_id"] = order.get("orderId")
                entry["spend_usdt"] = round(usdt, 2)
                entry["status"] = "placed"
            elif action == "sell":
                usdt = btc_qty * px if px > 0 else 0
                order = futures_market_short_usdt(symbol, usdt)
                entry["order_id"] = order.get("orderId")
                entry["status"] = "placed"
            elif action == "close":
                qty = round_quantity(symbol, btc_qty)
                order = futures_close_to_flat(symbol)
                entry["order_id"] = order.get("orderId")
                entry["close_qty"] = qty
                entry["status"] = "placed"
    except Exception as exc:
        entry["status"] = "error"
        entry["error"] = str(exc)

    return entry


def run_kimchi_arb_coordinator() -> dict[str, Any]:
    """Execute coordinated legs when live; track open arb and exit on mean reversion."""
    result: dict[str, Any] = {
        "ok": False,
        "arb_action": "hold",
        "legs": [],
        "skipped": [],
    }

    if _env_bool("KIMCHI_ARB_KILL_SWITCH") or _env_bool("CHALLENGE_KILL_SWITCH"):
        result["ok"] = True
        result["skipped"].append("kill_switch")
        return result

    signal = get_json(KIMCHI_KEY)
    if not signal:
        result["error"] = "no_kimchi_signal"
        return result

    kimchi_pct = signal.get("kimchi_pct")
    arb_action = str(signal.get("arb_action") or "hold")
    gen_at = str(signal.get("generated_at") or "")
    state = get_json(STATE_KEY) or {"open_arb": None, "last_arb_at": None}

    open_arb = state.get("open_arb")
    exit_pct = float(os.environ.get("KIMCHI_ARB_EXIT_PCT", "0.5"))
    enter_pct = float(os.environ.get("KIMCHI_ARB_ENTER_PCT", "2.0"))

    # Mean-reversion exit for open position
    effective_action = arb_action
    if open_arb and kimchi_pct is not None:
        arb_type = str(open_arb.get("type") or "")
        if arb_type == "short_kimchi" and float(kimchi_pct) <= exit_pct:
            effective_action = "exit_short_kimchi"
        elif arb_type == "long_kimchi" and float(kimchi_pct) >= enter_pct:
            effective_action = "exit_long_kimchi"

    result["arb_action"] = effective_action

    if effective_action in {"hold", "unavailable"}:
        result["ok"] = True
        result["skipped"].append(effective_action)
        return result

    if gen_at and gen_at == state.get("last_arb_at") and not effective_action.startswith("exit_"):
        result["ok"] = True
        result["skipped"].append("already_processed")
        return result

    live = _live_enabled()
    max_usdt = float(os.environ.get("KIMCHI_ARB_MAX_USDT", "500"))
    max_krw = int(os.environ.get("KIMCHI_ARB_MAX_KRW", "700000"))

    from upbit_client import get_ticker_prices as upbit_prices

    prices: dict[str, float] = {}
    try:
        prices.update(upbit_prices(["KRW-BTC"]))
    except Exception:
        pass

    upbit_px = signal.get("upbit_btc_krw")
    binance_px = signal.get("binance_btc_usdt")

    btc_qty: float | None = None
    legs: list[dict[str, Any]] = []

    if effective_action.startswith("exit_") and open_arb:
        btc_qty = float(open_arb.get("btc_qty") or 0)
        legs = _exit_legs(str(open_arb.get("type") or ""), btc_qty)
    else:
        btc_qty = _matched_btc_qty(
            float(upbit_px) if upbit_px else None,
            float(binance_px) if binance_px else None,
            max_krw,
            max_usdt,
        )
        raw_legs = signal.get("legs") or []
        for leg in raw_legs:
            legs.append({**leg, "btc_qty": btc_qty or 0})

    if not legs:
        result["ok"] = True
        result["skipped"].append("no_legs")
        return result
    if btc_qty is None or btc_qty <= 0:
        result["ok"] = True
        result["skipped"].append("btc_qty_too_small")
        return result

    for leg in legs:
        executed = _execute_leg(leg, live, prices)
        result["legs"].append(executed)

    placed = [l for l in result["legs"] if l.get("status") == "placed"]
    if effective_action.startswith("exit_") and placed:
        state["open_arb"] = None
    elif effective_action in {"enter_short_kimchi", "enter_long_kimchi"} and placed:
        state["open_arb"] = {
            "type": "short_kimchi" if "short" in effective_action else "long_kimchi",
            "btc_qty": btc_qty,
            "opened_at": datetime.now(timezone.utc).isoformat(),
            "entry_kimchi_pct": kimchi_pct,
        }

    state["last_arb_at"] = gen_at
    state["last_action"] = effective_action
    state["last_run_at"] = datetime.now(timezone.utc).isoformat()
    put_json(STATE_KEY, state)

    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    log_key = f"{LOG_PREFIX}{day}.json"
    blob = get_json(log_key) or {"entries": []}
    entries = list(blob.get("entries") or [])
    entries.append(
        {
            "ts": state["last_run_at"],
            "arb_action": effective_action,
            "kimchi_pct": kimchi_pct,
            "btc_qty": btc_qty,
            "legs": result["legs"],
        }
    )
    blob["entries"] = entries[-100:]
    put_json(log_key, blob)

    result["ok"] = True
    result["btc_qty"] = btc_qty
    return result
