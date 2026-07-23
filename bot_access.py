"""Access control and abuse limits for the Telegram bot (public launch)."""

from __future__ import annotations

import os
import threading
import time
from typing import Iterable

# Commands that burn CPU / third-party quota — cooldown when allowlist is large.
HEAVY_COMMAND_TOKENS = {
    "/etf_holdings",
    "/etfholdings",
    "/etf_holding",
    "/dart",
    "/comp",
    "/nxt",
    "/summary",
    "/summary_pre",
    "/summary_kor",
    "/summary_kor_intra",
    "/summary_nxt",
    "/reddit",
    "/event",
    "/fin_estimate",
    "/finestimate",
    "/idx",
    "/heatmap",
    "/adr",
    "/financial",
    "/macro",
    "/aibriefing",
    "/esg",
    "/port",
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
            print(f"Ignoring invalid {var_name} entry: {raw!r}")
    return ids


def env_allowed_chat_ids() -> set[int]:
    return _parse_id_env("TELEGRAM_ALLOWED_CHAT_IDS")


def env_allowed_user_ids() -> set[int]:
    return _parse_id_env("TELEGRAM_ALLOWED_USER_IDS")


def access_mode() -> str:
    """
    allowlist — only allowed chats/users (+ env-pinned schedule channels)
    open — anyone can DM/commands (legacy; not for public launch)
    """
    explicit = os.environ.get("TELEGRAM_ACCESS_MODE", "").strip().lower()
    if explicit in {"allowlist", "open"}:
        return explicit
    if env_allowed_chat_ids() or env_allowed_user_ids():
        return "allowlist"
    return "open"


def heavy_cooldown_seconds() -> int:
    raw = os.environ.get("TELEGRAM_HEAVY_COOLDOWN_SECONDS", "45").strip()
    try:
        return max(0, int(raw))
    except ValueError:
        return 45


_last_heavy: dict[int, float] = {}
_last_heavy_lock = threading.Lock()


def is_heavy_command(command_text: str) -> bool:
    parts = (command_text or "").strip().split()
    if not parts:
        return False
    token = parts[0].lower().split("@", 1)[0]
    if token in HEAVY_COMMAND_TOKENS:
        return True
    # `/etf holdings …`
    if token == "/etf" and len(parts) >= 2 and parts[1].lower() in {
        "holdings",
        "holding",
        "편입",
        "편입비",
    }:
        return True
    return False


def check_heavy_cooldown(chat_id: int, command_text: str) -> str | None:
    """Return error message if chat must wait; else None."""
    seconds = heavy_cooldown_seconds()
    if seconds <= 0 or not is_heavy_command(command_text):
        return None
    now = time.monotonic()
    with _last_heavy_lock:
        prev = _last_heavy.get(chat_id)
        if prev is not None and now - prev < seconds:
            wait = int(seconds - (now - prev)) + 1
            return (
                f"고비용 명령 쿨다운 중입니다. {wait}초 후에 다시 시도해 주세요."
            )
        _last_heavy[chat_id] = now
    return None


def is_interaction_allowed(
    *,
    chat_id: int,
    user_id: int | None,
    pinned_chat_ids: Iterable[int],
) -> bool:
    if access_mode() != "allowlist":
        return True
    pinned = set(pinned_chat_ids)
    allowed_chats = env_allowed_chat_ids() | pinned
    allowed_users = env_allowed_user_ids()
    if chat_id in allowed_chats:
        return True
    if user_id is not None and user_id in allowed_users:
        return True
    return False


def denied_access_message() -> str:
    return (
        "이 봇은 초대된 사용자만 사용할 수 있습니다.\n"
        "접근 권한이 필요하면 운영자에게 문의해 주세요."
    )
