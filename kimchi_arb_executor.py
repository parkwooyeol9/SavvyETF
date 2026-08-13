"""김프 차익거래 — 업비트엔진 + 바이낸스엔진 동시 실행 코디네이터.

안전장치:
- 숏김프: 업비트 BTC 잔고 없으면 전체 skip (바이낸스 단독 롱 금지)
- 최대 보유일·진입 대비 추가확대(adverse) 한도 청산
- BTC 수량 양쪽 매칭
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any

from r2_data import get_json, put_json

KIMCHI_KEY = "challenge/kimchi_arb_latest.json"
STUDY_KEY = "challenge/kimchi_study_latest.json"
STATE_KEY = "challenge/kimchi_arb_state_v1.json"
LOG_PREFIX = "challenge/kimchi_arb_logs/"


def _env_bool(name: str, default: str = "false") -> bool:
    return os.environ.get(name, default).strip().lower() in {"1", "true", "yes", "on"}


def _env_float(name: str, default: str) -> float:
    try:
        return float(os.environ.get(name, default))
    except ValueError:
        return float(default)


def _env_int(name: str, default: str) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return int(default)


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


def _params_from_study(signal: dict[str, Any]) -> dict[str, float]:
    th = signal.get("thresholds") or {}
    study = get_json(STUDY_KEY) or {}
    rec = study.get("recommended") or {}
    return {
        "enter": float(rec.get("enter_pct") or th.get("enter") or _env_float("KIMCHI_ARB_ENTER_PCT", "3.0")),
        "exit_low": float(th.get("exit_low") or _env_float("KIMCHI_ARB_EXIT_PCT", "0.5")),
        "steady": float(rec.get("exit_pct") or th.get("steady") or _env_float("KIMCHI_ARB_STEADY_PCT", "1.2")),
        "max_hold_days": float(
            rec.get("max_hold_days") or th.get("max_hold_days") or _env_float("KIMCHI_ARB_MAX_HOLD_DAYS", "14")
        ),
        "max_adverse_pct": float(
            rec.get("max_adverse_pct")
            or th.get("max_adverse_pct")
            or _env_float("KIMCHI_ARB_MAX_ADVERSE_PCT", "2.5")
        ),
    }


def _matched_btc_qty(
    upbit_btc_krw: float | None,
    binance_btc_usdt: float | None,
    max_krw: int,
    max_usdt: float,
    upbit_btc_balance: float | None = None,
) -> float | None:
    if not (upbit_btc_krw and upbit_btc_krw > 0 and binance_btc_usdt and binance_btc_usdt > 0):
        return None
    btc_krw = max_krw / upbit_btc_krw
    btc_usdt = max_usdt / binance_btc_usdt
    qty = min(btc_krw, btc_usdt)
    if upbit_btc_balance is not None:
        qty = min(qty, max(0.0, upbit_btc_balance))
    return qty if qty >= 0.0001 else None


def _exit_legs(arb_type: str, btc_qty: float) -> list[dict[str, Any]]:
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


def _hold_days(opened_at: str | None) -> float:
    if not opened_at:
        return 0.0
    try:
        prev = datetime.fromisoformat(opened_at.replace("Z", "+00:00"))
        if prev.tzinfo is None:
            prev = prev.replace(tzinfo=timezone.utc)
        return (datetime.now(timezone.utc) - prev).total_seconds() / 86400.0
    except ValueError:
        return 0.0


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
    params = _params_from_study(signal)

    open_arb = state.get("open_arb")
    effective_action = arb_action

    # Blocked / unavailable → no trade
    if arb_action in {"blocked_no_inventory", "unavailable", "hold"}:
        # Still allow forced exits on open arb
        if not open_arb:
            result["ok"] = True
            result["arb_action"] = arb_action
            result["skipped"].append(arb_action)
            return result

    if open_arb and kimchi_pct is not None:
        arb_type = str(open_arb.get("type") or "")
        entry_k = float(open_arb.get("entry_kimchi_pct") or kimchi_pct)
        k = float(kimchi_pct)
        days = _hold_days(str(open_arb.get("opened_at") or ""))

        if arb_type == "short_kimchi":
            adverse = max(0.0, k - entry_k)
            if k <= params["steady"]:
                effective_action = "exit_short_kimchi"
            elif adverse >= params["max_adverse_pct"]:
                effective_action = "exit_short_kimchi"
                result["skipped"].append(f"adverse_stop_{adverse:.2f}")
            elif days >= params["max_hold_days"]:
                effective_action = "exit_short_kimchi"
                result["skipped"].append(f"max_hold_{days:.1f}d")
        elif arb_type == "long_kimchi":
            adverse = max(0.0, entry_k - k)
            if k >= params["enter"]:
                effective_action = "exit_long_kimchi"
            elif adverse >= params["max_adverse_pct"]:
                effective_action = "exit_long_kimchi"
                result["skipped"].append(f"adverse_stop_{adverse:.2f}")
            elif days >= params["max_hold_days"]:
                effective_action = "exit_long_kimchi"
                result["skipped"].append(f"max_hold_{days:.1f}d")

    result["arb_action"] = effective_action

    if effective_action in {"hold", "unavailable", "blocked_no_inventory"}:
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

    from upbit_client import get_coin_balance, get_ticker_prices as upbit_prices, has_upbit_keys

    prices: dict[str, float] = {}
    try:
        prices.update(upbit_prices(["KRW-BTC"]))
    except Exception:
        pass

    upbit_btc_bal = 0.0
    if has_upbit_keys():
        try:
            upbit_btc_bal = get_coin_balance("KRW-BTC")
        except Exception:
            upbit_btc_bal = 0.0

    # Hard gate: never open short-kimchi without Upbit BTC
    if effective_action == "enter_short_kimchi" and upbit_btc_bal <= 0 and live:
        result["ok"] = True
        result["skipped"].append("no_upbit_btc_inventory")
        result["arb_action"] = "blocked_no_inventory"
        return result
    if effective_action == "enter_short_kimchi" and not live:
        # Dry-run: still require signal inventory flag when present
        inv = signal.get("inventory") or {}
        if inv and not inv.get("short_kimchi_allowed", True):
            result["ok"] = True
            result["skipped"].append("paper_no_inventory")
            result["arb_action"] = "blocked_no_inventory"
            return result

    upbit_px = signal.get("upbit_btc_krw")
    binance_px = signal.get("binance_btc_usdt")

    btc_qty: float | None = None
    legs: list[dict[str, Any]] = []

    if effective_action.startswith("exit_") and open_arb:
        btc_qty = float(open_arb.get("btc_qty") or 0)
        legs = _exit_legs(str(open_arb.get("type") or ""), btc_qty)
    else:
        bal_cap = upbit_btc_bal if effective_action == "enter_short_kimchi" else None
        btc_qty = _matched_btc_qty(
            float(upbit_px) if upbit_px else None,
            float(binance_px) if binance_px else None,
            max_krw,
            max_usdt,
            upbit_btc_balance=bal_cap,
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

    # Atomic-ish: for short-kimchi live, sell Upbit first; if fail, do not buy Binance
    ordered = legs
    if effective_action == "enter_short_kimchi":
        ordered = sorted(legs, key=lambda L: 0 if L.get("engine") == "upbit" else 1)
    elif effective_action == "enter_long_kimchi":
        ordered = sorted(legs, key=lambda L: 0 if L.get("engine") == "upbit" else 1)

    upbit_ok = True
    for leg in ordered:
        if (
            live
            and effective_action.startswith("enter_")
            and leg.get("engine") == "binance"
            and not upbit_ok
        ):
            result["legs"].append(
                {
                    **leg,
                    "status": "skipped",
                    "reason": "upbit_leg_failed_abort_hedge",
                }
            )
            continue
        executed = _execute_leg(leg, live, prices)
        if leg.get("engine") == "upbit" and executed.get("status") not in {"placed", "dry_run"}:
            upbit_ok = False
        result["legs"].append(executed)

    placed = [l for l in result["legs"] if l.get("status") in {"placed", "dry_run"} and not l.get("skip")]
    if effective_action.startswith("exit_") and placed:
        state["open_arb"] = None
    elif effective_action in {"enter_short_kimchi", "enter_long_kimchi"} and placed and upbit_ok:
        state["open_arb"] = {
            "type": "short_kimchi" if "short" in effective_action else "long_kimchi",
            "btc_qty": btc_qty,
            "opened_at": datetime.now(timezone.utc).isoformat(),
            "entry_kimchi_pct": kimchi_pct,
        }

    state["last_arb_at"] = gen_at
    state["last_action"] = effective_action
    state["last_run_at"] = datetime.now(timezone.utc).isoformat()
    state["params"] = params
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
            "params": params,
            "legs": result["legs"],
            "skipped": result["skipped"],
        }
    )
    blob["entries"] = entries[-100:]
    put_json(log_key, blob)

    result["ok"] = True
    result["btc_qty"] = btc_qty
    result["params"] = params
    return result
