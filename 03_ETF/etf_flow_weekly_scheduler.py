"""ETF Flow 주간 업데이트 스케줄러 — 기본 OFF (ETF_FLOW_WEEKLY_SCHEDULE_ENABLED=true 로 켬).

매주 화요일 07:40 KST(ETF_FLOW_WEEKLY_SCHEDULE_KST)에 `etf_flow_weekly` 를 돌려
R2 `etf_flow_weekly/latest.{json,xlsx}` 를 갱신한다. ETF CHECK 미국 일별 순유입은 약 2일
늦게 들어오므로(금 15시 KST 기준 최신이 수요일분) 화요일 아침이면 직전 월~금이 '이번주'가 되고,
국내도 같은 날짜 구간으로 합산한다.
ETF CHECK 호출을 1초 간격으로 순차 실행하므로 20~30분 걸린다 — heavy_work 락은 잡지 않는다.
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


def _schedule() -> tuple[int, int, int]:
    """(weekday, hour, minute) — weekday 0=월, 기본 1=화."""
    raw = os.environ.get("ETF_FLOW_WEEKLY_SCHEDULE_KST", "1 7:40").strip()
    try:
        wd_s, hm = raw.split(" ", 1)
        h_s, m_s = hm.split(":", 1)
        wd, h, m = int(wd_s), int(h_s), int(m_s)
        if 0 <= wd <= 6 and 0 <= h <= 23 and 0 <= m <= 59:
            return wd, h, m
    except ValueError:
        pass
    return 1, 7, 40


def run_etf_flow_weekly_job() -> bool:
    from etf_flow_weekly import publish_weekly

    try:
        result = publish_weekly()
        print(f"Scheduled etf_flow_weekly done: {result}")
        return bool(result.get("json"))
    except Exception as exc:  # noqa: BLE001
        print(f"Scheduled etf_flow_weekly failed: {exc}")
        update_scheduler_state(last_etf_flow_weekly_error=str(exc))
        return False


def start_etf_flow_weekly_scheduler() -> None:
    if os.environ.get("ETF_FLOW_WEEKLY_SCHEDULE_ENABLED", "false").lower() not in {"1", "true", "yes"}:
        print("etf_flow_weekly scheduler disabled.")
        return
    weekday, hour, minute = _schedule()

    def _loop() -> None:
        print(f"etf_flow_weekly scheduler started (weekday {weekday} {hour:02d}:{minute:02d} KST).")
        while True:
            try:
                now = datetime.now(KST)
                if past_startup_grace() and now.weekday() == weekday:
                    slot = due_slot_id(now, hour, minute,
                                       last_slot=_load_state().get("last_etf_flow_weekly_slot"),
                                       window_minutes=360)
                    if slot and run_etf_flow_weekly_job():
                        update_scheduler_state(last_etf_flow_weekly_slot=slot)
            except Exception as exc:  # noqa: BLE001
                print(f"etf_flow_weekly scheduler loop error: {exc}")
            time.sleep(POLL_SECONDS)

    threading.Thread(target=_loop, name="etf-flow-weekly-scheduler", daemon=True).start()
