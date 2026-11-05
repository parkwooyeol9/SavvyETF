"""KRX 옵션 보드 일별 스케줄러.

매일 09:10 KST(KRX_OPTION_BOARD_SCHEDULE_KST)에 `publish_board(publish=True)` 를 돌려
JSON·엑셀을 만들고 웹 수신 API(/api/krx-option-board) 또는 R2 `krx_option_board/latest.*` 를 갱신한다.

KRX Open API 는 전 영업일 데이터를 D+1 오전(대략 08시 전후)에 게시한다. 09:10 이면
월~금 실행분이 전 영업일을, 토요일 실행분이 금요일을 반영한다. 일·월 오전처럼 새 영업일이
없으면 as_of 가 R2 최신과 같아 게시를 건너뛴다.

일별 요약은 00_exports/krx_option_board/cache/ 에 쌓인다. Render 재배포로 디스크가 비면
첫 실행에서 130영업일을 다시 받는다(옵션 체인이 커서 10~20분). 그 뒤로는 하루치만 받는다.
"""

from __future__ import annotations

import path_setup  # noqa: F401  # numbered folders on sys.path

import os
import threading
import time
from datetime import datetime
from zoneinfo import ZoneInfo

from scheduler_grace import past_startup_grace
from scheduler_slots import due_slot_id
from summary_scheduler import _load_state, update_scheduler_state

KST = ZoneInfo("Asia/Seoul")
POLL_SECONDS = 60
DEFAULT_HOUR_KST = 9
DEFAULT_MINUTE_KST = 10
DEFAULT_CATCHUP_MINUTES = 120


def _schedule_time_kst() -> tuple[int, int]:
    raw = os.environ.get("KRX_OPTION_BOARD_SCHEDULE_KST", "9:10").strip()
    try:
        h_s, m_s = raw.split(":", 1)
        hour, minute = int(h_s), int(m_s)
        if 0 <= hour <= 23 and 0 <= minute <= 59:
            return hour, minute
    except ValueError:
        pass
    return DEFAULT_HOUR_KST, DEFAULT_MINUTE_KST


def _catchup_minutes() -> int:
    raw = os.environ.get("KRX_OPTION_BOARD_CATCHUP_MINUTES", str(DEFAULT_CATCHUP_MINUTES)).strip()
    try:
        return max(15, int(raw))
    except ValueError:
        return DEFAULT_CATCHUP_MINUTES


def _enabled() -> bool:
    if not os.environ.get("KRX_AUTH_KEY", "").strip():
        return False
    raw = os.environ.get("KRX_OPTION_BOARD_SCHEDULE_ENABLED", "true").strip().lower()
    return raw not in {"0", "false", "no", "off"}


def _published_as_of() -> str:
    try:
        from krx_option_board import R2_LATEST_JSON
        from r2_data import get_json

        doc = get_json(R2_LATEST_JSON)
        return str((doc or {}).get("as_of") or "") if isinstance(doc, dict) else ""
    except Exception:
        return ""


def run_krx_option_board_job() -> bool:
    from krx_option_board import build_payload, publish_board

    update_scheduler_state(last_krx_option_board_attempt_at=datetime.now(KST).isoformat())
    try:
        # 새 영업일이 없으면 다시 올리지 않는다 (캐시 덕분에 build 는 빠르다)
        latest = build_payload()["as_of"]
        if latest and latest == _published_as_of():
            print(f"krx_option_board: as_of {latest} already published, skip")
            update_scheduler_state(last_krx_option_board_ok_at=datetime.now(KST).isoformat())
            return True
        result = publish_board(publish=True)
        print(f"Scheduled krx_option_board done: {result}")
        ok = bool((result.get("push") or {}).get("ok") or result.get("json"))
        if ok:
            update_scheduler_state(
                last_krx_option_board_ok_at=datetime.now(KST).isoformat(),
                last_krx_option_board_as_of=result.get("as_of"),
                last_krx_option_board_error=None,
            )
        return ok
    except Exception as exc:  # noqa: BLE001
        print(f"Scheduled krx_option_board failed: {exc}")
        update_scheduler_state(last_krx_option_board_error=str(exc)[:300])
        return False


def start_krx_option_board_scheduler() -> None:
    if not _enabled():
        print("krx_option_board scheduler disabled (KRX_AUTH_KEY 없음 또는 꺼짐).")
        return
    hour, minute = _schedule_time_kst()
    catchup = _catchup_minutes()

    def _loop() -> None:
        print(f"krx_option_board scheduler started (daily {hour:02d}:{minute:02d} KST, {catchup}m catch-up).")
        while True:
            try:
                now = datetime.now(KST)
                update_scheduler_state(krx_option_board_scheduler_heartbeat=now.isoformat())
                if past_startup_grace():
                    slot = due_slot_id(
                        now,
                        hour,
                        minute,
                        last_slot=_load_state().get("last_krx_option_board_slot"),
                        window_minutes=catchup,
                    )
                    if slot and run_krx_option_board_job():
                        update_scheduler_state(last_krx_option_board_slot=slot)
            except Exception as exc:  # noqa: BLE001
                print(f"krx_option_board scheduler loop error: {exc}")
            time.sleep(POLL_SECONDS)

    threading.Thread(target=_loop, name="krx-option-board-scheduler", daemon=True).start()
