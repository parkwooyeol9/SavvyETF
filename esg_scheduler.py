"""Scheduled /esg broadcasts → SavvyESG channel (TELEGRAM_CHAT_ID_ESG).

Default (KST):
  - 09:00  /esg events — ESG 시황 (중대재해·환경·거버넌스), daily
  - 09:30  /esg accident — 중대재해 screen (KRX trading days)

Opt-in (explicitly enable):
  - monitor (climate) / overview / aigov / aibrief
"""

from __future__ import annotations

import os
import threading
import time
from datetime import datetime
from zoneinfo import ZoneInfo

from scheduler_grace import past_startup_grace
from scheduler_slots import due_slot_id
from summary_scheduler import _load_state, update_scheduler_state

KST = ZoneInfo("Asia/Seoul")
DEFAULT_EVENTS_KST = (9, 0)
DEFAULT_MONITOR_KST = (9, 0)
DEFAULT_ACCIDENT_KST = (9, 30)
DEFAULT_OVERVIEW_KST = (9, 45)
DEFAULT_AIGOV_KST = (10, 0)
DEFAULT_AIBRIEF_KST = (10, 15)
DEFAULT_POLL_SECONDS = 30
DEFAULT_OVERVIEW_QUERIES = ("삼성전자",)


def _env_on(name: str, default: str = "false") -> bool:
    return os.environ.get(name, default).strip().lower() not in {
        "0",
        "false",
        "no",
        "off",
    }


def _parse_hhmm(raw: str, default: tuple[int, int]) -> tuple[int, int]:
    text = (raw or "").strip()
    try:
        hour_s, minute_s = text.split(":", 1)
        hour, minute = int(hour_s), int(minute_s)
        if 0 <= hour <= 23 and 0 <= minute <= 59:
            return hour, minute
    except ValueError:
        pass
    return default


def _events_time_kst() -> tuple[int, int]:
    return _parse_hhmm(
        os.environ.get("ESG_EVENTS_SCHEDULE_KST", "9:00"),
        DEFAULT_EVENTS_KST,
    )


def _monitor_time_kst() -> tuple[int, int]:
    return _parse_hhmm(
        os.environ.get("ESG_MONITOR_SCHEDULE_KST", "9:00"),
        DEFAULT_MONITOR_KST,
    )


def _accident_time_kst() -> tuple[int, int]:
    return _parse_hhmm(
        os.environ.get("ESG_ACCIDENT_SCHEDULE_KST", "9:30"),
        DEFAULT_ACCIDENT_KST,
    )


def _overview_time_kst() -> tuple[int, int]:
    return _parse_hhmm(
        os.environ.get("ESG_OVERVIEW_SCHEDULE_KST", "9:45"),
        DEFAULT_OVERVIEW_KST,
    )


def _aigov_time_kst() -> tuple[int, int]:
    return _parse_hhmm(
        os.environ.get("ESG_AIGOV_SCHEDULE_KST", "10:00"),
        DEFAULT_AIGOV_KST,
    )


def _aibrief_time_kst() -> tuple[int, int]:
    return _parse_hhmm(
        os.environ.get("ESG_AIBRIEF_SCHEDULE_KST", "10:15"),
        DEFAULT_AIBRIEF_KST,
    )


def _overview_queries() -> list[str]:
    raw = os.environ.get("ESG_SCHEDULE_OVERVIEW_QUERIES", "삼성전자").strip()
    names = [part.strip() for part in raw.split(",") if part.strip()]
    return names or list(DEFAULT_OVERVIEW_QUERIES)


def _poll_seconds() -> int:
    raw = os.environ.get("ESG_SCHEDULE_POLL_SECONDS", str(DEFAULT_POLL_SECONDS)).strip()
    try:
        return max(15, int(raw))
    except ValueError:
        return DEFAULT_POLL_SECONDS


def _should_skip_kr_non_trading(now_kst: datetime) -> bool:
    from kr_calendar import is_kr_equity_trading_day

    return not is_kr_equity_trading_day(now_kst.date())


def run_scheduled_esg_events(token: str, broadcast_fn) -> bool:
    from esg_event_monitor import run_esg_events
    from heavy_work import begin_heavy_work_blocking, end_heavy_work, heavy_work_status

    if not begin_heavy_work_blocking("scheduled-esg-events", timeout=240):
        print(
            "Scheduled esg events skipped: heavy work still busy "
            f"({heavy_work_status()})"
        )
        return False
    try:
        result = run_esg_events(publish=True)
        messages = result.get("telegram_messages") or []
        if not messages:
            print("Scheduled esg events skipped: empty messages.")
            return False
        delivered = broadcast_fn(token, messages)
        if not delivered:
            print("Scheduled esg events not delivered: 0 chats.")
            return False
        print(f"Scheduled esg events sent → {delivered} chat(s).")
        return True
    except Exception as exc:
        print(f"Scheduled esg events failed: {exc}")
        update_scheduler_state(last_esg_events_error=str(exc))
        return False
    finally:
        end_heavy_work("scheduled-esg-events")


def run_scheduled_esg_monitor(token: str, broadcast_fn) -> bool:
    from climate_pipeline import run_climate_monitor
    from heavy_work import begin_heavy_work_blocking, end_heavy_work, heavy_work_status

    if not begin_heavy_work_blocking("scheduled-esg-monitor", timeout=240):
        print(
            "Scheduled esg monitor skipped: heavy work still busy "
            f"({heavy_work_status()})"
        )
        return False
    try:
        result = run_climate_monitor(publish=True)
        messages = result.get("telegram_messages") or []
        if not messages:
            print("Scheduled esg monitor skipped: empty messages.")
            return False
        delivered = broadcast_fn(token, messages)
        if not delivered:
            print("Scheduled esg monitor not delivered: 0 chats.")
            return False
        print(f"Scheduled esg monitor sent → {delivered} chat(s).")
        return True
    except Exception as exc:
        print(f"Scheduled esg monitor failed: {exc}")
        update_scheduler_state(last_esg_monitor_error=str(exc))
        return False
    finally:
        end_heavy_work("scheduled-esg-monitor")


def run_scheduled_esg_accident(token: str, broadcast_fn) -> bool:
    from esg_pipeline import run_esg
    from heavy_work import begin_heavy_work_blocking, end_heavy_work, heavy_work_status

    if not begin_heavy_work_blocking("scheduled-esg-accident", timeout=180):
        print(
            "Scheduled esg accident skipped: heavy work still busy "
            f"({heavy_work_status()})"
        )
        return False
    try:
        # publish=True inside run_esg → Vercel dashboard slot esg_accident
        result = run_esg("accident", None)
        messages = result.get("telegram_messages") or []
        if not messages:
            print("Scheduled esg accident skipped: empty messages.")
            return False
        delivered = broadcast_fn(token, messages)
        if not delivered:
            print("Scheduled esg accident not delivered: 0 chats.")
            return False
        print(f"Scheduled esg accident sent → {delivered} chat(s).")
        return True
    except Exception as exc:
        print(f"Scheduled esg accident failed: {exc}")
        update_scheduler_state(last_esg_accident_error=str(exc))
        return False
    finally:
        end_heavy_work("scheduled-esg-accident")


def run_scheduled_esg_overview(token: str, broadcast_fn) -> bool:
    from esg_pipeline import run_esg
    from heavy_work import begin_heavy_work_blocking, end_heavy_work, heavy_work_status

    queries = _overview_queries()
    if not begin_heavy_work_blocking("scheduled-esg-overview", timeout=300):
        print(
            "Scheduled esg overview skipped: heavy work still busy "
            f"({heavy_work_status()})"
        )
        return False
    try:
        all_messages: list[dict] = []
        sections: list[dict] = []
        last_generated = None
        for query in queries:
            try:
                result = run_esg("overview", query, publish=False)
                msgs = result.get("telegram_messages") or []
                all_messages.extend(msgs)
                profile = result.get("profile") or {}
                last_generated = profile.get("generated_at") or last_generated
                for m in msgs:
                    if isinstance(m, dict) and m.get("text"):
                        sections.append(
                            {
                                "heading": f"/esg {query}",
                                "html_or_text": str(m["text"]),
                            }
                        )
            except Exception as exc:
                print(f"Scheduled esg overview failed for {query!r}: {exc}")
            time.sleep(0.4)
        if not all_messages:
            print("Scheduled esg overview skipped: empty messages.")
            return False
        try:
            from web_publish import publish_brief

            publish_brief(
                "esg",
                "esg_overview",
                title="ESG 시황 /esg overview",
                generated_at=last_generated,
                sections=sections,
                meta={"queries": queries},
            )
        except Exception as pub_exc:
            print(f"web_publish esg_overview skipped: {pub_exc}")
        delivered = broadcast_fn(token, all_messages)
        if not delivered:
            print("Scheduled esg overview not delivered: 0 chats.")
            return False
        print(
            f"Scheduled esg overview sent ({len(queries)} name(s), "
            f"{len(all_messages)} msg) → {delivered} chat(s)."
        )
        return True
    except Exception as exc:
        print(f"Scheduled esg overview failed: {exc}")
        update_scheduler_state(last_esg_overview_error=str(exc))
        return False
    finally:
        end_heavy_work("scheduled-esg-overview")


def run_scheduled_esg_aigov(token: str, broadcast_fn) -> bool:
    from esg_pipeline import run_esg
    from heavy_work import begin_heavy_work_blocking, end_heavy_work, heavy_work_status

    if not begin_heavy_work_blocking("scheduled-esg-aigov", timeout=180):
        print(
            "Scheduled esg aigov skipped: heavy work still busy "
            f"({heavy_work_status()})"
        )
        return False
    try:
        # publish → NEW slot esg_ai_gov only
        result = run_esg("aigov", None)
        messages = result.get("telegram_messages") or []
        if not messages:
            print("Scheduled esg aigov skipped: empty messages.")
            return False
        delivered = broadcast_fn(token, messages)
        if not delivered:
            print("Scheduled esg aigov not delivered: 0 chats.")
            return False
        print(f"Scheduled esg aigov sent → {delivered} chat(s).")
        return True
    except Exception as exc:
        print(f"Scheduled esg aigov failed: {exc}")
        update_scheduler_state(last_esg_aigov_error=str(exc))
        return False
    finally:
        end_heavy_work("scheduled-esg-aigov")


def run_scheduled_esg_aibrief(token: str, broadcast_fn) -> bool:
    from esg_pipeline import run_esg
    from heavy_work import begin_heavy_work_blocking, end_heavy_work, heavy_work_status

    if not begin_heavy_work_blocking("scheduled-esg-aibrief", timeout=300):
        print(
            "Scheduled esg aibrief skipped: heavy work still busy "
            f"({heavy_work_status()})"
        )
        return False
    try:
        # publish → NEW slot esg_ai_gov_brief only
        result = run_esg("aibrief", None)
        messages = result.get("telegram_messages") or []
        if not messages:
            print("Scheduled esg aibrief skipped: empty messages.")
            return False
        delivered = broadcast_fn(token, messages)
        if not delivered:
            print("Scheduled esg aibrief not delivered: 0 chats.")
            return False
        print(f"Scheduled esg aibrief sent → {delivered} chat(s).")
        return True
    except Exception as exc:
        print(f"Scheduled esg aibrief failed: {exc}")
        update_scheduler_state(last_esg_aibrief_error=str(exc))
        return False
    finally:
        end_heavy_work("scheduled-esg-aibrief")


def start_esg_scheduler(token: str, broadcast_fn) -> None:
    if os.environ.get("ESG_SCHEDULE_ENABLED", "true").lower() in {
        "0",
        "false",
        "no",
    }:
        print("esg scheduler disabled.")
        return

    events_h, events_m = _events_time_kst()
    monitor_h, monitor_m = _monitor_time_kst()
    accident_h, accident_m = _accident_time_kst()
    overview_h, overview_m = _overview_time_kst()
    aigov_h, aigov_m = _aigov_time_kst()
    aibrief_h, aibrief_m = _aibrief_time_kst()
    poll_seconds = _poll_seconds()
    catchup_minutes = 120
    try:
        catchup_minutes = max(
            30,
            int(os.environ.get("ESG_CATCHUP_MINUTES", "120")),
        )
    except ValueError:
        catchup_minutes = 120

    events_enabled = _env_on("ESG_EVENTS_SCHEDULE_ENABLED", "true")
    monitor_enabled = _env_on("ESG_MONITOR_SCHEDULE_ENABLED", "false")
    accident_enabled = _env_on("ESG_ACCIDENT_SCHEDULE_ENABLED", "true")
    overview_enabled = _env_on("ESG_OVERVIEW_SCHEDULE_ENABLED", "false")
    aigov_enabled = _env_on("ESG_AIGOV_SCHEDULE_ENABLED", "false")
    # Weekly Gemini brief — default OFF (opt-in)
    aibrief_enabled = _env_on("ESG_AIBRIEF_SCHEDULE_ENABLED", "false")

    def loop() -> None:
        state = _load_state()
        last_events = state.get("last_esg_events_slot")
        last_monitor = state.get("last_esg_monitor_slot")
        last_accident = state.get("last_esg_accident_slot")
        last_overview = state.get("last_esg_overview_slot")
        last_aigov = state.get("last_esg_aigov_slot")
        last_aibrief = state.get("last_esg_aibrief_slot")
        queries = ", ".join(_overview_queries())
        events_bit = (
            f"events {events_h:02d}:{events_m:02d} daily"
            if events_enabled
            else "events off"
        )
        monitor_bit = (
            f"climate {monitor_h:02d}:{monitor_m:02d} daily"
            if monitor_enabled
            else "climate off"
        )
        accident_bit = (
            f"KRX accident {accident_h:02d}:{accident_m:02d}"
            if accident_enabled
            else "accident off"
        )
        overview_bit = (
            f"overview {overview_h:02d}:{overview_m:02d} ({queries})"
            if overview_enabled
            else "overview off"
        )
        aigov_bit = (
            f"aigov {aigov_h:02d}:{aigov_m:02d}"
            if aigov_enabled
            else "aigov off"
        )
        aibrief_bit = (
            f"aibrief {aibrief_h:02d}:{aibrief_m:02d}"
            if aibrief_enabled
            else "aibrief off"
        )
        print(
            f"esg scheduler active — "
            f"{events_bit} · {monitor_bit} · {accident_bit} · "
            f"{overview_bit} · {aigov_bit} · {aibrief_bit} "
            f"→ TELEGRAM_CHAT_ID_ESG ({catchup_minutes}m catch-up)"
        )

        while True:
            try:
                if not past_startup_grace():
                    time.sleep(poll_seconds)
                    continue

                now = datetime.now(KST)
                update_scheduler_state(esg_scheduler_heartbeat=now.isoformat())

                if events_enabled:
                    events_slot = due_slot_id(
                        now,
                        events_h,
                        events_m,
                        last_slot=last_events,
                        window_minutes=catchup_minutes,
                    )
                    if events_slot:
                        if run_scheduled_esg_events(token, broadcast_fn):
                            last_events = events_slot
                            update_scheduler_state(last_esg_events_slot=events_slot)

                if monitor_enabled:
                    monitor_slot = due_slot_id(
                        now,
                        monitor_h,
                        monitor_m,
                        last_slot=last_monitor,
                        window_minutes=catchup_minutes,
                    )
                    if monitor_slot:
                        if run_scheduled_esg_monitor(token, broadcast_fn):
                            last_monitor = monitor_slot
                            update_scheduler_state(last_esg_monitor_slot=monitor_slot)

                if accident_enabled:
                    accident_slot = due_slot_id(
                        now,
                        accident_h,
                        accident_m,
                        last_slot=last_accident,
                        window_minutes=catchup_minutes,
                    )
                    if accident_slot:
                        if _should_skip_kr_non_trading(now):
                            print(
                                f"Scheduled esg accident skipped ({accident_slot}): "
                                "weekend or KRX holiday"
                            )
                            last_accident = accident_slot
                            update_scheduler_state(last_esg_accident_slot=accident_slot)
                        elif run_scheduled_esg_accident(token, broadcast_fn):
                            last_accident = accident_slot
                            update_scheduler_state(last_esg_accident_slot=accident_slot)

                if overview_enabled:
                    overview_slot = due_slot_id(
                        now,
                        overview_h,
                        overview_m,
                        last_slot=last_overview,
                        window_minutes=catchup_minutes,
                    )
                    if overview_slot:
                        if _should_skip_kr_non_trading(now):
                            print(
                                f"Scheduled esg overview skipped ({overview_slot}): "
                                "weekend or KRX holiday"
                            )
                            last_overview = overview_slot
                            update_scheduler_state(
                                last_esg_overview_slot=overview_slot
                            )
                        elif run_scheduled_esg_overview(token, broadcast_fn):
                            last_overview = overview_slot
                            update_scheduler_state(
                                last_esg_overview_slot=overview_slot
                            )

                if aigov_enabled:
                    aigov_slot = due_slot_id(
                        now,
                        aigov_h,
                        aigov_m,
                        last_slot=last_aigov,
                        window_minutes=catchup_minutes,
                    )
                    if aigov_slot:
                        if _should_skip_kr_non_trading(now):
                            print(
                                f"Scheduled esg aigov skipped ({aigov_slot}): "
                                "weekend or KRX holiday"
                            )
                            last_aigov = aigov_slot
                            update_scheduler_state(last_esg_aigov_slot=aigov_slot)
                        elif run_scheduled_esg_aigov(token, broadcast_fn):
                            last_aigov = aigov_slot
                            update_scheduler_state(last_esg_aigov_slot=aigov_slot)

                if aibrief_enabled:
                    aibrief_slot = due_slot_id(
                        now,
                        aibrief_h,
                        aibrief_m,
                        last_slot=last_aibrief,
                        window_minutes=catchup_minutes,
                    )
                    if aibrief_slot:
                        # Prefer Mon (weekday=0) when enabled; still allow catch-up same day.
                        if now.weekday() != 0:
                            print(
                                f"Scheduled esg aibrief skipped ({aibrief_slot}): "
                                "weekly Mon-only"
                            )
                            last_aibrief = aibrief_slot
                            update_scheduler_state(last_esg_aibrief_slot=aibrief_slot)
                        elif run_scheduled_esg_aibrief(token, broadcast_fn):
                            last_aibrief = aibrief_slot
                            update_scheduler_state(last_esg_aibrief_slot=aibrief_slot)
            except Exception as exc:
                print(f"esg scheduler loop error: {exc}")

            time.sleep(poll_seconds)

    thread = threading.Thread(target=loop, name="esg-scheduler", daemon=True)
    thread.start()
