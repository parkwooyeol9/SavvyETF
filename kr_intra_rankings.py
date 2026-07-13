"""KOSPI/KOSDAQ intraday rankings (/kospi_intra, /kosdaq_intra).

How intraday return is computed (same engine as /summary_kor_intra):
  1. Yahoo chart API daily bars (.KS / .KQ), ``range=2mo``, ``interval=1d``.
  2. ``intraday_return = (last_close - prev_close) / prev_close``
     - ``last_close``  = latest daily bar (during KRX session this is today's
       partial bar / current price)
     - ``prev_close``  = previous trading day's close
  3. ``vol_ratio = today_volume / 21-day average volume`` (same as /kospi).
  4. Surge / drop scores = |return| × vol_ratio (sign kept for surge board).

Unlike /kospi, intraday commands always ``force=True`` refresh so results are
not stuck on an earlier same-day disk cache.
"""

from __future__ import annotations

from datetime import datetime, time
from zoneinfo import ZoneInfo

from stock_crawler import (
    DEFAULT_BOTTOM_N,
    DEFAULT_TOP_N,
    KST,
    RANK_MODES,
    UNIVERSES,
    _format_ticker_display,
    _ranking_slice,
    _states,
    get_ranking_tickers,
    get_top_leader_ticker,
    is_cache_ready,
    is_cache_warmup_running,
    warmup_cache,
)

KR_INTRA_UNIVERSES = frozenset({"kospi", "kosdaq"})

KR_INTRA_COMMANDS = {
    "/kospi_intra": "kospi",
    "/kosdaq_intra": "kosdaq",
}

KRX_OPEN = time(9, 0)
KRX_CLOSE = time(15, 30)


def krx_session_status(now: datetime | None = None) -> str:
    """Human-readable KRX regular-session hint (weekday 09:00–15:30 KST)."""
    now = now or datetime.now(KST)
    if now.weekday() >= 5:
        return "주말 — 전일·당일 Yahoo 일봉 기준"
    t = now.time()
    if t < KRX_OPEN:
        return "장 시작 전 — 전일 종가 대비는 전 거래일 대비일 수 있음"
    if t <= KRX_CLOSE:
        return "정규장 — Yahoo 일봉 최신 봉(장중) vs 전일 종가"
    return "장 마감 후 — 당일 종가 vs 전일 종가"


def parse_kr_intraday_command(message: str) -> tuple[str, str]:
    parts = message.strip().split()
    if not parts:
        raise ValueError("Empty command.")
    command = parts[0].lower()
    universe = None
    for prefix, key in KR_INTRA_COMMANDS.items():
        if command.startswith(prefix):
            universe = key
            break
    if universe is None:
        raise ValueError("Use /kospi_intra or /kosdaq_intra.")

    mode = "all"
    if len(parts) > 1:
        candidate = parts[1].lower()
        if candidate in RANK_MODES:
            mode = candidate
        elif candidate != "all":
            raise ValueError(f"Unknown mode '{parts[1]}'. Use surge or dropvol.")
    return universe, mode


def refresh_kr_intraday_cache(universe: str) -> None:
    """Force Yahoo refresh for one KR universe."""
    if universe not in KR_INTRA_UNIVERSES:
        raise ValueError(f"Intraday rankings only for kospi/kosdaq, not {universe!r}")
    warmup_cache(universe, force=True)
    if not is_cache_ready(universe):
        label = UNIVERSES[universe]["label"]
        if is_cache_warmup_running(universe):
            raise RuntimeError(f"{label} 장중 캐시 구축 중입니다. 잠시 후 다시 시도하세요.")
        raise RuntimeError(f"{label} 장중 캐시를 만들지 못했습니다. 잠시 후 다시 시도하세요.")


def format_kr_intraday_rankings_message(
    universe: str,
    mode: str = "all",
    top_n: int = DEFAULT_TOP_N,
    bottom_n: int = DEFAULT_BOTTOM_N,
) -> str:
    label_name = UNIVERSES[universe]["label"]
    if not is_cache_ready(universe):
        return f"{label_name} 장중 랭킹 — 데이터 로딩 중입니다. 잠시 후 다시 시도하세요."

    modes = ["surge", "dropvol"] if mode == "all" else [mode]
    meta = _states[universe]["meta"]
    loaded_at = datetime.fromtimestamp(meta["loaded_at"], KST).strftime("%Y-%m-%d %H:%M KST")
    session = krx_session_status()

    lines = [
        f"🇰🇷 {label_name} 장중 랭킹",
        "장중 수익률 = (Yahoo 일봉 최신 종가 − 전일 종가) / 전일 종가",
        "거래량 = 당일 누적 / 21일 평균",
        f"상태: {session}",
        f"Active: {len(_states[universe]['df'])} | Scanned: {meta.get('scanned', '?')} | Skipped: {meta.get('skipped', '?')}",
        f"Data as of: {loaded_at}",
        "",
    ]

    for rank_mode in modes:
        use_bottom = 0 if mode == "all" else bottom_n
        board = _ranking_slice(universe, rank_mode, top_n, use_bottom)
        if not board["top"] and not board["bottom"]:
            lines.append(f"{board['title']}: no data")
            lines.append("")
            continue
        lines.append(board["title"])
        lines.append(f"({board['label']})")
        lines.append("")
        if top_n > 0 and board["top"]:
            lines.append(f"Top {top_n}:")
            for idx, (ticker, value) in enumerate(board["top"], start=1):
                lines.append(f"{idx}. {_format_ticker_display(ticker, universe)}  {value}")
            lines.append("")
        if use_bottom > 0 and board["bottom"]:
            lines.append(f"Bottom {use_bottom}:")
            for idx, (ticker, value) in enumerate(board["bottom"], start=1):
                lines.append(f"{idx}. {_format_ticker_display(ticker, universe)}  {value}")
            lines.append("")

    if lines and lines[-1] == "":
        lines.pop()

    message = "\n".join(lines)
    if len(message) > 4000:
        message = message[:3990] + "\n...(truncated)"
    return message


def run_kr_intraday_rankings(
    universe: str,
    mode: str = "all",
    *,
    top_n: int = DEFAULT_TOP_N,
    bottom_n: int = DEFAULT_BOTTOM_N,
) -> dict:
    """Refresh cache and return telegram-ready payload."""
    refresh_kr_intraday_cache(universe)
    tickers, context_label = get_ranking_tickers(
        universe=universe,
        mode=mode,
        top_n=top_n,
        bottom_n=bottom_n,
    )
    text = format_kr_intraday_rankings_message(
        universe, mode=mode, top_n=top_n, bottom_n=bottom_n
    )
    leader = get_top_leader_ticker(universe, "dropvol" if mode == "dropvol" else "surge")
    return {
        "universe": universe,
        "mode": mode,
        "text": text,
        "tickers": tickers,
        "context_label": context_label.replace("rankings", "intraday rankings"),
        "leader_ticker": leader,
    }
