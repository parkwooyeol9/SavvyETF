"""ETF Flow 일별 업데이트 스케줄러.

매일 03:40 KST(ETF_FLOW_WEEKLY_SCHEDULE_KST)에 `publish_weekly` 를 돌려
JSON·요청 양식 엑셀을 만들고 R2 `etf_flow_weekly/latest.{json,xlsx}` 를 갱신한다.
주(週) 창은 실행 요일과 무관한 롤링 5거래일이라, 하루 한 번이면 최신 영업일이 반영된다.

03:40 은 전날 Reddit(21:00, catch-up ~23:00) 과 당일 AI Pulse(05:10) 사이의 빈 구간이다.
ETF CHECK 를 쓰는 다른 작업(ETF 비중 08:20, /etfcheck 16:20)과도 겹치지 않는다.
호출은 1초 간격 순차라 20~30분 걸린다. catch-up 은 45분(04:25 종료)이라
늦게 떠도 AI Pulse 전에 끝난다. heavy_work 락은 잡지 않는다(네트워크 대기).
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
DEFAULT_HOUR_KST = 3
DEFAULT_MINUTE_KST = 40
DEFAULT_CATCHUP_MINUTES = 45


def _schedule_time_kst() -> tuple[int, int]:
    """Daily (hour, minute) KST. Legacy 'weekday HH:MM' falls back to 03:40."""
    raw = os.environ.get("ETF_FLOW_WEEKLY_SCHEDULE_KST", "3:40").strip()
    if " " in raw:
        print(
            f"etf_flow_weekly: ignoring legacy weekly spec {raw!r}; "
            f"using daily {DEFAULT_HOUR_KST:02d}:{DEFAULT_MINUTE_KST:02d} KST"
        )
        return DEFAULT_HOUR_KST, DEFAULT_MINUTE_KST
    try:
        h_s, m_s = raw.split(":", 1)
        hour, minute = int(h_s), int(m_s)
        if 0 <= hour <= 23 and 0 <= minute <= 59:
            return hour, minute
    except ValueError:
        pass
    return DEFAULT_HOUR_KST, DEFAULT_MINUTE_KST


def _catchup_minutes() -> int:
    raw = os.environ.get(
        "ETF_FLOW_WEEKLY_CATCHUP_MINUTES", str(DEFAULT_CATCHUP_MINUTES)
    ).strip()
    try:
        return max(15, int(raw))
    except ValueError:
        return DEFAULT_CATCHUP_MINUTES


def _enabled() -> bool:
    # Prefer ETF_FLOW_DAILY_SCHEDULE_ENABLED so a stale ETF_FLOW_WEEKLY_SCHEDULE_ENABLED=false
    # from the earlier opt-in weekly setup does not silently keep the daily 03:40 job off.
    raw = os.environ.get("ETF_FLOW_DAILY_SCHEDULE_ENABLED", "true").strip().lower()
    return raw not in {"0", "false", "no", "off"}


def _published_today() -> bool:
    try:
        from etf_flow_weekly import R2_LATEST_JSON
        from r2_data import get_json

        doc = get_json(R2_LATEST_JSON)
        gen = str((doc or {}).get("generated_at") or "")[:10] if isinstance(doc, dict) else ""
        return gen == datetime.now(KST).date().isoformat()
    except Exception:
        return False


def run_etf_flow_weekly_job() -> bool:
    from etf_flow_weekly import publish_weekly

    update_scheduler_state(last_etf_flow_weekly_attempt_at=datetime.now(KST).isoformat())
    try:
        result = publish_weekly(publish=True)
        print(f"Scheduled etf_flow_weekly done: {result}")
        pushed = result.get("push") or {}
        ok = bool(pushed.get("ok") or result.get("json"))
        if ok:
            update_scheduler_state(
                last_etf_flow_weekly_ok_at=datetime.now(KST).isoformat(),
                last_etf_flow_weekly_error=None,
            )
        return ok
    except Exception as exc:  # noqa: BLE001
        print(f"Scheduled etf_flow_weekly failed: {exc}")
        update_scheduler_state(last_etf_flow_weekly_error=str(exc)[:300])
        return False


def start_etf_flow_weekly_scheduler() -> None:
    if not _enabled():
        print("etf_flow_weekly scheduler disabled.")
        return
    hour, minute = _schedule_time_kst()
    catchup = _catchup_minutes()

    def _loop() -> None:
        bootstrapped = False
        print(
            f"etf_flow_weekly scheduler started "
            f"(daily {hour:02d}:{minute:02d} KST, {catchup}m catch-up, json+xlsx)."
        )
        while True:
            try:
                now = datetime.now(KST)
                update_scheduler_state(
                    etf_flow_weekly_scheduler_heartbeat=now.isoformat()
                )
                if past_startup_grace():
                    if not bootstrapped:
                        bootstrapped = True
                        if not _published_today():
                            print("etf_flow_weekly bootstrap: R2 latest JSON is not today's, refreshing…")
                            if run_etf_flow_weekly_job():
                                update_scheduler_state(
                                    last_etf_flow_weekly_slot=f"bootstrap-{now.strftime('%Y%m%d')}"
                                )
                    slot = due_slot_id(
                        now,
                        hour,
                        minute,
                        last_slot=_load_state().get("last_etf_flow_weekly_slot"),
                        window_minutes=catchup,
                    )
                    if slot and run_etf_flow_weekly_job():
                        update_scheduler_state(last_etf_flow_weekly_slot=slot)
            except Exception as exc:  # noqa: BLE001
                print(f"etf_flow_weekly scheduler loop error: {exc}")
            time.sleep(POLL_SECONDS)

    threading.Thread(target=_loop, name="etf-flow-weekly-scheduler", daemon=True).start()
