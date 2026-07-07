import contextlib
import logging
import os
import pickle
import sys
import threading
import time
import warnings
from collections.abc import Callable
from io import StringIO
from pathlib import Path

import pandas as pd
import requests
import yfinance as yf

PROJECT_DIR = Path(__file__).resolve().parent
DATA_DIR = PROJECT_DIR / "data"
ETF_MASTER_PATH = PROJECT_DIR / "colab" / "ETF_Master.xlsx"
CACHE_VERSION = 5

DAILY_RETURN_COL = "Daily Return"
VOL_RATIO_COL = "Vol Ratio"
SURGE_SCORE_COL = "Surge Score"
DROP_VOL_SCORE_COL = "Drop Vol Score"

RANK_MODES = {
    "surge": {
        "column": SURGE_SCORE_COL,
        "label": "price up + volume surge (daily return x vol ratio)",
    },
    "dropvol": {
        "column": DROP_VOL_SCORE_COL,
        "label": "price down + volume surge (|daily return| x vol ratio)",
    },
}

VOL_LOOKBACK_DAYS = 21

CACHE_TTL_SECONDS = 3600
DEFAULT_TOP_N = 3
DEFAULT_BOTTOM_N = 3
WIKI_USER_AGENT = "SavvyETF/1.0 (telegram-bot)"

UNIVERSES: dict[str, dict] = {
    "etf": {
        "label": "US Equity ETF",
        "cache_file": DATA_DIR / "etf_cache.pkl",
        "chunk_size": 25,
    },
    "sp": {
        "label": "S&P 500",
        "cache_file": DATA_DIR / "sp_cache.pkl",
        "chunk_size": 50,
    },
    "nas": {
        "label": "NASDAQ 100",
        "cache_file": DATA_DIR / "nas_cache.pkl",
        "chunk_size": 50,
    },
}

RANK_COMMANDS = {
    "/etf": "etf",
    "/sp": "sp",
    "/nas": "nas",
}

_states: dict[str, dict] = {
    key: {"df": None, "meta": {"scanned": 0, "skipped": 0, "loaded_at": 0.0}, "ready": False}
    for key in UNIVERSES
}
_warmup_lock = threading.Lock()
_warmup_running: set[str] = set()

for _logger_name in ("yfinance", "peewee"):
    logging.getLogger(_logger_name).setLevel(logging.ERROR)
warnings.filterwarnings("ignore", category=FutureWarning)


@contextlib.contextmanager
def _quiet_yfinance():
    with open(os.devnull, "w", encoding="utf-8") as devnull:
        old_stderr = sys.stderr
        sys.stderr = devnull
        try:
            yield
        finally:
            sys.stderr = old_stderr


def _clean_symbols(values: pd.Series) -> list[str]:
    return (
        values.dropna()
        .astype(str)
        .str.strip()
        .str.upper()
        .str.replace(".", "-", regex=False)
        .tolist()
    )


def _fetch_wikipedia_html(url: str) -> str:
    response = requests.get(url, headers={"User-Agent": WIKI_USER_AGENT}, timeout=30)
    response.raise_for_status()
    return response.text


def load_etf_tickers(excel_path: Path | None = None) -> list[str]:
    path = excel_path or ETF_MASTER_PATH
    if not path.exists():
        raise FileNotFoundError(f"ETF master file not found: {path}")

    df = pd.read_excel(path)
    tickers = df.iloc[:, 0].dropna().astype(str).str.strip().str.upper().tolist()
    cleaned = []
    for ticker in tickers:
        if not ticker or ticker.startswith("@") or ticker.startswith("U:"):
            continue
        cleaned.append(ticker.replace(" ", ""))
    return cleaned


def load_sp500_tickers() -> list[str]:
    html = _fetch_wikipedia_html("https://en.wikipedia.org/wiki/List_of_S%26P_500_companies")
    table = pd.read_html(StringIO(html))[0]
    return _clean_symbols(table["Symbol"])


def load_nasdaq100_tickers() -> list[str]:
    html = _fetch_wikipedia_html("https://en.wikipedia.org/wiki/Nasdaq-100")
    for table in pd.read_html(StringIO(html)):
        if "Ticker" in table.columns and 95 <= len(table) <= 105:
            return _clean_symbols(table["Ticker"])
    raise RuntimeError("Could not parse NASDAQ-100 tickers from Wikipedia")


def _load_universe_tickers(universe: str) -> list[str]:
    if universe == "etf":
        return load_etf_tickers()
    if universe == "sp":
        return load_sp500_tickers()
    if universe == "nas":
        return load_nasdaq100_tickers()
    raise ValueError(f"Unknown universe: {universe}")


def is_cache_ready(universe: str = "etf") -> bool:
    state = _states[universe]
    df = state["df"]
    return state["ready"] and df is not None and not df.empty


def is_etf_cache_ready() -> bool:
    return is_cache_ready("etf")


def _metrics_from_series(close: pd.Series, volume: pd.Series | None) -> dict[str, float]:
    prices = close.dropna()
    if len(prices) < 2:
        return {}

    last = float(prices.iloc[-1])
    prev = float(prices.iloc[-2])
    if last <= 0 or prev <= 0:
        return {}

    daily_return = (last - prev) / prev
    metrics: dict[str, float] = {DAILY_RETURN_COL: daily_return}

    if volume is None:
        return metrics

    vol = volume.dropna()
    if len(vol) < VOL_LOOKBACK_DAYS:
        return metrics

    month_avg = float(vol.iloc[-VOL_LOOKBACK_DAYS:].mean())
    last_vol = float(vol.iloc[-1])
    if month_avg <= 0 or last_vol <= 0:
        return metrics

    vol_ratio = last_vol / month_avg
    metrics[VOL_RATIO_COL] = vol_ratio

    if daily_return > 0:
        metrics[SURGE_SCORE_COL] = daily_return * vol_ratio
    elif daily_return < 0:
        metrics[DROP_VOL_SCORE_COL] = abs(daily_return) * vol_ratio

    return metrics


def _extract_ticker_series(data: pd.DataFrame, ticker: str, field: str) -> pd.Series | None:
    if data.empty:
        return None

    if isinstance(data.columns, pd.MultiIndex):
        if ticker not in data.columns.get_level_values(0):
            return None
        try:
            return data[ticker][field]
        except (KeyError, TypeError):
            return None

    if field in data.columns:
        return data[field]
    return None


def _chunk_all_metrics(tickers: list[str]) -> dict[str, dict[str, float]]:
    if not tickers:
        return {}

    download_arg = tickers[0] if len(tickers) == 1 else tickers
    with _quiet_yfinance():
        try:
            data = yf.download(
                download_arg,
                period="1y",
                group_by="ticker",
                auto_adjust=True,
                progress=False,
                threads=True,
                ignore_tz=True,
            )
        except Exception:
            return {}

    results: dict[str, dict[str, float]] = {}
    target_tickers = tickers if len(tickers) > 1 else [tickers[0]]

    for ticker in target_tickers:
        close = _extract_ticker_series(data, ticker, "Close")
        if close is None:
            continue
        volume = _extract_ticker_series(data, ticker, "Volume")
        metrics = _metrics_from_series(close, volume)
        if metrics:
            results[ticker] = metrics

    return results


def build_metrics_table(
    tickers: list[str],
    chunk_size: int = 25,
    pause_seconds: float = 0.35,
    on_progress: Callable[[int, int, int], None] | None = None,
) -> tuple[pd.DataFrame, int, int]:
    scanned = len(tickers)
    ticker_values: dict[str, dict[str, float]] = {}
    total_chunks = (len(tickers) + chunk_size - 1) // chunk_size if tickers else 0

    for index, start in enumerate(range(0, len(tickers), chunk_size), start=1):
        chunk = tickers[start : start + chunk_size]
        ticker_values.update(_chunk_all_metrics(chunk))
        if on_progress:
            on_progress(index, total_chunks, len(ticker_values))
        if pause_seconds:
            time.sleep(pause_seconds)

    rows = [{"Ticker": ticker, **values} for ticker, values in sorted(ticker_values.items())]
    df = pd.DataFrame(rows)
    skipped = scanned - len(df)
    return df, scanned, skipped


def build_etf_return_table(
    tickers: list[str] | None = None,
    chunk_size: int = 25,
    pause_seconds: float = 0.35,
    on_progress: Callable[[int, int, int], None] | None = None,
) -> tuple[pd.DataFrame, int, int]:
    tickers = tickers or load_etf_tickers()
    return build_metrics_table(tickers, chunk_size, pause_seconds, on_progress)


def _save_disk_cache(universe: str, df: pd.DataFrame, scanned: int, skipped: int) -> None:
    cache_file = UNIVERSES[universe]["cache_file"]
    cache_file.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "version": CACHE_VERSION,
        "loaded_at": time.time(),
        "scanned": scanned,
        "skipped": skipped,
        "dataframe": df,
    }
    with cache_file.open("wb") as handle:
        pickle.dump(payload, handle)


def _load_disk_cache(universe: str, max_age: int = CACHE_TTL_SECONDS) -> bool:
    cache_file = UNIVERSES[universe]["cache_file"]
    state = _states[universe]

    if not cache_file.exists():
        return False

    try:
        with cache_file.open("rb") as handle:
            payload = pickle.load(handle)
    except Exception:
        return False

    if payload.get("version") != CACHE_VERSION:
        return False

    loaded_at = float(payload.get("loaded_at", 0))
    if time.time() - loaded_at > max_age:
        return False

    df = payload.get("dataframe")
    if df is None or df.empty:
        return False

    state["df"] = df
    state["meta"] = {
        "scanned": int(payload.get("scanned", len(df))),
        "skipped": int(payload.get("skipped", 0)),
        "loaded_at": loaded_at,
    }
    state["ready"] = True
    return True


def _set_memory_cache(universe: str, df: pd.DataFrame, scanned: int, skipped: int) -> None:
    state = _states[universe]
    state["df"] = df
    state["meta"] = {
        "scanned": scanned,
        "skipped": skipped,
        "loaded_at": time.time(),
    }
    state["ready"] = True
    _save_disk_cache(universe, df, scanned, skipped)


def warmup_cache(universe: str = "etf", force: bool = False) -> None:
    if universe not in UNIVERSES:
        raise ValueError(f"Unknown universe: {universe}")

    if not force and is_cache_ready(universe):
        return

    with _warmup_lock:
        if not force and is_cache_ready(universe):
            return
        if universe in _warmup_running:
            while universe in _warmup_running:
                time.sleep(0.5)
            return
        _warmup_running.add(universe)

    label = UNIVERSES[universe]["label"]
    try:
        if not force and _load_disk_cache(universe):
            age_min = int((time.time() - _states[universe]["meta"]["loaded_at"]) // 60)
            count = len(_states[universe]["df"])
            print(f"{label} cache loaded from disk ({count} tickers, {age_min}m old).")
            return

        print(f"Preloading {label} rankings...")
        tickers = _load_universe_tickers(universe)
        chunk_size = UNIVERSES[universe]["chunk_size"]

        def progress(done: int, total: int, active: int) -> None:
            print(f"  {label}: chunk {done}/{total} | active tickers: {active}")

        df, scanned, skipped = build_metrics_table(
            tickers,
            chunk_size=chunk_size,
            on_progress=progress,
        )
        _set_memory_cache(universe, df, scanned, skipped)
        print(f"{label} preload complete: {len(df)} active / {scanned} scanned / {skipped} skipped.")
    finally:
        _warmup_running.discard(universe)


def warmup_etf_cache(force: bool = False) -> None:
    warmup_cache("etf", force=force)


def warmup_all_caches(force: bool = False) -> None:
    for universe in UNIVERSES:
        warmup_cache(universe, force=force)


def start_etf_cache_warmup(blocking: bool = False, force: bool = False) -> None:
    if blocking:
        warmup_etf_cache(force=force)
        return

    thread = threading.Thread(
        target=warmup_etf_cache,
        kwargs={"force": force},
        name="etf-cache-warmup",
        daemon=True,
    )
    thread.start()


def _format_price(value: float) -> str:
    return f"{value * 100:+.2f}%"


def _format_volume_ratio(value: float) -> str:
    return f"{value:.2f}x"


def _format_score(value: float) -> str:
    return f"{value:.4f}"


def _row_label(row: pd.Series) -> str:
    daily = row.get(DAILY_RETURN_COL)
    vol = row.get(VOL_RATIO_COL)
    parts = []
    if pd.notna(daily):
        parts.append(_format_price(float(daily)))
    if pd.notna(vol):
        parts.append(f"vol {_format_volume_ratio(float(vol))}")
    return " | ".join(parts) if parts else "n/a"


def get_mode_rankings(
    universe: str,
    mode: str,
) -> tuple[pd.DataFrame, str, int, int]:
    if mode not in RANK_MODES:
        raise ValueError(f"Unsupported mode: {mode}. Use: {list(RANK_MODES)}")
    if not is_cache_ready(universe):
        raise RuntimeError(f"{UNIVERSES[universe]['label']} cache is not ready yet.")

    column = RANK_MODES[mode]["column"]
    label = RANK_MODES[mode]["label"]
    df = _states[universe]["df"].dropna(subset=[column]).sort_values(by=column, ascending=False)
    meta = _states[universe]["meta"]
    return df, label, meta["scanned"], meta["skipped"]


def _ranking_slice(
    universe: str,
    mode: str,
    top_n: int = DEFAULT_TOP_N,
    bottom_n: int = DEFAULT_BOTTOM_N,
) -> dict:
    df, label, scanned, skipped = get_mode_rankings(universe, mode)
    top_rows = [(row["Ticker"], _row_label(row)) for _, row in df.head(top_n).iterrows()]
    bottom_df = df.sort_values(by=RANK_MODES[mode]["column"], ascending=True).head(bottom_n)
    bottom_rows = [(row["Ticker"], _row_label(row)) for _, row in bottom_df.iterrows()]
    return {
        "mode": mode,
        "title": "Price up + volume surge" if mode == "surge" else "Price down + volume surge",
        "label": label,
        "top": top_rows,
        "bottom": bottom_rows,
        "scanned": scanned,
        "skipped": skipped,
    }


def get_top_leader_ticker(universe: str, mode: str = "all") -> str | None:
    """Return the #1 ticker for charting (surge leader unless mode is dropvol)."""
    rank_mode = "dropvol" if mode == "dropvol" else "surge"
    board = _ranking_slice(universe, rank_mode, 1, 0)
    if board["top"]:
        return board["top"][0][0]
    return None


def get_ranking_tickers(
    universe: str = "etf",
    mode: str = "all",
    top_n: int = DEFAULT_TOP_N,
    bottom_n: int = DEFAULT_BOTTOM_N,
) -> tuple[list[str], str]:
    tickers: list[str] = []

    if mode == "all":
        for rank_mode in ("surge", "dropvol"):
            board = _ranking_slice(universe, rank_mode, top_n, 0)
            for ticker, _ in board["top"]:
                if ticker not in tickers:
                    tickers.append(ticker)
        context = f"{UNIVERSES[universe]['label']} — surge + drop/vol leaders"
        return tickers, context

    board = _ranking_slice(universe, mode, top_n, bottom_n)
    for group in (board["top"], board["bottom"]):
        for ticker, _ in group:
            if ticker not in tickers:
                tickers.append(ticker)
    context = f"{UNIVERSES[universe]['label']} — {RANK_MODES[mode]['label']}"
    return tickers, context


def _append_ranking_block(lines: list[str], board: dict, top_n: int, bottom_n: int) -> None:
    lines.append(board["title"])
    lines.append(f"({board['label']})")
    lines.append("")

    if top_n > 0 and board["top"]:
        lines.append(f"Top {top_n}:")
        for idx, (ticker, value) in enumerate(board["top"], start=1):
            lines.append(f"{idx}. {ticker}  {value}")
        lines.append("")

    if bottom_n > 0 and board["bottom"]:
        lines.append(f"Bottom {bottom_n}:")
        for idx, (ticker, value) in enumerate(board["bottom"], start=1):
            lines.append(f"{idx}. {ticker}  {value}")
        lines.append("")


def format_rankings_message(
    universe: str = "etf",
    mode: str = "all",
    top_n: int = DEFAULT_TOP_N,
    bottom_n: int = DEFAULT_BOTTOM_N,
) -> str:
    label_name = UNIVERSES[universe]["label"]
    if not is_cache_ready(universe):
        return f"{label_name} rankings are still loading. Please try again in a few minutes."

    modes = ["surge", "dropvol"] if mode == "all" else [mode]
    loaded_at = time.strftime(
        "%Y-%m-%d %H:%M",
        time.localtime(_states[universe]["meta"]["loaded_at"]),
    )
    first_board = _ranking_slice(universe, modes[0], top_n, 0 if mode == "all" else bottom_n)

    lines = [
        f"{label_name} rankings",
        "Price: last trading day return | Volume: latest day / 21d avg",
        f"Active: {len(_states[universe]['df'])} | Scanned: {first_board['scanned']} | Skipped: {first_board['skipped']}",
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
        _append_ranking_block(lines, board, top_n, use_bottom)

    if lines and lines[-1] == "":
        lines.pop()

    message = "\n".join(lines)
    if len(message) > 4000:
        message = message[:3990] + "\n...(truncated)"
    return message


def format_etf_rankings_message(
    mode: str = "all",
    top_n: int = DEFAULT_TOP_N,
    bottom_n: int = DEFAULT_BOTTOM_N,
) -> str:
    return format_rankings_message("etf", mode, top_n, bottom_n)


def parse_rank_command(message: str) -> tuple[str, str]:
    parts = message.strip().split()
    if not parts:
        raise ValueError("Empty command.")

    command = parts[0].lower()
    universe = None
    for prefix, key in RANK_COMMANDS.items():
        if command.startswith(prefix):
            universe = key
            break
    if universe is None:
        raise ValueError("Use /etf, /sp, or /nas.")

    mode = "all"
    if len(parts) > 1:
        candidate = parts[1].lower()
        if candidate in RANK_MODES:
            mode = candidate
        elif candidate != "all":
            raise ValueError(f"Unknown mode '{parts[1]}'. Use surge or dropvol.")

    return universe, mode


def parse_etf_command(message: str) -> str:
    _, mode = parse_rank_command(
        message if message.lower().startswith("/etf") else f"/etf {message}"
    )
    return mode
