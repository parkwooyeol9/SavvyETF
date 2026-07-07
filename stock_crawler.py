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
CACHE_VERSION = 4

PERIOD_MAP = {
    "1mo": "1mo Return",
    "3mo": "3mo Return",
    "6mo": "6mo Return",
    "12mo": "12mo Return",
}

VOL_PERIOD_MAP = {
    "1mo": "1mo Vol Ratio",
    "3mo": "3mo Vol Ratio",
    "6mo": "6mo Vol Ratio",
    "12mo": "12mo Vol Ratio",
}

SORT_CRITERIA = {
    "price": PERIOD_MAP,
    "vol": VOL_PERIOD_MAP,
}

RETURN_WINDOWS = {
    "1mo Return": 21,
    "3mo Return": 63,
    "6mo Return": 126,
    "12mo Return": 252,
}

VOL_BASELINE_WINDOWS = {
    "1mo Vol Ratio": 21,
    "3mo Vol Ratio": 63,
    "6mo Vol Ratio": 126,
    "12mo Vol Ratio": 252,
}

RECENT_VOL_DAYS = 5

VOL_METRIC_LABELS = {
    "1mo": "latest day vol / 1mo avg",
    "3mo": "5d avg vol / 3mo avg",
    "6mo": "5d avg vol / 6mo avg",
    "12mo": "5d avg vol / 12mo avg",
}

CACHE_TTL_SECONDS = 3600
DEFAULT_TOP_N = 5
DEFAULT_BOTTOM_N = 5
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


def _returns_from_close(close: pd.Series) -> dict[str, float]:
    prices = close.dropna()
    if len(prices) < 2:
        return {}

    last = float(prices.iloc[-1])
    if last <= 0:
        return {}

    results: dict[str, float] = {}
    for column, window in RETURN_WINDOWS.items():
        if len(prices) <= window:
            continue
        first = float(prices.iloc[-(window + 1)])
        if first <= 0:
            continue
        results[column] = (last - first) / first
    return results


def _volume_ratios_from_volume(volume: pd.Series) -> dict[str, float]:
    vol = volume.dropna()
    if vol.empty:
        return {}

    results: dict[str, float] = {}

    # 1mo: most recent day vs 1-month (21 trading days) average
    window_1mo = VOL_BASELINE_WINDOWS["1mo Vol Ratio"]
    if len(vol) >= window_1mo:
        month_avg = float(vol.iloc[-window_1mo:].mean())
        last_vol = float(vol.iloc[-1])
        if month_avg > 0 and last_vol > 0:
            results["1mo Vol Ratio"] = last_vol / month_avg

    # 3mo / 6mo / 12mo: recent 5-day avg vs period average
    if len(vol) >= RECENT_VOL_DAYS:
        recent_avg = float(vol.iloc[-RECENT_VOL_DAYS:].mean())
        if recent_avg > 0:
            for column, window in (
                ("3mo Vol Ratio", VOL_BASELINE_WINDOWS["3mo Vol Ratio"]),
                ("6mo Vol Ratio", VOL_BASELINE_WINDOWS["6mo Vol Ratio"]),
                ("12mo Vol Ratio", VOL_BASELINE_WINDOWS["12mo Vol Ratio"]),
            ):
                if len(vol) >= window:
                    period_avg = float(vol.iloc[-window:].mean())
                    if period_avg > 0:
                        results[column] = recent_avg / period_avg

    return results


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
        volume = _extract_ticker_series(data, ticker, "Volume")
        if close is None:
            continue

        metrics = _returns_from_close(close)
        if volume is not None:
            metrics.update(_volume_ratios_from_volume(volume))

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


def _sort_column(period: str, sort_by: str) -> tuple[str, str]:
    sort_by = sort_by.lower()
    if sort_by not in SORT_CRITERIA:
        raise ValueError(f"Unsupported sort: {sort_by}. Use: {list(SORT_CRITERIA)}")
    if period not in PERIOD_MAP:
        raise ValueError(f"Unsupported period: {period}. Use: {list(PERIOD_MAP)}")

    column = SORT_CRITERIA[sort_by][period]
    if sort_by == "price":
        label = f"{period} return"
    else:
        label = VOL_METRIC_LABELS.get(period, f"{period} volume ratio")
    return column, label


def get_rankings(
    universe: str = "etf",
    period: str = "1mo",
    sort_by: str = "price",
) -> tuple[pd.DataFrame, str, str, int, int]:
    if not is_cache_ready(universe):
        raise RuntimeError(f"{UNIVERSES[universe]['label']} cache is not ready yet.")

    column, label = _sort_column(period, sort_by)
    df = _states[universe]["df"].dropna(subset=[column]).sort_values(by=column, ascending=False)
    meta = _states[universe]["meta"]
    return df, column, label, meta["scanned"], meta["skipped"]


def get_etf_rankings(
    period: str = "1mo",
    sort_by: str = "price",
) -> tuple[pd.DataFrame, str, str, int, int]:
    return get_rankings("etf", period, sort_by)


def _format_price(value: float) -> str:
    return f"{value * 100:+.2f}%"


def _format_volume_ratio(value: float) -> str:
    return f"{value:.2f}x"


def get_ranking_tickers(
    universe: str = "etf",
    period: str = "1mo",
    sort_by: str = "price",
    top_n: int = DEFAULT_TOP_N,
    bottom_n: int = DEFAULT_BOTTOM_N,
) -> tuple[list[str], str]:
    df, column, label, _, _ = get_rankings(universe, period, sort_by)
    top = df.head(top_n)["Ticker"].tolist()
    bottom = df.sort_values(by=column, ascending=True).head(bottom_n)["Ticker"].tolist()
    context = f"{UNIVERSES[universe]['label']} — {label}"
    return top + bottom, context


def format_rankings_message(
    universe: str = "etf",
    period: str = "1mo",
    sort_by: str = "price",
    top_n: int = DEFAULT_TOP_N,
    bottom_n: int = DEFAULT_BOTTOM_N,
) -> str:
    label_name = UNIVERSES[universe]["label"]
    if not is_cache_ready(universe):
        return f"{label_name} rankings are still loading. Please try again in a few minutes."

    df, column, label, scanned, skipped = get_rankings(universe, period, sort_by)
    if df.empty:
        return (
            f"No {label_name} data for {label}.\n"
            f"Scanned {scanned} tickers; none had valid data for this sort."
        )

    formatter = _format_price if sort_by == "price" else _format_volume_ratio
    loaded_at = time.strftime(
        "%Y-%m-%d %H:%M",
        time.localtime(_states[universe]["meta"]["loaded_at"]),
    )
    lines = [
        f"{label_name} rankings — {label}",
        f"Active: {len(df)} | Scanned: {scanned} | Skipped: {skipped}",
        f"Data as of: {loaded_at}",
    ]
    if sort_by == "vol":
        lines.append(f"Metric: {VOL_METRIC_LABELS.get(period, 'volume ratio')}")
    lines.append("")

    if top_n > 0:
        lines.append(f"Top {top_n}:")
        for idx, (_, row) in enumerate(df.head(top_n).iterrows(), start=1):
            lines.append(f"{idx}. {row['Ticker']}  {formatter(row[column])}")
        lines.append("")

    if bottom_n > 0:
        lines.append(f"Bottom {bottom_n}:")
        bottom = df.sort_values(by=column, ascending=True).head(bottom_n)
        for idx, (_, row) in enumerate(bottom.iterrows(), start=1):
            lines.append(f"{idx}. {row['Ticker']}  {formatter(row[column])}")

    message = "\n".join(lines)
    if len(message) > 4000:
        message = message[:3990] + "\n...(truncated)"
    return message


def format_etf_rankings_message(
    period: str = "1mo",
    sort_by: str = "price",
    top_n: int = DEFAULT_TOP_N,
    bottom_n: int = DEFAULT_BOTTOM_N,
) -> str:
    return format_rankings_message("etf", period, sort_by, top_n, bottom_n)


def _parse_period_and_sort(parts: list[str]) -> tuple[str, str]:
    period = "1mo"
    sort_by = "price"

    if len(parts) > 1 and parts[1].lower() in PERIOD_MAP:
        period = parts[1].lower()
        parts = [parts[0]] + parts[2:]

    if len(parts) > 1:
        candidate = parts[1].lower()
        if candidate in SORT_CRITERIA:
            sort_by = candidate
        else:
            raise ValueError(f"Unknown sort '{parts[1]}'. Use price or vol.")

    return period, sort_by


def parse_rank_command(message: str) -> tuple[str, str, str]:
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

    period, sort_by = _parse_period_and_sort(parts)
    return universe, period, sort_by


def parse_etf_command(message: str) -> tuple[str, str]:
    _, period, sort_by = parse_rank_command(
        message if message.lower().startswith("/etf") else f"/etf {message}"
    )
    return period, sort_by
