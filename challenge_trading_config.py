"""Runtime overrides for challenge live trading (Telegram-controllable).

Stored in R2 so Render bot restarts keep the last Telegram settings.
Env vars remain the fallback when an override is unset (null).
"""

from __future__ import annotations

import os
import threading
import time
from datetime import datetime, timezone
from typing import Any

from r2_data import get_json, put_json

CONFIG_KEY = "challenge/runtime_config_v1.json"

_cache_lock = threading.Lock()
_cache: dict[str, Any] | None = None
_cache_at = 0.0
_CACHE_TTL_SEC = 3.0


def _env_bool(name: str, default: str = "false") -> bool:
    return os.environ.get(name, default).strip().lower() in {"1", "true", "yes", "on"}


def _env_float(name: str, default: str) -> float:
    try:
        return float(os.environ.get(name, default))
    except ValueError:
        return float(default)


def _env_int(name: str, default: str) -> int:
    try:
        return int(float(os.environ.get(name, default)))
    except ValueError:
        return int(float(default))


def default_config() -> dict[str, Any]:
    return {
        "version": 1,
        "updated_at": None,
        "updated_by": None,
        "note": "Telegram /upbit_live · /binance_live · /kimchi_live · *_risk overrides",
        # null = fall through to process env
        "upbit_live": None,
        "binance_live": None,
        "kimchi_arb_live": None,
        "challenge_live": None,
        "upbit_kill": None,
        "binance_kill": None,
        "kimchi_arb_kill": None,
        "challenge_kill": None,
        "upbit": {
            "max_daily_loss_pct": None,
            "max_position_pct": None,
            "min_krw_reserve": None,
            "order_cooldown_seconds": None,
        },
        # Live Upbit strategy gates (executor skips buy when false; sell still allowed to exit)
        "upbit_strategies": {
            "major_btc": True,
            "major_eth": True,
            "kimchi_usdt": True,
            "alt_surge": True,
        },
        "binance": {
            "max_daily_loss_pct": None,
            "max_position_pct": None,
            "min_usdt_reserve": None,
            "order_cooldown_seconds": None,
        },
        "kimchi": {
            "max_usdt": None,
            "max_krw": None,
            "enter_pct": None,
            "exit_pct": None,
            "steady_pct": None,
            "max_hold_days": None,
            "max_adverse_pct": None,
        },
    }


def _merge_defaults(raw: dict[str, Any] | None) -> dict[str, Any]:
    base = default_config()
    if not raw:
        return base
    out = {
        **base,
        **{
            k: v
            for k, v in raw.items()
            if k not in {"upbit", "binance", "kimchi", "upbit_strategies"}
        },
    }
    for section in ("upbit", "binance", "kimchi"):
        sec = dict(base[section])
        incoming = raw.get(section) if isinstance(raw.get(section), dict) else {}
        sec.update({k: v for k, v in (incoming or {}).items() if k in sec})
        out[section] = sec
    strat = dict(base["upbit_strategies"])
    incoming_s = (
        raw.get("upbit_strategies") if isinstance(raw.get("upbit_strategies"), dict) else {}
    )
    for k in strat:
        if k in (incoming_s or {}) and incoming_s[k] is not None:
            strat[k] = bool(incoming_s[k])
    out["upbit_strategies"] = strat
    return out


def load_config(*, force: bool = False) -> dict[str, Any]:
    global _cache, _cache_at
    now = time.monotonic()
    with _cache_lock:
        if (
            not force
            and _cache is not None
            and (now - _cache_at) < _CACHE_TTL_SEC
        ):
            return dict(_cache)
    blob = get_json(CONFIG_KEY)
    cfg = _merge_defaults(blob if isinstance(blob, dict) else None)
    with _cache_lock:
        _cache = cfg
        _cache_at = time.monotonic()
    return dict(cfg)


def save_config(cfg: dict[str, Any], *, updated_by: str | None = None) -> dict[str, Any]:
    merged = _merge_defaults(cfg)
    merged["updated_at"] = datetime.now(timezone.utc).isoformat()
    if updated_by:
        merged["updated_by"] = updated_by
    ok = put_json(CONFIG_KEY, merged)
    if not ok:
        # Still apply in-process if R2 unavailable (survives until restart).
        pass
    with _cache_lock:
        global _cache, _cache_at
        _cache = merged
        _cache_at = time.monotonic()
    merged["_persisted"] = bool(ok)
    return merged


def patch_config(
    updates: dict[str, Any],
    *,
    section: str | None = None,
    updated_by: str | None = None,
) -> dict[str, Any]:
    cfg = load_config(force=True)
    if section:
        sec = dict(cfg.get(section) or {})
        sec.update(updates)
        cfg[section] = sec
    else:
        cfg.update(updates)
    return save_config(cfg, updated_by=updated_by)


def _override_bool(cfg: dict[str, Any], key: str) -> bool | None:
    if key not in cfg:
        return None
    val = cfg.get(key)
    if val is None:
        return None
    if isinstance(val, bool):
        return val
    if isinstance(val, (int, float)):
        return bool(val)
    return str(val).strip().lower() in {"1", "true", "yes", "on"}


def effective_bool(cfg_key: str, env_name: str, default: str = "false") -> bool:
    cfg = load_config()
    ov = _override_bool(cfg, cfg_key)
    if ov is not None:
        return ov
    return _env_bool(env_name, default)


def effective_float(
    section: str,
    key: str,
    env_name: str,
    default: str,
) -> float:
    cfg = load_config()
    sec = cfg.get(section) or {}
    val = sec.get(key)
    if val is not None:
        try:
            return float(val)
        except (TypeError, ValueError):
            pass
    return _env_float(env_name, default)


def effective_int(
    section: str,
    key: str,
    env_name: str,
    default: str,
) -> int:
    return int(effective_float(section, key, env_name, default))


def upbit_kill() -> bool:
    return effective_bool("upbit_kill", "UPBIT_KILL_SWITCH") or effective_bool(
        "challenge_kill", "CHALLENGE_KILL_SWITCH"
    )


def binance_kill() -> bool:
    return effective_bool("binance_kill", "BINANCE_KILL_SWITCH") or effective_bool(
        "challenge_kill", "CHALLENGE_KILL_SWITCH"
    )


def kimchi_kill() -> bool:
    return effective_bool("kimchi_arb_kill", "KIMCHI_ARB_KILL_SWITCH") or effective_bool(
        "challenge_kill", "CHALLENGE_KILL_SWITCH"
    )


def upbit_live() -> bool:
    if upbit_kill():
        return False
    if effective_bool("challenge_live", "CHALLENGE_LIVE"):
        return True
    return effective_bool("upbit_live", "UPBIT_LIVE")


def binance_live() -> bool:
    if binance_kill():
        return False
    if effective_bool("challenge_live", "CHALLENGE_LIVE"):
        return True
    return effective_bool("binance_live", "BINANCE_LIVE")


def kimchi_live() -> bool:
    if kimchi_kill():
        return False
    if effective_bool("challenge_live", "CHALLENGE_LIVE"):
        return True
    return effective_bool("kimchi_arb_live", "KIMCHI_ARB_LIVE")


UPBIT_STRATEGY_IDS = ("major_btc", "major_eth", "kimchi_usdt", "alt_surge")

UPBIT_STRATEGY_LABELS = {
    "major_btc": "메이저 BTC",
    "major_eth": "메이저 ETH",
    "kimchi_usdt": "김프·USDT",
    "alt_surge": "알트 급등",
}


def upbit_strategies() -> dict[str, bool]:
    cfg = load_config()
    base = default_config()["upbit_strategies"]
    cur = cfg.get("upbit_strategies") if isinstance(cfg.get("upbit_strategies"), dict) else {}
    out: dict[str, bool] = {}
    for sid in UPBIT_STRATEGY_IDS:
        if sid in (cur or {}) and cur[sid] is not None:
            out[sid] = bool(cur[sid])
        else:
            out[sid] = bool(base.get(sid, True))
    return out


def upbit_strategy_enabled(strategy_id: str) -> bool:
    return bool(upbit_strategies().get(strategy_id, True))


def set_upbit_strategies(
    updates: dict[str, bool],
    *,
    updated_by: str | None = None,
) -> dict[str, Any]:
    clean = {k: bool(v) for k, v in updates.items() if k in UPBIT_STRATEGY_IDS}
    return patch_config(clean, section="upbit_strategies", updated_by=updated_by)


def status_snapshot() -> dict[str, Any]:
    cfg = load_config(force=True)
    return {
        "config": cfg,
        "effective": {
            "upbit_live": upbit_live(),
            "binance_live": binance_live(),
            "kimchi_arb_live": kimchi_live(),
            "upbit_kill": upbit_kill(),
            "binance_kill": binance_kill(),
            "kimchi_arb_kill": kimchi_kill(),
            "challenge_live_flag": effective_bool("challenge_live", "CHALLENGE_LIVE"),
            "challenge_kill_flag": effective_bool("challenge_kill", "CHALLENGE_KILL_SWITCH"),
            "upbit_strategies": upbit_strategies(),
            "upbit_risk": {
                "max_daily_loss_pct": effective_float(
                    "upbit", "max_daily_loss_pct", "UPBIT_MAX_DAILY_LOSS_PCT", "5"
                ),
                "max_position_pct": effective_float(
                    "upbit", "max_position_pct", "UPBIT_MAX_POSITION_PCT", "40"
                ),
                "min_krw_reserve": effective_int(
                    "upbit", "min_krw_reserve", "UPBIT_MIN_KRW_RESERVE", "100000"
                ),
                "order_cooldown_seconds": effective_int(
                    "upbit",
                    "order_cooldown_seconds",
                    "UPBIT_ORDER_COOLDOWN_SECONDS",
                    "3600",
                ),
            },
            "binance_risk": {
                "max_daily_loss_pct": effective_float(
                    "binance", "max_daily_loss_pct", "BINANCE_MAX_DAILY_LOSS_PCT", "5"
                ),
                "max_position_pct": effective_float(
                    "binance", "max_position_pct", "BINANCE_MAX_POSITION_PCT", "40"
                ),
                "min_usdt_reserve": effective_float(
                    "binance", "min_usdt_reserve", "BINANCE_MIN_USDT_RESERVE", "50"
                ),
                "order_cooldown_seconds": effective_int(
                    "binance",
                    "order_cooldown_seconds",
                    "BINANCE_ORDER_COOLDOWN_SECONDS",
                    "3600",
                ),
            },
            "kimchi_risk": {
                "max_usdt": effective_float(
                    "kimchi", "max_usdt", "KIMCHI_ARB_MAX_USDT", "500"
                ),
                "max_krw": effective_int(
                    "kimchi", "max_krw", "KIMCHI_ARB_MAX_KRW", "700000"
                ),
                "enter_pct": effective_float(
                    "kimchi", "enter_pct", "KIMCHI_ARB_ENTER_PCT", "3.0"
                ),
                "exit_pct": effective_float(
                    "kimchi", "exit_pct", "KIMCHI_ARB_EXIT_PCT", "0.5"
                ),
                "steady_pct": effective_float(
                    "kimchi", "steady_pct", "KIMCHI_ARB_STEADY_PCT", "1.2"
                ),
                "max_hold_days": effective_float(
                    "kimchi", "max_hold_days", "KIMCHI_ARB_MAX_HOLD_DAYS", "14"
                ),
                "max_adverse_pct": effective_float(
                    "kimchi", "max_adverse_pct", "KIMCHI_ARB_MAX_ADVERSE_PCT", "2.5"
                ),
            },
        },
        "env_fallback": {
            "UPBIT_LIVE": os.environ.get("UPBIT_LIVE", "false"),
            "BINANCE_LIVE": os.environ.get("BINANCE_LIVE", "false"),
            "KIMCHI_ARB_LIVE": os.environ.get("KIMCHI_ARB_LIVE", "false"),
            "CHALLENGE_LIVE": os.environ.get("CHALLENGE_LIVE", "false"),
        },
    }
