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


def run_kimchi_arb_coordinator() -> dict[str, Any]:
    """Execute coordinated legs when KIMCHI_ARB_LIVE=true and both engines live."""
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

    arb_action = str(signal.get("arb_action") or "hold")
    result["arb_action"] = arb_action
    if arb_action in {"hold", "unavailable"}:
        result["ok"] = True
        result["skipped"].append(arb_action)
        return result

    live = _env_bool("KIMCHI_ARB_LIVE", "false")
    upbit_live = _env_bool("UPBIT_LIVE", "false")
    binance_live = _env_bool("BINANCE_LIVE", "false")

    state = get_json(STATE_KEY) or {"last_arb_at": None, "last_action": None}
    gen_at = str(signal.get("generated_at") or "")
    if gen_at and gen_at == state.get("last_arb_at"):
        result["ok"] = True
        result["skipped"].append("already_processed")
        return result

    legs = signal.get("legs") or []
    max_usdt = float(os.environ.get("KIMCHI_ARB_MAX_USDT", "500"))
    max_krw = int(os.environ.get("KIMCHI_ARB_MAX_KRW", "700000"))

    for leg in legs:
        engine = str(leg.get("engine") or "")
        action = str(leg.get("action") or "")
        symbol = str(leg.get("symbol") or "")
        entry: dict[str, Any] = {
            "engine": engine,
            "action": action,
            "symbol": symbol,
            "status": "dry_run",
        }

        if not live:
            result["legs"].append(entry)
            continue
        if engine == "upbit" and not upbit_live:
            entry["status"] = "skipped"
            entry["reason"] = "UPBIT_LIVE=false"
            result["legs"].append(entry)
            continue
        if engine == "binance" and not binance_live:
            entry["status"] = "skipped"
            entry["reason"] = "BINANCE_LIVE=false"
            result["legs"].append(entry)
            continue

        try:
            if engine == "upbit" and action == "buy":
                from upbit_client import has_upbit_keys, market_buy_krw

                if has_upbit_keys():
                    order = market_buy_krw(symbol, max_krw)
                    entry["order_uuid"] = order.get("uuid")
                    entry["status"] = "placed"
            elif engine == "upbit" and action == "sell":
                from upbit_client import get_coin_balance, has_upbit_keys, market_sell_volume

                if has_upbit_keys():
                    bal = get_coin_balance(symbol)
                    if bal > 0:
                        order = market_sell_volume(symbol, bal)
                        entry["order_uuid"] = order.get("uuid")
                        entry["status"] = "placed"
                    else:
                        entry["status"] = "skipped"
                        entry["reason"] = "no_balance"
            elif engine == "binance" and action == "buy":
                from binance_client import futures_market_buy_usdt, has_binance_keys

                if has_binance_keys():
                    order = futures_market_buy_usdt(symbol, max_usdt)
                    entry["order_id"] = order.get("orderId")
                    entry["status"] = "placed"
            elif engine == "binance" and action == "sell":
                from binance_client import futures_market_sell_all, has_binance_keys

                if has_binance_keys():
                    order = futures_market_sell_all(symbol)
                    entry["order_id"] = order.get("orderId")
                    entry["status"] = "placed"
        except Exception as exc:
            entry["status"] = "error"
            entry["error"] = str(exc)

        result["legs"].append(entry)

    state["last_arb_at"] = gen_at
    state["last_action"] = arb_action
    state["last_run_at"] = datetime.now(timezone.utc).isoformat()
    put_json(STATE_KEY, state)
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    log_key = f"{LOG_PREFIX}{day}.json"
    blob = get_json(log_key) or {"entries": []}
    entries = list(blob.get("entries") or [])
    entries.append({"ts": state["last_run_at"], "signal": signal, "legs": result["legs"]})
    blob["entries"] = entries[-100:]
    put_json(log_key, blob)

    result["ok"] = True
    return result
