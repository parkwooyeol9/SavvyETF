"""바이낸스엔진 — consume R2 signals and optionally place Binance futures orders."""

from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

from r2_data import get_json, put_json

SIGNALS_KEY = "binance_paper/signals_latest.json"
STATE_KEY = "binance_live/executor_state_v1.json"
LOG_PREFIX = "binance_live/logs/"
KST = ZoneInfo("Asia/Seoul")


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


def _default_state() -> dict[str, Any]:
    return {
        "version": 1,
        "engine": "binance",
        "last_signals_at": None,
        "last_run_at": None,
        "day_key_kst": None,
        "day_start_equity_usdt": None,
        "last_actions": {},
        "recent_orders": [],
    }


def _kst_day_key(now: datetime | None = None) -> str:
    return (now or datetime.now(KST)).strftime("%Y-%m-%d")


def _append_log(entry: dict[str, Any]) -> None:
    day = _kst_day_key()
    key = f"{LOG_PREFIX}{day}.json"
    blob = get_json(key) or {"version": 1, "day": day, "entries": []}
    entries = list(blob.get("entries") or [])
    entries.append(entry)
    blob["entries"] = entries[-200:]
    put_json(key, blob)


def _cooldown_ok(state: dict[str, Any], strategy_id: str, action: str) -> bool:
    cooldown = _env_int("BINANCE_ORDER_COOLDOWN_SECONDS", "3600")
    last = (state.get("last_actions") or {}).get(strategy_id) or {}
    if last.get("action") != action:
        return True
    at = str(last.get("at") or "")
    if not at:
        return True
    try:
        prev = datetime.fromisoformat(at.replace("Z", "+00:00"))
        if prev.tzinfo is None:
            prev = prev.replace(tzinfo=timezone.utc)
        elapsed = (datetime.now(timezone.utc) - prev).total_seconds()
        return elapsed >= cooldown
    except ValueError:
        return True


def run_binance_executor() -> dict[str, Any]:
    result: dict[str, Any] = {
        "ok": False,
        "engine": "binance",
        "mode": "dry",
        "actions": [],
        "skipped": [],
    }

    if _env_bool("BINANCE_KILL_SWITCH"):
        result["ok"] = True
        result["skipped"].append("kill_switch")
        return result

    live = _env_bool("BINANCE_LIVE", "false") or _env_bool("CHALLENGE_LIVE", "false")
    result["mode"] = "live" if live else "dry"

    signals = get_json(SIGNALS_KEY)
    if not signals or not signals.get("strategies"):
        result["error"] = "no_signals"
        return result

    gen_at = str(signals.get("generated_at") or "")
    state = get_json(STATE_KEY) or _default_state()
    if gen_at and gen_at == state.get("last_signals_at"):
        result["ok"] = True
        result["skipped"].append("already_processed")
        return result

    from binance_client import (
        estimate_futures_equity_usdt,
        futures_market_buy_usdt,
        futures_market_sell_all,
        get_futures_position,
        get_futures_prices,
        get_usdt_balance,
        has_binance_keys,
    )

    equity = 0.0
    usdt_cash = 0.0
    if has_binance_keys():
        equity = estimate_futures_equity_usdt()
        usdt_cash = get_usdt_balance()
    else:
        result["skipped"].append("no_api_keys")

    day_key = _kst_day_key()
    if state.get("day_key_kst") != day_key:
        state["day_key_kst"] = day_key
        state["day_start_equity_usdt"] = equity if equity > 0 else state.get("day_start_equity_usdt")

    max_loss = _env_float("BINANCE_MAX_DAILY_LOSS_PCT", "5")
    start = state.get("day_start_equity_usdt")
    if start and equity > 0 and state.get("day_key_kst") == day_key:
        loss_pct = 100 * (equity - float(start)) / float(start)
        if loss_pct <= -max_loss:
            result["ok"] = True
            result["skipped"].append(f"daily_loss {loss_pct:.2f}%")
            state["last_signals_at"] = gen_at
            put_json(STATE_KEY, state)
            return result

    min_reserve = _env_float("BINANCE_MIN_USDT_RESERVE", "50")
    max_position_pct = _env_float("BINANCE_MAX_POSITION_PCT", "40")
    now_iso = datetime.now(timezone.utc).isoformat()

    symbols = [str(s.get("symbol") or "") for s in signals["strategies"] if s.get("symbol")]
    prices = get_futures_prices(symbols)

    for strat in signals["strategies"]:
        sid = str(strat.get("id") or "")
        symbol = str(strat.get("symbol") or "").upper()
        action = str(strat.get("action") or "hold")
        if action not in {"buy", "sell"} or not symbol:
            continue
        if not _cooldown_ok(state, sid, action):
            result["skipped"].append(f"cooldown:{sid}")
            continue

        px = prices.get(symbol) or 0.0
        target_pct = float(strat.get("target_weight_pct") or 0)
        target_usdt = (equity * target_pct / 100) if equity > 0 else 0
        pos_qty = get_futures_position(symbol) if has_binance_keys() else 0.0
        pos_usdt = pos_qty * px if px > 0 else 0.0

        entry: dict[str, Any] = {
            "strategy": sid,
            "symbol": symbol,
            "action": action,
            "reason": strat.get("reason"),
            "target_usdt": round(target_usdt, 2),
            "position_usdt": round(pos_usdt, 2),
            "mode": result["mode"],
        }

        if action == "buy":
            if pos_qty > 0:
                entry["skip"] = "already_holding"
                result["skipped"].append(f"{sid}:already_holding")
                result["actions"].append(entry)
                continue
            spend = min(target_usdt, max(0.0, usdt_cash - min_reserve))
            if spend < 10:
                entry["skip"] = "insufficient_usdt"
                result["actions"].append(entry)
                continue
            if equity > 0 and 100 * spend / equity > max_position_pct:
                spend = equity * max_position_pct / 100
            entry["spend_usdt"] = round(spend, 2)
            if live and has_binance_keys():
                try:
                    order = futures_market_buy_usdt(symbol, spend)
                    entry["order_id"] = order.get("orderId")
                    entry["status"] = "placed"
                    usdt_cash = max(0.0, usdt_cash - spend)
                except Exception as exc:
                    entry["status"] = "error"
                    entry["error"] = str(exc)
            else:
                entry["status"] = "dry_run"

        elif action == "sell":
            if pos_qty <= 0:
                entry["skip"] = "no_position"
                result["actions"].append(entry)
                continue
            entry["quantity"] = pos_qty
            if live and has_binance_keys():
                try:
                    order = futures_market_sell_all(symbol)
                    entry["order_id"] = order.get("orderId")
                    entry["status"] = "placed"
                except Exception as exc:
                    entry["status"] = "error"
                    entry["error"] = str(exc)
            else:
                entry["status"] = "dry_run"

        result["actions"].append(entry)
        if entry.get("status") in {"placed", "dry_run"} and not entry.get("skip"):
            last_actions = dict(state.get("last_actions") or {})
            last_actions[sid] = {"action": action, "at": now_iso, "symbol": symbol}
            state["last_actions"] = last_actions

    state["last_signals_at"] = gen_at
    state["last_run_at"] = now_iso
    put_json(STATE_KEY, state)
    _append_log({"ts": now_iso, "event": "executor_run", "actions": result["actions"]})
    result["ok"] = True
    return result
