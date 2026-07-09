"""Detect when ETF CHECK daily turnover ranks look post-close ready."""

from __future__ import annotations

import os
from datetime import date, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo

KST = ZoneInfo("Asia/Seoul")
BASE_URL = "https://www.etfcheck.co.kr"
KRX_CLOSE_TIME = time(15, 30)
DEFAULT_BUFFER_MINUTES = 10
DEFAULT_MAX_WAIT_MINUTES = 45
DEFAULT_STABLE_POLLS = 2
VOLUME_API = f"{BASE_URL}/user/etp/getEtpRankListVolume"
VOLUME_PARAMS = {
    "type": "ETF",
    "annuityCode": "A",
    "ctgLargeCode": "A",
    "order": "D",
    "orderCol": "P",
    "invCode": "",
    "leverage": "",
    "inverse": "",
    "coveredCall": "",
    "orderBy": "DESC",
    "limit": 20,
}


def post_close_buffer_minutes() -> int:
    raw = os.environ.get("ETFCHECK_POST_CLOSE_BUFFER_MINUTES", str(DEFAULT_BUFFER_MINUTES)).strip()
    try:
        return max(0, int(raw))
    except ValueError:
        return DEFAULT_BUFFER_MINUTES


def post_close_max_wait_minutes() -> int:
    raw = os.environ.get("ETFCHECK_POST_CLOSE_MAX_WAIT_MINUTES", str(DEFAULT_MAX_WAIT_MINUTES)).strip()
    try:
        return max(post_close_buffer_minutes() + 1, int(raw))
    except ValueError:
        return DEFAULT_MAX_WAIT_MINUTES


def stable_polls_required() -> int:
    raw = os.environ.get("ETFCHECK_STABLE_POLLS", str(DEFAULT_STABLE_POLLS)).strip()
    try:
        return max(1, int(raw))
    except ValueError:
        return DEFAULT_STABLE_POLLS


def _previous_weekday(d: date) -> date:
    prev = d - timedelta(days=1)
    while prev.weekday() >= 5:
        prev -= timedelta(days=1)
    return prev


def expected_krx_session_date(now_kst: datetime | None = None) -> date | None:
    now_kst = now_kst or datetime.now(KST)
    today = now_kst.date()
    if today.weekday() >= 5:
        return _previous_weekday(today)
    close_dt = datetime.combine(today, KRX_CLOSE_TIME, tzinfo=KST)
    if now_kst < close_dt:
        return _previous_weekday(today)
    return today


def is_after_krx_close(now_kst: datetime | None = None) -> bool:
    now_kst = now_kst or datetime.now(KST)
    today = now_kst.date()
    if today.weekday() >= 5:
        return True
    close_dt = datetime.combine(today, KRX_CLOSE_TIME, tzinfo=KST)
    return now_kst >= close_dt


def earliest_capture_time_kst(session_date: date, buffer_minutes: int | None = None) -> datetime:
    buffer = post_close_buffer_minutes() if buffer_minutes is None else buffer_minutes
    close_kst = datetime.combine(session_date, KRX_CLOSE_TIME, tzinfo=KST)
    return close_kst + timedelta(minutes=buffer)


def latest_capture_time_kst(session_date: date, max_wait_minutes: int | None = None) -> datetime:
    wait = post_close_max_wait_minutes() if max_wait_minutes is None else max_wait_minutes
    close_kst = datetime.combine(session_date, KRX_CLOSE_TIME, tzinfo=KST)
    return close_kst + timedelta(minutes=wait)


def fetch_turnover_rank_snapshot() -> dict[str, Any]:
    from playwright.sync_api import sync_playwright

    from etfcheck_capture import MOBILE_UA, VOLUME_URL, _viewport

    captured: dict[str, Any] = {}

    def on_response(response) -> None:
        if "getEtpRankListVolume" in response.url and "orderCol=P" in response.url:
            try:
                payload = response.json()
            except Exception:
                return
            if payload.get("success"):
                captured["results"] = payload.get("results") or []

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(
            viewport=_viewport(),
            user_agent=MOBILE_UA,
            locale="ko-KR",
            timezone_id="Asia/Seoul",
        )
        page = context.new_page()
        page.on("response", on_response)
        try:
            page.goto(VOLUME_URL, wait_until="domcontentloaded", timeout=45000)
            page.get_by_role("button", name="거래대금").click(timeout=5000)
            page.wait_for_timeout(2500)
        finally:
            context.close()
            browser.close()

    rows = captured.get("results") or []
    if not rows:
        raise RuntimeError("ETF CHECK turnover rank API returned no rows")

    top = rows[0]
    top5_sum = sum(int(row.get("RANK_VALUE") or 0) for row in rows[:5])
    return {
        "top_symbol": str(top.get("F16013", "")),
        "top_name": str(top.get("F16002", "")),
        "top_turnover": int(top.get("RANK_VALUE") or 0),
        "top5_turnover_sum": top5_sum,
        "row_count": len(rows),
    }


def turnover_fingerprint(snapshot: dict[str, Any]) -> str:
    return (
        f"{snapshot.get('top_symbol')}|"
        f"{snapshot.get('top_turnover')}|"
        f"{snapshot.get('top5_turnover_sum')}"
    )


def is_etfcheck_turnover_ready(
    now_kst: datetime | None = None,
    *,
    stable_hits: int = 0,
    last_fingerprint: str | None = None,
) -> tuple[bool, str, str | None, int]:
    """
    Return (ready, detail, fingerprint, updated_stable_hits).

    Strategy:
    - KRX regular close is 15:30 KST.
    - ETF CHECK 당일 거래대금 is not reliable exactly at 15:30; we wait for a buffer
      (default 10m → 15:40) then require stable top-rank turnover across polls.
    - Force capture after max wait (default 45m → 16:15) once buffer elapsed.
    """
    now_kst = now_kst or datetime.now(KST)
    if not is_after_krx_close(now_kst):
        return False, "before KRX close (15:30 KST)", None, 0

    session_date = expected_krx_session_date(now_kst)
    if session_date is None:
        return False, "no expected KRX session date", None, 0

    earliest = earliest_capture_time_kst(session_date)
    latest = latest_capture_time_kst(session_date)
    if now_kst < earliest:
        return (
            False,
            f"waiting until {earliest.strftime('%H:%M KST')} (post-close buffer)",
            None,
            0,
        )

    try:
        snapshot = fetch_turnover_rank_snapshot()
    except Exception as exc:
        return False, f"snapshot failed: {exc}", None, 0

    fingerprint = turnover_fingerprint(snapshot)
    top_turnover = int(snapshot.get("top_turnover") or 0)
    if top_turnover <= 0:
        return False, "top turnover is zero", fingerprint, 0

    if fingerprint == last_fingerprint:
        stable_hits += 1
    else:
        stable_hits = 1

    needed = stable_polls_required()
    if stable_hits >= needed:
        return (
            True,
            (
                f"turnover ranks stable ({needed} polls) — "
                f"top {snapshot.get('top_symbol')} "
                f"{top_turnover / 1_000_000_000_000:.2f}T KRW"
            ),
            fingerprint,
            stable_hits,
        )

    if now_kst >= latest:
        return (
            True,
            f"max wait reached ({latest.strftime('%H:%M KST')}) — sending latest snapshot",
            fingerprint,
            stable_hits,
        )

    return (
        False,
        (
            f"waiting for stable turnover ranks ({stable_hits}/{needed}) — "
            f"top5 sum {int(snapshot.get('top5_turnover_sum', 0)) / 1e12:.2f}T"
        ),
        fingerprint,
        stable_hits,
    )
