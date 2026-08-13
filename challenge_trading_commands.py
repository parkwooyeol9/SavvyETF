"""Telegram commands for challenge live trading control.

Admin-only. Overrides persist in R2 via challenge_trading_config.
"""

from __future__ import annotations

import os
import time
from typing import Any

import challenge_trading_config as cfg

_PENDING_TTL_SEC = 300.0
# chat_id -> wizard state
_pending_by_chat: dict[int, dict[str, Any]] = {}

UPBIT_RISK_FIELDS = [
    {
        "key": "max_daily_loss_pct",
        "label": "일손실 한도 %",
        "hint": "예: 3 (= -3%에서 추가주문 중단)",
        "kind": "float",
        "min": 0.1,
        "max": 50,
    },
    {
        "key": "max_position_pct",
        "label": "종목 비중 상한 %",
        "hint": "예: 20",
        "kind": "float",
        "min": 1,
        "max": 100,
    },
    {
        "key": "min_krw_reserve",
        "label": "KRW 최소 예비금",
        "hint": "예: 200000",
        "kind": "int",
        "min": 0,
        "max": 1_000_000_000,
    },
    {
        "key": "order_cooldown_seconds",
        "label": "주문 쿨다운(초)",
        "hint": "예: 3600",
        "kind": "int",
        "min": 0,
        "max": 86400,
    },
]

BINANCE_RISK_FIELDS = [
    {
        "key": "max_daily_loss_pct",
        "label": "일손실 한도 %",
        "hint": "예: 3",
        "kind": "float",
        "min": 0.1,
        "max": 50,
    },
    {
        "key": "max_position_pct",
        "label": "종목 비중 상한 %",
        "hint": "예: 20",
        "kind": "float",
        "min": 1,
        "max": 100,
    },
    {
        "key": "min_usdt_reserve",
        "label": "USDT 최소 예비금",
        "hint": "예: 100",
        "kind": "float",
        "min": 0,
        "max": 10_000_000,
    },
    {
        "key": "order_cooldown_seconds",
        "label": "주문 쿨다운(초)",
        "hint": "예: 3600",
        "kind": "int",
        "min": 0,
        "max": 86400,
    },
]

KIMCHI_RISK_FIELDS = [
    {
        "key": "max_krw",
        "label": "업비트 최대 KRW",
        "hint": "예: 700000",
        "kind": "int",
        "min": 10000,
        "max": 1_000_000_000,
    },
    {
        "key": "max_usdt",
        "label": "바이낸스 최대 USDT",
        "hint": "예: 500",
        "kind": "float",
        "min": 10,
        "max": 10_000_000,
    },
    {
        "key": "enter_pct",
        "label": "진입 김프 %",
        "hint": "예: 3.0",
        "kind": "float",
        "min": 0.1,
        "max": 20,
    },
    {
        "key": "exit_pct",
        "label": "청산(저) 김프 %",
        "hint": "예: 0.5",
        "kind": "float",
        "min": 0,
        "max": 20,
    },
    {
        "key": "steady_pct",
        "label": "목표(steady) 김프 %",
        "hint": "예: 1.2",
        "kind": "float",
        "min": 0,
        "max": 20,
    },
    {
        "key": "max_hold_days",
        "label": "최대 보유일",
        "hint": "예: 14",
        "kind": "float",
        "min": 0.5,
        "max": 90,
    },
    {
        "key": "max_adverse_pct",
        "label": "adverse 한도 %",
        "hint": "예: 2.5",
        "kind": "float",
        "min": 0.1,
        "max": 20,
    },
]

RISK_ENGINES = {
    "upbit": ("upbit", UPBIT_RISK_FIELDS, "업비트"),
    "binance": ("binance", BINANCE_RISK_FIELDS, "바이낸스"),
    "kimchi": ("kimchi", KIMCHI_RISK_FIELDS, "김프차익"),
}


def _parse_id_env(var_name: str) -> set[int]:
    ids: set[int] = set()
    for raw in os.environ.get(var_name, "").split(","):
        raw = raw.strip()
        if not raw:
            continue
        try:
            ids.add(int(raw))
        except ValueError:
            pass
    return ids


def challenge_admin_ids() -> set[int]:
    return _parse_id_env("CHALLENGE_ADMIN_USER_IDS") | _parse_id_env(
        "TELEGRAM_ALLOWED_USER_IDS"
    )


def challenge_admin_chat_ids() -> set[int]:
    return _parse_id_env("CHALLENGE_ADMIN_CHAT_IDS") | _parse_id_env(
        "TELEGRAM_ALLOWED_CHAT_IDS"
    )


def is_challenge_admin(*, user_id: int | None, chat_id: int) -> bool:
    users = challenge_admin_ids()
    chats = challenge_admin_chat_ids()
    if not users and not chats:
        return False
    if chat_id in chats:
        return True
    if user_id is not None and user_id in users:
        return True
    return False


def deny_admin_message() -> str:
    return (
        "⚠️ 챌린지 라이브 제어는 관리자만 사용할 수 있습니다.\n"
        "Render에 <code>TELEGRAM_ALLOWED_USER_IDS</code> "
        "(또는 <code>CHALLENGE_ADMIN_USER_IDS</code>)를 설정하세요."
    )


def clear_pending(chat_id: int) -> None:
    _pending_by_chat.pop(chat_id, None)


def is_pending_challenge_reply(chat_id: int, text: str) -> bool:
    if not text or text.lstrip().startswith("/"):
        return False
    st = _pending_by_chat.get(chat_id)
    if not st:
        return False
    if time.time() - float(st.get("started") or 0) > _PENDING_TTL_SEC:
        clear_pending(chat_id)
        return False
    return True


def command_token(text: str) -> str:
    parts = (text or "").strip().split()
    if not parts:
        return ""
    return parts[0].lower().split("@", 1)[0]


CHALLENGE_COMMAND_TOKENS = {
    "/upbit_live",
    "/upbit_off",
    "/upbit_risk",
    "/upbit_kill",
    "/upbit_unkill",
    "/binance_live",
    "/binance_off",
    "/binance_risk",
    "/binance_kill",
    "/binance_unkill",
    "/kimchi_live",
    "/kimch_live",
    "/kimchi_off",
    "/kimch_off",
    "/kimchi_risk",
    "/kimch_risk",
    "/kimchi_kill",
    "/kimch_kill",
    "/kimchi_unkill",
    "/kimch_unkill",
    "/challenge_status",
    "/challenge_live",
    "/challenge_off",
    "/challenge_kill",
    "/challenge_unkill",
    "/challenge_help",
    "/live_status",
    "/live_help",
}


def is_challenge_command(text: str) -> bool:
    return command_token(text) in CHALLENGE_COMMAND_TOKENS


def is_challenge_control_message(text: str, chat_id: int) -> bool:
    tok = command_token(text)
    if tok == "/cancel" and chat_id in _pending_by_chat:
        return True
    if is_challenge_command(text):
        return True
    return is_pending_challenge_reply(chat_id, text)


def _html(s: str) -> dict[str, str]:
    return {"text": s, "parse_mode": "HTML"}


def _mode_emoji(live: bool, killed: bool) -> str:
    if killed:
        return "🛑 KILL"
    return "🔴 LIVE" if live else "🟢 DRY"


def format_status() -> str:
    snap = cfg.status_snapshot()
    ef = snap["effective"]
    c = snap["config"]
    lines = [
        "<b>천만원 챌린지 · 라이브 상태</b>",
        f"업비트: <b>{_mode_emoji(ef['upbit_live'], ef['upbit_kill'])}</b>",
        f"바이낸스: <b>{_mode_emoji(ef['binance_live'], ef['binance_kill'])}</b>",
        f"김프차익: <b>{_mode_emoji(ef['kimchi_arb_live'], ef['kimchi_arb_kill'])}</b>",
        f"CHALLENGE_LIVE 플래그: {'ON' if ef['challenge_live_flag'] else 'OFF'}",
        "",
        "<b>업비트 리스크</b>",
    ]
    ur = ef["upbit_risk"]
    lines.append(
        f"· 일손실 {ur['max_daily_loss_pct']}% · 비중 {ur['max_position_pct']}% · "
        f"예비 ₩{ur['min_krw_reserve']:,} · 쿨다운 {ur['order_cooldown_seconds']}s"
    )
    br = ef["binance_risk"]
    lines.append("<b>바이낸스 리스크</b>")
    lines.append(
        f"· 일손실 {br['max_daily_loss_pct']}% · 비중 {br['max_position_pct']}% · "
        f"예비 ${br['min_usdt_reserve']} · 쿨다운 {br['order_cooldown_seconds']}s"
    )
    kr = ef["kimchi_risk"]
    lines.append("<b>김프 리스크</b>")
    lines.append(
        f"· max ₩{kr['max_krw']:,} / ${kr['max_usdt']} · enter {kr['enter_pct']}% · "
        f"exit {kr['exit_pct']}% · hold {kr['max_hold_days']}d · adv {kr['max_adverse_pct']}%"
    )
    if c.get("updated_at"):
        lines.append("")
        lines.append(
            f"<i>config 갱신: {c.get('updated_at')} · by {c.get('updated_by') or '—'}</i>"
        )
    lines.append(
        "<i>R2 override 우선 · 없으면 Render env 폴백. "
        "도움말: /challenge_help</i>"
    )
    return "\n".join(lines)


def format_challenge_help() -> str:
    return """<b>챌린지 라이브 제어</b>

<code>/challenge_status</code> — 현재 LIVE/리스크 상태
<code>/upbit_live</code> → <code>/upbit_live confirm</code> — 업비트 실주문 ON
<code>/upbit_off</code> — 업비트 OFF (dry-run)
<code>/upbit_risk</code> — 업비트 리스크 대화형 조정
<code>/binance_live</code> / <code>/binance_off</code> / <code>/binance_risk</code>
<code>/kimchi_live</code> (또는 <code>/kimch_live</code>) / <code>/kimchi_off</code> / <code>/kimchi_risk</code>
<code>/upbit_kill</code> · <code>/binance_kill</code> · <code>/kimchi_kill</code> · <code>/challenge_kill</code> — 즉시 중단
<code>/challenge_off</code> — CHALLENGE_LIVE 플래그 OFF + 엔진 live OFF

리스크 한 줄 입력 예:
<code>/upbit_risk 3 20 200000 3600</code>
<code>/binance_risk 3 20 100 3600</code>
<code>/kimchi_risk 700000 500 3.0 0.5 1.2 14 2.5</code>

대화형: 명령만 치면 순서대로 물어봄. 유지=<code>-</code> · 취소=<code>/cancel</code>"""


def _by_line(updated_by: str | None) -> str:
    return updated_by or "telegram"


def _set_engine_live(
    engine: str,
    *,
    live: bool,
    updated_by: str | None,
) -> dict[str, Any]:
    key = {
        "upbit": "upbit_live",
        "binance": "binance_live",
        "kimchi": "kimchi_arb_live",
    }[engine]
    kill_key = {
        "upbit": "upbit_kill",
        "binance": "binance_kill",
        "kimchi": "kimchi_arb_kill",
    }[engine]
    updates: dict[str, Any] = {key: live}
    if live:
        updates[kill_key] = False
        # Avoid master flag unexpectedly forcing other engines live.
        # Only clear challenge_live when turning a single engine on.
        updates["challenge_live"] = False
    return cfg.patch_config(updates, updated_by=_by_line(updated_by))


def _parse_confirm(parts: list[str]) -> bool:
    if len(parts) < 2:
        return False
    return parts[1].lower() in {"confirm", "yes", "y", "확인", "ok"}


def _live_warn(engine_ko: str, confirm_cmd: str) -> str:
    return (
        f"⚠️ <b>{engine_ko} 실주문(LIVE)을 켭니다.</b>\n"
        "시장가 주문이 나갈 수 있습니다. 잔고·레버리지·출금잠금을 확인하세요.\n\n"
        f"확인: <code>{confirm_cmd} confirm</code>\n"
        "취소: 무시하거나 다른 명령 입력"
    )


def _current_risk_value(section: str, field: dict[str, Any]) -> float:
    key = field["key"]
    env_map = {
        ("upbit", "max_daily_loss_pct"): ("UPBIT_MAX_DAILY_LOSS_PCT", "5"),
        ("upbit", "max_position_pct"): ("UPBIT_MAX_POSITION_PCT", "40"),
        ("upbit", "min_krw_reserve"): ("UPBIT_MIN_KRW_RESERVE", "100000"),
        ("upbit", "order_cooldown_seconds"): ("UPBIT_ORDER_COOLDOWN_SECONDS", "3600"),
        ("binance", "max_daily_loss_pct"): ("BINANCE_MAX_DAILY_LOSS_PCT", "5"),
        ("binance", "max_position_pct"): ("BINANCE_MAX_POSITION_PCT", "40"),
        ("binance", "min_usdt_reserve"): ("BINANCE_MIN_USDT_RESERVE", "50"),
        ("binance", "order_cooldown_seconds"): (
            "BINANCE_ORDER_COOLDOWN_SECONDS",
            "3600",
        ),
        ("kimchi", "max_usdt"): ("KIMCHI_ARB_MAX_USDT", "500"),
        ("kimchi", "max_krw"): ("KIMCHI_ARB_MAX_KRW", "700000"),
        ("kimchi", "enter_pct"): ("KIMCHI_ARB_ENTER_PCT", "3.0"),
        ("kimchi", "exit_pct"): ("KIMCHI_ARB_EXIT_PCT", "0.5"),
        ("kimchi", "steady_pct"): ("KIMCHI_ARB_STEADY_PCT", "1.2"),
        ("kimchi", "max_hold_days"): ("KIMCHI_ARB_MAX_HOLD_DAYS", "14"),
        ("kimchi", "max_adverse_pct"): ("KIMCHI_ARB_MAX_ADVERSE_PCT", "2.5"),
    }
    env_name, default = env_map[(section, key)]
    if field["kind"] == "int":
        return float(cfg.effective_int(section, key, env_name, default))
    return cfg.effective_float(section, key, env_name, default)


def _prompt_risk_step(state: dict[str, Any]) -> str:
    section, fields, label = RISK_ENGINES[state["engine"]]
    step = int(state["step"])
    field = fields[step]
    cur = _current_risk_value(section, field)
    cur_disp = int(cur) if field["kind"] == "int" else cur
    total = len(fields)
    return (
        f"<b>{label} 리스크 조정</b> ({step + 1}/{total})\n"
        f"<b>{field['label']}</b> 현재: <code>{cur_disp}</code>\n"
        f"{field['hint']}\n\n"
        "숫자 입력 · 유지 <code>-</code> · 취소 <code>/cancel</code>\n"
        f"한 줄 전체: <code>/{state['engine']}_risk …</code>"
    )


def _parse_risk_token(raw: str, field: dict[str, Any]) -> tuple[Any | None, str | None]:
    s = raw.strip()
    if s in {"-", "–", "—", "pass", "skip", "유지"}:
        return None, None  # keep
    try:
        if field["kind"] == "int":
            val: Any = int(float(s.replace(",", "")))
        else:
            val = float(s.replace(",", ""))
    except ValueError:
        return None, f"숫자를 입력하세요 ({field['label']})"
    if val < field["min"] or val > field["max"]:
        return None, f"{field['label']} 범위: {field['min']}–{field['max']}"
    return val, None


def _apply_risk_values(
    engine: str,
    values: dict[str, Any],
    *,
    updated_by: str | None,
) -> dict[str, Any]:
    section, _fields, _label = RISK_ENGINES[engine]
    # Drop Nones (keep)
    clean = {k: v for k, v in values.items() if v is not None}
    if not clean:
        return cfg.load_config(force=True)
    return cfg.patch_config(clean, section=section, updated_by=_by_line(updated_by))


def _start_risk_wizard(chat_id: int, engine: str) -> list[dict]:
    if engine not in RISK_ENGINES:
        return [_html("unknown engine")]
    _pending_by_chat[chat_id] = {
        "kind": "risk",
        "engine": engine,
        "step": 0,
        "values": {},
        "started": time.time(),
    }
    return [_html(_prompt_risk_step(_pending_by_chat[chat_id]))]


def _finish_risk(chat_id: int, engine: str, values: dict[str, Any], updated_by: str) -> list[dict]:
    clear_pending(chat_id)
    saved = _apply_risk_values(engine, values, updated_by=updated_by)
    persisted = saved.get("_persisted", True)
    label = RISK_ENGINES[engine][2]
    lines = [f"✅ <b>{label} 리스크 저장</b>"]
    for k, v in values.items():
        if v is None:
            lines.append(f"· {k}: (유지)")
        else:
            lines.append(f"· {k}: <code>{v}</code>")
    if not persisted:
        lines.append("⚠️ R2 저장 실패 — 프로세스 메모리에만 적용(재시작 시 소실)")
    lines.append("확인: /challenge_status")
    return [_html("\n".join(lines))]


def _handle_risk_oneshot(
    engine: str,
    parts: list[str],
    *,
    chat_id: int,
    updated_by: str,
) -> list[dict]:
    section, fields, label = RISK_ENGINES[engine]
    args = parts[1:]
    if len(args) != len(fields):
        return [
            _html(
                f"{label} 리스크: 값 {len(fields)}개 필요.\n"
                + " ".join(f"[{f['label']}]" for f in fields)
                + f"\n또는 <code>/{engine}_risk</code> 만 입력해 대화형으로."
            )
        ]
    values: dict[str, Any] = {}
    for field, raw in zip(fields, args):
        val, err = _parse_risk_token(raw, field)
        if err:
            return [_html(err)]
        values[field["key"]] = val  # None means keep — skip in apply
    # For oneshot, "-" keeps; omit from patch
    return _finish_risk(chat_id, engine, values, updated_by)


def _handle_pending_risk(chat_id: int, text: str, updated_by: str) -> list[dict]:
    st = _pending_by_chat.get(chat_id)
    if not st or st.get("kind") != "risk":
        return [_html("진행 중인 리스크 조정이 없습니다. /upbit_risk 등으로 시작하세요.")]
    engine = st["engine"]
    section, fields, _label = RISK_ENGINES[engine]
    step = int(st["step"])
    field = fields[step]
    val, err = _parse_risk_token(text, field)
    if err:
        return [_html(err + "\n" + _prompt_risk_step(st))]
    st["values"][field["key"]] = val
    st["step"] = step + 1
    st["started"] = time.time()
    if st["step"] >= len(fields):
        return _finish_risk(chat_id, engine, st["values"], updated_by)
    return [_html(_prompt_risk_step(st))]


def handle_challenge_command(
    message: str,
    chat_id: int,
    *,
    user_id: int | None = None,
) -> list[dict] | None:
    """Return replies if this is a challenge control message; else None."""
    normalized = (message or "").strip()
    if not normalized:
        return None

    if is_pending_challenge_reply(chat_id, normalized):
        if not is_challenge_admin(user_id=user_id, chat_id=chat_id):
            clear_pending(chat_id)
            return [_html(deny_admin_message())]
        updated_by = f"tg:{user_id or chat_id}"
        return _handle_pending_risk(chat_id, normalized, updated_by)

    lower = normalized.lower()
    tok = command_token(lower)
    if tok == "/cancel":
        if chat_id in _pending_by_chat:
            clear_pending(chat_id)
            return [_html("리스크 조정을 취소했습니다.")]
        return None

    if tok not in CHALLENGE_COMMAND_TOKENS:
        return None

    # Slash command clears unrelated pending elsewhere; clear our pending unless risk oneshot
    if tok not in {
        "/upbit_risk",
        "/binance_risk",
        "/kimchi_risk",
        "/kimch_risk",
    }:
        clear_pending(chat_id)

    if not is_challenge_admin(user_id=user_id, chat_id=chat_id):
        return [_html(deny_admin_message())]

    updated_by = f"tg:{user_id or chat_id}"
    parts = normalized.split()

    if tok in {"/challenge_status", "/live_status"}:
        return [_html(format_status())]

    if tok in {"/challenge_help", "/live_help"}:
        return [_html(format_challenge_help())]

    if tok == "/upbit_live":
        if not _parse_confirm(parts):
            return [_html(_live_warn("업비트", "/upbit_live"))]
        saved = _set_engine_live("upbit", live=True, updated_by=updated_by)
        note = "" if saved.get("_persisted", True) else "\n⚠️ R2 미저장(메모리만)"
        return [_html(f"🔴 <b>업비트 LIVE ON</b>{note}\n확인: /challenge_status")]

    if tok == "/upbit_off":
        _set_engine_live("upbit", live=False, updated_by=updated_by)
        return [_html("🟢 <b>업비트 LIVE OFF</b> (dry-run)\n확인: /challenge_status")]

    if tok == "/binance_live":
        if not _parse_confirm(parts):
            return [_html(_live_warn("바이낸스", "/binance_live"))]
        _set_engine_live("binance", live=True, updated_by=updated_by)
        return [_html("🔴 <b>바이낸스 LIVE ON</b>\n확인: /challenge_status")]

    if tok == "/binance_off":
        _set_engine_live("binance", live=False, updated_by=updated_by)
        return [_html("🟢 <b>바이낸스 LIVE OFF</b> (dry-run)\n확인: /challenge_status")]

    if tok in {"/kimchi_live", "/kimch_live"}:
        if not _parse_confirm(parts):
            return [_html(_live_warn("김프 차익거래", "/kimchi_live"))]
        _set_engine_live("kimchi", live=True, updated_by=updated_by)
        return [_html("🔴 <b>김프차익 LIVE ON</b>\n확인: /challenge_status")]

    if tok in {"/kimchi_off", "/kimch_off"}:
        _set_engine_live("kimchi", live=False, updated_by=updated_by)
        return [_html("🟢 <b>김프차익 LIVE OFF</b>\n확인: /challenge_status")]

    if tok == "/challenge_live":
        if not _parse_confirm(parts):
            return [
                _html(
                    "⚠️ <b>CHALLENGE_LIVE</b>는 업비트+바이낸스+김프를 한꺼번에 켭니다.\n"
                    "가능하면 엔진별 <code>/upbit_live confirm</code> 등을 쓰세요.\n\n"
                    "그래도 진행: <code>/challenge_live confirm</code>"
                )
            ]
        cfg.patch_config(
            {
                "challenge_live": True,
                "challenge_kill": False,
                "upbit_kill": False,
                "binance_kill": False,
                "kimchi_arb_kill": False,
            },
            updated_by=updated_by,
        )
        return [_html("🔴 <b>CHALLENGE_LIVE ON</b> (전 엔진)\n확인: /challenge_status")]

    if tok == "/challenge_off":
        cfg.patch_config(
            {
                "challenge_live": False,
                "upbit_live": False,
                "binance_live": False,
                "kimchi_arb_live": False,
            },
            updated_by=updated_by,
        )
        return [_html("🟢 <b>챌린지 LIVE 전부 OFF</b>\n확인: /challenge_status")]

    if tok == "/upbit_kill":
        cfg.patch_config({"upbit_kill": True, "upbit_live": False}, updated_by=updated_by)
        return [_html("🛑 <b>업비트 KILL</b> — 주문 스킵")]

    if tok == "/upbit_unkill":
        cfg.patch_config({"upbit_kill": False}, updated_by=updated_by)
        return [_html("업비트 kill 해제 (live는 별도 /upbit_live confirm)")]

    if tok == "/binance_kill":
        cfg.patch_config(
            {"binance_kill": True, "binance_live": False}, updated_by=updated_by
        )
        return [_html("🛑 <b>바이낸스 KILL</b>")]

    if tok == "/binance_unkill":
        cfg.patch_config({"binance_kill": False}, updated_by=updated_by)
        return [_html("바이낸스 kill 해제")]

    if tok in {"/kimchi_kill", "/kimch_kill"}:
        cfg.patch_config(
            {"kimchi_arb_kill": True, "kimchi_arb_live": False}, updated_by=updated_by
        )
        return [_html("🛑 <b>김프 KILL</b>")]

    if tok in {"/kimchi_unkill", "/kimch_unkill"}:
        cfg.patch_config({"kimchi_arb_kill": False}, updated_by=updated_by)
        return [_html("김프 kill 해제")]

    if tok == "/challenge_kill":
        cfg.patch_config(
            {
                "challenge_kill": True,
                "challenge_live": False,
                "upbit_live": False,
                "binance_live": False,
                "kimchi_arb_live": False,
            },
            updated_by=updated_by,
        )
        return [_html("🛑 <b>CHALLENGE KILL</b> — 전 엔진 중단")]

    if tok == "/challenge_unkill":
        cfg.patch_config({"challenge_kill": False}, updated_by=updated_by)
        return [_html("challenge kill 해제 (엔진 live는 별도 확인)")]

    if tok == "/upbit_risk":
        if len(parts) > 1:
            return _handle_risk_oneshot(
                "upbit", parts, chat_id=chat_id, updated_by=updated_by
            )
        return _start_risk_wizard(chat_id, "upbit")

    if tok == "/binance_risk":
        if len(parts) > 1:
            return _handle_risk_oneshot(
                "binance", parts, chat_id=chat_id, updated_by=updated_by
            )
        return _start_risk_wizard(chat_id, "binance")

    if tok in {"/kimchi_risk", "/kimch_risk"}:
        if len(parts) > 1:
            return _handle_risk_oneshot(
                "kimchi", parts, chat_id=chat_id, updated_by=updated_by
            )
        return _start_risk_wizard(chat_id, "kimchi")

    return [_html("알 수 없는 챌린지 명령. /challenge_help")]
