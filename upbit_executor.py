"""Consume R2 crypto signals and optionally place Upbit orders (Render bot)."""

from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

from r2_data import get_json, put_json
import challenge_trading_config as trade_cfg

SIGNALS_KEY = "upbit_paper/signals_latest.json"
LEGACY_SIGNALS_KEY = "crypto_paper/signals_latest.json"
STATE_KEY = "upbit_live/executor_state_v1.json"
LOG_PREFIX = "upbit_live/logs/"
KST = ZoneInfo("Asia/Seoul")


def _default_state() -> dict[str, Any]:
    return {
        "version": 1,
        "last_signals_at": None,
        "last_run_at": None,
        "day_key_kst": None,
        "day_start_equity_krw": None,
        "last_actions": {},
        "recent_orders": [],
    }


def _kst_day_key(now: datetime | None = None) -> str:
    dt = now or datetime.now(KST)
    return dt.strftime("%Y-%m-%d")


def _append_log(entry: dict[str, Any]) -> None:
    day = _kst_day_key()
    key = f"{LOG_PREFIX}{day}.json"
    blob = get_json(key) or {"version": 1, "day": day, "entries": []}
    entries = list(blob.get("entries") or [])
    entries.append(entry)
    blob["entries"] = entries[-200:]
    put_json(key, blob)


def _cooldown_ok(state: dict[str, Any], strategy_id: str, action: str) -> bool:
    cooldown = trade_cfg.effective_int(
        "upbit", "order_cooldown_seconds", "UPBIT_ORDER_COOLDOWN_SECONDS", "3600"
    )
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


def _daily_loss_ok(state: dict[str, Any], equity: float) -> tuple[bool, str]:
    max_loss_pct = trade_cfg.effective_float(
        "upbit", "max_daily_loss_pct", "UPBIT_MAX_DAILY_LOSS_PCT", "5"
    )
    day_key = _kst_day_key()
    if state.get("day_key_kst") != day_key:
        return True, ""
    start = state.get("day_start_equity_krw")
    if start is None or not (start > 0):
        return True, ""
    loss_pct = 100 * (equity - float(start)) / float(start)
    if loss_pct <= -max_loss_pct:
        return False, f"daily_loss {loss_pct:.2f}% exceeds -{max_loss_pct}%"
    return True, ""


def run_upbit_executor() -> dict[str, Any]:
    """Read latest 업비트엔진 signals from R2; dry-run by default (UPBIT_LIVE=false)."""
    result: dict[str, Any] = {
        "ok": False,
        "mode": "dry",
        "actions": [],
        "skipped": [],
    }

    if trade_cfg.upbit_kill():
        result["ok"] = True
        result["skipped"].append("kill_switch")
        _append_log({"ts": datetime.now(timezone.utc).isoformat(), "event": "kill_switch"})
        return result

    live = trade_cfg.upbit_live()
    result["mode"] = "live" if live else "dry"

    signals = get_json(SIGNALS_KEY) or get_json(LEGACY_SIGNALS_KEY)
    if not signals or not signals.get("strategies"):
        result["error"] = "no_signals"
        return result

    gen_at = str(signals.get("generated_at") or "")
    state = get_json(STATE_KEY) or _default_state()
    if gen_at and gen_at == state.get("last_signals_at"):
        result["ok"] = True
        result["skipped"].append("already_processed")
        return result

    from upbit_client import (
        estimate_total_equity_krw,
        get_coin_balance,
        get_krw_balance,
        get_ticker_prices,
        has_upbit_keys,
        market_buy_krw,
        market_sell_volume,
        order_test,
    )

    equity = 0.0
    krw_cash = 0.0
    if has_upbit_keys():
        markets = [str(s.get("market") or "") for s in signals["strategies"] if s.get("market")]
        equity = estimate_total_equity_krw(markets)
        krw_cash = get_krw_balance()
    else:
        result["skipped"].append("no_api_keys")

    day_key = _kst_day_key()
    if state.get("day_key_kst") != day_key:
        state["day_key_kst"] = day_key
        state["day_start_equity_krw"] = equity if equity > 0 else state.get("day_start_equity_krw")

    loss_ok, loss_reason = _daily_loss_ok(state, equity)
    if not loss_ok:
        result["ok"] = True
        result["skipped"].append(loss_reason)
        _append_log({"ts": datetime.now(timezone.utc).isoformat(), "event": "daily_loss_halt", "reason": loss_reason})
        state["last_signals_at"] = gen_at
        state["last_run_at"] = datetime.now(timezone.utc).isoformat()
        put_json(STATE_KEY, state)
        return result

    min_reserve = trade_cfg.effective_int(
        "upbit", "min_krw_reserve", "UPBIT_MIN_KRW_RESERVE", "100000"
    )
    max_position_pct = trade_cfg.effective_float(
        "upbit", "max_position_pct", "UPBIT_MAX_POSITION_PCT", "40"
    )

    now_iso = datetime.now(timezone.utc).isoformat()
    prices = get_ticker_prices(
        [str(s.get("market") or "") for s in signals["strategies"] if s.get("market")]
    )

    for strat in signals["strategies"]:
        sid = str(strat.get("id") or "")
        market = str(strat.get("market") or "")
        action = str(strat.get("action") or "hold")
        if action not in {"buy", "sell"} or not market or market == "—":
            continue
        if action == "buy" and not trade_cfg.upbit_strategy_enabled(sid):
            result["skipped"].append(f"strategy_off:{sid}")
            continue
        if not _cooldown_ok(state, sid, action):
            result["skipped"].append(f"cooldown:{sid}")
            continue

        px = prices.get(market) or 0.0
        target_pct = float(strat.get("target_weight_pct") or 0)
        target_krw = (equity * target_pct / 100) if equity > 0 else 0
        coin_bal = get_coin_balance(market) if has_upbit_keys() else 0.0
        pos_krw = coin_bal * px if px > 0 else 0.0

        entry: dict[str, Any] = {
            "strategy": sid,
            "market": market,
            "action": action,
            "reason": strat.get("reason"),
            "target_krw": int(target_krw),
            "position_krw": int(pos_krw),
            "mode": result["mode"],
        }

        if action == "buy":
            if pos_krw > 0:
                entry["skip"] = "already_holding"
                result["skipped"].append(f"{sid}:already_holding")
                result["actions"].append(entry)
                continue
            spend = int(min(target_krw, max(0, krw_cash - min_reserve)))
            if spend < 5000:
                entry["skip"] = "insufficient_krw"
                result["skipped"].append(f"{sid}:insufficient_krw")
                result["actions"].append(entry)
                continue
            if equity > 0 and 100 * spend / equity > max_position_pct:
                spend = int(equity * max_position_pct / 100)
            entry["spend_krw"] = spend
            if live and has_upbit_keys():
                try:
                    order_test(
                        {
                            "market": market,
                            "side": "bid",
                            "price": str(spend),
                            "ord_type": "price",
                        }
                    )
                    order = market_buy_krw(market, spend)
                    entry["order_uuid"] = order.get("uuid")
                    entry["status"] = "placed"
                    krw_cash = max(0, krw_cash - spend)
                except Exception as exc:
                    entry["status"] = "error"
                    entry["error"] = str(exc)
            else:
                entry["status"] = "dry_run"

        elif action == "sell":
            if coin_bal <= 0:
                entry["skip"] = "no_position"
                result["skipped"].append(f"{sid}:no_position")
                result["actions"].append(entry)
                continue
            entry["volume"] = coin_bal
            if live and has_upbit_keys():
                try:
                    order_test(
                        {
                            "market": market,
                            "side": "ask",
                            "volume": f"{coin_bal:.8f}".rstrip("0").rstrip("."),
                            "ord_type": "market",
                        }
                    )
                    order = market_sell_volume(market, coin_bal)
                    entry["order_uuid"] = order.get("uuid")
                    entry["status"] = "placed"
                except Exception as exc:
                    entry["status"] = "error"
                    entry["error"] = str(exc)
            else:
                entry["status"] = "dry_run"

        result["actions"].append(entry)
        if entry.get("status") in {"placed", "dry_run"} and not entry.get("skip"):
            last_actions = dict(state.get("last_actions") or {})
            last_actions[sid] = {"action": action, "at": now_iso, "market": market}
            state["last_actions"] = last_actions
            recent = list(state.get("recent_orders") or [])
            recent.append({**entry, "ts": now_iso})
            state["recent_orders"] = recent[-50:]

    state["last_signals_at"] = gen_at
    state["last_run_at"] = now_iso
    put_json(STATE_KEY, state)
    _append_log(
        {
            "ts": now_iso,
            "event": "executor_run",
            "mode": result["mode"],
            "signals_at": gen_at,
            "actions": result["actions"],
            "skipped": result["skipped"],
        }
    )
    result["ok"] = True
    return result


run_crypto_executor = run_upbit_executor
