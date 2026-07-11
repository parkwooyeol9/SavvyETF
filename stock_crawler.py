import contextlib
import logging
import os
import pickle
import sys
import threading
import time
import warnings
from collections.abc import Callable
from datetime import datetime
from io import StringIO
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd
import requests
import yfinance as yf

PROJECT_DIR = Path(__file__).resolve().parent
DATA_DIR = PROJECT_DIR / "data"
ETF_MASTER_PATH = PROJECT_DIR / "colab" / "ETF_Master.xlsx"
ETF_TICKERS_PATH = PROJECT_DIR / "colab" / "etf_tickers.txt"
SP500_TICKERS_PATH = PROJECT_DIR / "colab" / "sp500_tickers.txt"
NASDAQ100_TICKERS_PATH = PROJECT_DIR / "colab" / "nasdaq100_tickers.txt"
CACHE_VERSION = 8

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

# Daily bars only change once per session — keep cache fresh for the US trading day.
CACHE_TTL_SECONDS = 20 * 3600
DEFAULT_STALE_MAX_AGE_SECONDS = 7 * 24 * 3600
DEFAULT_TOP_N = 3
DEFAULT_BOTTOM_N = 3
WIKI_USER_AGENT = "SavvyETF/1.0 (telegram-bot)"
ET = ZoneInfo("America/New_York")

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
_refresh_scheduled: set[str] = set()
_warmup_status: dict[str, dict] = {
    key: {"phase": "idle", "error": "", "started_at": 0.0, "message": ""}
    for key in UNIVERSES
}

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


def _market_as_of_date() -> str:
    """US/Eastern calendar date used as the daily rankings cache key."""
    return datetime.now(ET).strftime("%Y-%m-%d")


def _is_same_market_day(loaded_at: float, as_of_date: str | None = None) -> bool:
    today = _market_as_of_date()
    if as_of_date:
        return str(as_of_date) == today
    if loaded_at <= 0:
        return False
    return datetime.fromtimestamp(loaded_at, ET).strftime("%Y-%m-%d") == today


def _read_ticker_file(path: Path) -> list[str]:
    if not path.exists():
        return []
    tickers: list[str] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        ticker = line.strip().upper().replace(" ", "").replace(".", "-")
        if not ticker or ticker.startswith("#") or ticker.startswith("@") or ticker.startswith("U:"):
            continue
        tickers.append(ticker)
    return tickers


def _set_warmup_status(universe: str, *, phase: str, message: str = "", error: str = "") -> None:
    status = _warmup_status.setdefault(universe, {})
    status["phase"] = phase
    status["message"] = message
    status["error"] = error
    if phase in {"starting", "running"}:
        status["started_at"] = time.time()
    if phase in {"ready", "failed", "idle"}:
        status["started_at"] = float(status.get("started_at") or 0.0)


def get_warmup_status(universe: str) -> dict:
    status = dict(_warmup_status.get(universe) or {})
    status["running"] = universe in _warmup_running or status.get("phase") in {"starting", "running", "queued"}
    if is_cache_ready(universe):
        status["phase"] = "ready"
        status["running"] = False
    return status


def load_etf_tickers(excel_path: Path | None = None) -> list[str]:
    """Load ETF universe: prefer committed ticker list, fall back to Excel master."""
    tickers = _read_ticker_file(ETF_TICKERS_PATH)
    if tickers:
        return tickers

    path = excel_path or ETF_MASTER_PATH
    if not path.exists():
        raise FileNotFoundError(
            f"ETF ticker list not found. Expected {ETF_TICKERS_PATH} or Excel master {path}"
        )

    df = pd.read_excel(path)
    raw = df.iloc[:, 0].dropna().astype(str).str.strip().str.upper().tolist()
    cleaned = []
    for ticker in raw:
        if not ticker or ticker.startswith("@") or ticker.startswith("U:"):
            continue
        cleaned.append(ticker.replace(" ", ""))
    return cleaned


def load_sp500_tickers() -> list[str]:
    tickers = _read_ticker_file(SP500_TICKERS_PATH)
    if tickers:
        return tickers
    html = _fetch_wikipedia_html("https://en.wikipedia.org/wiki/List_of_S%26P_500_companies")
    table = pd.read_html(StringIO(html))[0]
    return _clean_symbols(table["Symbol"])


def load_nasdaq100_tickers() -> list[str]:
    tickers = _read_ticker_file(NASDAQ100_TICKERS_PATH)
    if tickers:
        return tickers
    html = _fetch_wikipedia_html("https://en.wikipedia.org/wiki/Nasdaq-100")
    for table in pd.read_html(StringIO(html)):
        cols = {str(col).strip().lower(): col for col in table.columns}
        ticker_col = cols.get("ticker") or cols.get("symbol")
        if ticker_col is None:
            continue
        cleaned = _clean_symbols(table[ticker_col])
        if 90 <= len(cleaned) <= 110:
            return cleaned
    raise RuntimeError(
        "Could not parse NASDAQ-100 tickers. Add colab/nasdaq100_tickers.txt to the deploy."
    )


def _load_universe_tickers(universe: str) -> list[str]:
    if universe == "etf":
        return load_etf_tickers()
    if universe == "sp":
        return load_sp500_tickers()
    if universe == "nas":
        return load_nasdaq100_tickers()
    raise ValueError(f"Unknown universe: {universe}")


def _stale_max_age_seconds() -> int:
    raw = os.environ.get("CACHE_STALE_MAX_AGE_SECONDS", str(DEFAULT_STALE_MAX_AGE_SECONDS)).strip()
    try:
        return max(0, int(raw))
    except ValueError:
        return DEFAULT_STALE_MAX_AGE_SECONDS


def cache_age_seconds(universe: str) -> float | None:
    if universe not in UNIVERSES:
        return None
    loaded_at = float(_states[universe]["meta"].get("loaded_at", 0))
    if loaded_at <= 0:
        return None
    return max(0.0, time.time() - loaded_at)


def cache_is_stale(universe: str) -> bool:
    state = _states[universe]
    meta = state.get("meta") or {}
    if _is_same_market_day(float(meta.get("loaded_at", 0)), meta.get("as_of_date")):
        return False
    age = cache_age_seconds(universe)
    return age is not None and age > CACHE_TTL_SECONDS


def is_cache_ready(universe: str = "etf") -> bool:
    state = _states[universe]
    if state["ready"] and state["df"] is not None and not state["df"].empty:
        return True
    # Prefer today's disk cache (daily bars) before falling back to older stale copies.
    if _load_disk_cache(universe, max_age=CACHE_TTL_SECONDS):
        return True

    stale_max = _stale_max_age_seconds()
    if stale_max > 0 and _load_disk_cache(universe, max_age=stale_max):
        _schedule_cache_refresh(universe)
        return True
    return False


def _schedule_cache_refresh(universe: str) -> None:
    if universe not in UNIVERSES:
        return
    if universe in _warmup_running or universe in _refresh_scheduled:
        return
    if not cache_is_stale(universe):
        return

    def worker() -> None:
        try:
            start_universe_cache_warmup(universe, force=True)
        finally:
            _refresh_scheduled.discard(universe)

    _refresh_scheduled.add(universe)
    threading.Thread(
        target=worker,
        name=f"refresh-{universe}",
        daemon=True,
    ).start()


def is_cache_warmup_running(universe: str) -> bool:
    if universe in _warmup_running:
        return True
    phase = (_warmup_status.get(universe) or {}).get("phase")
    return phase in {"starting", "queued", "running"}


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
                period="2mo",
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


def _metrics_from_yahoo_chart_ticker(ticker: str) -> dict[str, float] | None:
    from yahoo_market import fetch_daily_candles

    frame = fetch_daily_candles(ticker)
    if frame.empty or len(frame) < 2:
        return None
    metrics = _metrics_from_series(frame["close"], frame.get("volume"))
    return metrics or None


def build_metrics_table_yahoo_chart(
    tickers: list[str],
    *,
    on_progress: Callable[[int, int, int], None] | None = None,
    max_workers: int = 10,
) -> tuple[pd.DataFrame, int, int]:
    """Build ranking metrics via Yahoo chart API (preferred for /sp /nas /etf)."""
    from yahoo_market import map_tickers

    scanned = len(tickers)

    def worker(ticker: str) -> dict[str, float] | None:
        # Do not call heavy_work_yield_point here — mid-build yields left caches empty
        # while /sp kept showing the loading message forever.
        return _metrics_from_yahoo_chart_ticker(ticker)

    def progress(done: int, total: int) -> None:
        if on_progress:
            on_progress(done, total, done)

    mapped = map_tickers(tickers, worker, max_workers=max_workers, on_progress=progress)
    rows = [{"Ticker": ticker, **values} for ticker, values in sorted(mapped.items()) if values]
    df = pd.DataFrame(rows)
    skipped = scanned - len(df)
    return df, scanned, skipped


def build_metrics_table(
    tickers: list[str],
    chunk_size: int = 25,
    pause_seconds: float = 0.35,
    on_progress: Callable[[int, int, int], None] | None = None,
    *,
    provider: str = "auto",
) -> tuple[pd.DataFrame, int, int]:
    """
    provider:
      - auto / yahoo_chart: parallel Yahoo chart API (fast; used for /sp /nas)
      - yfinance: batched yfinance.download fallback
    """
    use_yahoo_chart = provider in {"auto", "yahoo_chart"}

    if use_yahoo_chart:
        try:
            return build_metrics_table_yahoo_chart(tickers, on_progress=on_progress)
        except Exception as exc:
            print(f"Yahoo chart metrics failed ({exc}); falling back to yfinance")

    scanned = len(tickers)
    ticker_values: dict[str, dict[str, float]] = {}
    total_chunks = (len(tickers) + chunk_size - 1) // chunk_size if tickers else 0

    for index, start in enumerate(range(0, len(tickers), chunk_size), start=1):
        from heavy_work import heavy_work_yield_point

        heavy_work_yield_point("yfinance-cache")
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
    loaded_at = time.time()
    payload = {
        "version": CACHE_VERSION,
        "loaded_at": loaded_at,
        "as_of_date": _market_as_of_date(),
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
    as_of_date = payload.get("as_of_date")
    age = time.time() - loaded_at
    same_day = _is_same_market_day(loaded_at, as_of_date)

    # Same US calendar day: reuse even if older than the short TTL window.
    if same_day:
        if age > DEFAULT_STALE_MAX_AGE_SECONDS:
            return False
    elif age > max_age:
        return False

    df = payload.get("dataframe")
    if df is None or df.empty:
        return False

    state["df"] = df
    state["meta"] = {
        "scanned": int(payload.get("scanned", len(df))),
        "skipped": int(payload.get("skipped", 0)),
        "loaded_at": loaded_at,
        "as_of_date": as_of_date or _market_as_of_date(),
    }
    state["ready"] = True
    return True


def _set_memory_cache(universe: str, df: pd.DataFrame, scanned: int, skipped: int) -> None:
    if df is None or df.empty:
        print(f"{UNIVERSES[universe]['label']}: refusing to cache empty dataframe")
        return
    state = _states[universe]
    loaded_at = time.time()
    state["df"] = df
    state["meta"] = {
        "scanned": scanned,
        "skipped": skipped,
        "loaded_at": loaded_at,
        "as_of_date": _market_as_of_date(),
    }
    state["ready"] = True
    _save_disk_cache(universe, df, scanned, skipped)
    print(
        f"{UNIVERSES[universe]['label']} cache saved to disk "
        f"({len(df)} tickers, as_of={state['meta']['as_of_date']} ET)."
    )


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
        _set_warmup_status(universe, phase="running", message=f"Building {label} cache…")

        try:
            if not force and _load_disk_cache(universe):
                age_min = int((time.time() - _states[universe]["meta"]["loaded_at"]) // 60)
                count = len(_states[universe]["df"])
                print(f"{label} cache loaded from disk ({count} tickers, {age_min}m old).")
                _set_warmup_status(universe, phase="ready", message=f"Loaded {count} tickers from disk")
                return

            print(f"Preloading {label} rankings...")
            tickers = _load_universe_tickers(universe)
            chunk_size = UNIVERSES[universe]["chunk_size"]
            # All ranking universes use Yahoo chart API (fast parallel HTTP).
            # yfinance remains the fallback inside build_metrics_table.
            provider = "yahoo_chart"
            print(f"{label}: data provider = {provider} ({len(tickers)} tickers)")
            _set_warmup_status(
                universe,
                phase="running",
                message=f"Fetching Yahoo chart for {len(tickers)} tickers…",
            )

            def progress(done: int, total: int, active: int) -> None:
                print(f"  {label}: {done}/{total} | active tickers: {active}")
                _set_warmup_status(
                    universe,
                    phase="running",
                    message=f"Yahoo chart {done}/{total} (active {active})",
                )

            try:
                df, scanned, skipped = build_metrics_table(
                    tickers,
                    chunk_size=chunk_size,
                    on_progress=progress,
                    provider=provider,
                )
            except Exception as exc:
                from heavy_work import HeavyWorkYield

                if isinstance(exc, HeavyWorkYield):
                    print(f"{label} preload paused to free RAM for higher-priority work.")
                    _set_warmup_status(universe, phase="failed", error="paused for higher-priority work")
                    raise
                raise

            if df is None or df.empty:
                print(f"{label} preload produced no rows — cache not updated.")
                _set_warmup_status(universe, phase="failed", error="Yahoo chart returned no rows")
                return

            _set_memory_cache(universe, df, scanned, skipped)
            _set_warmup_status(
                universe,
                phase="ready",
                message=f"Ready: {len(df)} active / {scanned} scanned",
            )
            print(
                f"{label} preload complete: {len(df)} active / {scanned} scanned / {skipped} skipped."
            )
        except Exception as exc:
            _set_warmup_status(universe, phase="failed", error=str(exc)[:240])
            print(f"{label} preload failed: {exc}")
            raise
        finally:
            _warmup_running.discard(universe)


def warmup_etf_cache(force: bool = False) -> None:
    warmup_cache("etf", force=force)


def warmup_all_caches(force: bool = False) -> None:
    for universe in UNIVERSES:
        warmup_cache(universe, force=force)


def warmup_startup_caches(force: bool = False) -> None:
    from heavy_work import (
        HeavyWorkYield,
        end_heavy_work,
        heavy_work_owner,
        try_begin_heavy_work,
        wait_for_startup_grace,
    )

    raw = os.environ.get("BOT_STARTUP_CACHE_UNIVERSES", "etf").strip()
    universes = [part.strip() for part in raw.split(",") if part.strip()]
    if not universes:
        print("Startup cache warmup skipped (BOT_STARTUP_CACHE_UNIVERSES empty).")
        return

    wait_for_startup_grace("startup-cache-warmup")

    for universe in universes:
        if universe not in UNIVERSES:
            continue

        while not try_begin_heavy_work("startup-cache-warmup"):
            owner = heavy_work_owner() or "unknown"
            print(f"Startup cache warmup waiting ({universe}): heavy work busy ({owner})")
            time.sleep(15)

        try:
            warmup_cache(universe, force=force)
        except HeavyWorkYield:
            print("Startup cache warmup paused for higher-priority work.")
            break
        finally:
            if heavy_work_owner() == "startup-cache-warmup":
                end_heavy_work("startup-cache-warmup")


def start_etf_cache_warmup(blocking: bool = False, force: bool = False) -> None:
    start_universe_cache_warmup("etf", blocking=blocking, force=force)


def _warmup_retry_seconds() -> int:
    raw = os.environ.get("CACHE_WARMUP_RETRY_SECONDS", "120").strip()
    try:
        return max(15, int(raw))
    except ValueError:
        return 120


def _warmup_yield_retries() -> int:
    raw = os.environ.get("CACHE_WARMUP_YIELD_RETRIES", "30").strip()
    try:
        return max(1, int(raw))
    except ValueError:
        return 30


def _warmup_universe_blocking(universe: str, *, force: bool = False) -> bool:
    """Build ranking cache without the global heavy-work lock.

    Yahoo chart warmups are light HTTP. Waiting on HEAVY_WORK_SERIALIZE (held by
    ETF/summary/macro) left /sp stuck on the loading message indefinitely.
    """
    label = UNIVERSES[universe]["label"]
    _set_warmup_status(universe, phase="queued", message=f"Queued {label} cache build")
    try:
        print(f"Cache warmup started for {label}")
        warmup_cache(universe, force=force)
        if is_cache_ready(universe):
            print(f"Cache warmup finished for {label}")
            return True
        status = get_warmup_status(universe)
        err = status.get("error") or "cache still not ready"
        print(f"Cache warmup finished for {label} but not ready: {err}")
        _set_warmup_status(universe, phase="failed", error=str(err))
        return False
    except Exception as exc:
        print(f"Cache warmup failed for {label}: {exc}")
        _set_warmup_status(universe, phase="failed", error=str(exc)[:240])
        return False


def start_universe_cache_warmup(
    universe: str,
    *,
    blocking: bool = False,
    force: bool = False,
) -> None:
    if universe not in UNIVERSES:
        raise ValueError(f"Unknown universe: {universe}")
    if is_cache_warmup_running(universe):
        return
    if is_cache_ready(universe) and not force and not cache_is_stale(universe):
        return

    _set_warmup_status(universe, phase="starting", message="Starting cache build…")

    def worker() -> None:
        try:
            _warmup_universe_blocking(universe, force=force)
        except Exception as exc:
            print(f"Cache warmup thread crashed for {universe}: {exc}")
            _set_warmup_status(universe, phase="failed", error=str(exc)[:240])

    if blocking:
        worker()
        return

    threading.Thread(
        target=worker,
        name=f"{universe}-cache-warmup",
        daemon=True,
    ).start()


def ensure_universe_caches(universes: list[str] | tuple[str, ...], *, force: bool = False) -> list[str]:
    """Start warmup for universes that are not ready; return those still missing."""
    missing: list[str] = []
    for universe in universes:
        if universe not in UNIVERSES:
            continue
        if is_cache_ready(universe) and not force and not cache_is_stale(universe):
            continue
        missing.append(universe)
        start_universe_cache_warmup(universe, force=force)
    return missing


def warmup_deferred_caches(force: bool = False) -> None:
    from heavy_work import wait_for_startup_grace

    raw = os.environ.get("BOT_DEFERRED_CACHE_UNIVERSES", "sp,nas").strip()
    universes = [part.strip() for part in raw.split(",") if part.strip()]
    if not universes:
        return

    wait_for_startup_grace("deferred-cache-warmup")
    retry_seconds = _warmup_retry_seconds()

    while True:
        pending = [universe for universe in universes if universe in UNIVERSES and not is_cache_ready(universe)]
        if not pending:
            print("Deferred cache warmup complete.")
            break

        for universe in pending:
            print(f"Deferred cache warmup: {universe}")
            _warmup_universe_blocking(universe, force=force)

        still_pending = [universe for universe in universes if universe in UNIVERSES and not is_cache_ready(universe)]
        if not still_pending:
            print("Deferred cache warmup complete.")
            break

        print(f"Deferred cache warmup retry in {retry_seconds}s for {still_pending}")
        time.sleep(retry_seconds)


def start_cache_watchdog(universes: list[str] | tuple[str, ...] | None = None) -> None:
    raw = os.environ.get("CACHE_WATCHDOG_SECONDS", "600").strip()
    try:
        interval = max(60, int(raw))
    except ValueError:
        interval = 600

    if os.environ.get("CACHE_WATCHDOG_ENABLED", "true").lower() in {"0", "false", "no"}:
        print("Cache watchdog disabled.")
        return

    watch = list(universes or ("etf", "sp"))

    def loop() -> None:
        while True:
            time.sleep(interval)
            missing = [universe for universe in watch if universe in UNIVERSES and not is_cache_ready(universe)]
            if missing:
                print(f"Cache watchdog: warming missing universes {missing}")
                ensure_universe_caches(missing)
                continue

            stale = [universe for universe in watch if universe in UNIVERSES and cache_is_stale(universe)]
            if stale:
                print(f"Cache watchdog: refreshing stale universes {stale}")
                ensure_universe_caches(stale, force=True)

    threading.Thread(target=loop, name="cache-watchdog", daemon=True).start()
    print(f"Cache watchdog active every {interval}s for {watch}")


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


def _format_ticker_display(ticker: str, universe: str) -> str:
    if universe == "etf":
        from etf_names import format_etf_ticker_label

        return format_etf_ticker_label(ticker)
    return ticker


def _append_ranking_block(
    lines: list[str],
    board: dict,
    top_n: int,
    bottom_n: int,
    *,
    universe: str,
) -> None:
    lines.append(board["title"])
    lines.append(f"({board['label']})")
    lines.append("")

    if top_n > 0 and board["top"]:
        lines.append(f"Top {top_n}:")
        for idx, (ticker, value) in enumerate(board["top"], start=1):
            lines.append(f"{idx}. {_format_ticker_display(ticker, universe)}  {value}")
        lines.append("")

    if bottom_n > 0 and board["bottom"]:
        lines.append(f"Bottom {bottom_n}:")
        for idx, (ticker, value) in enumerate(board["bottom"], start=1):
            lines.append(f"{idx}. {_format_ticker_display(ticker, universe)}  {value}")
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

    if universe == "etf":
        preview_tickers: list[str] = []
        for rank_mode in modes:
            use_bottom = 0 if mode == "all" else bottom_n
            board = _ranking_slice(universe, rank_mode, top_n, use_bottom)
            for group in (board["top"], board["bottom"]):
                for ticker, _ in group:
                    if ticker not in preview_tickers:
                        preview_tickers.append(ticker)
        if preview_tickers:
            from etf_names import prefetch_etf_names

            prefetch_etf_names(preview_tickers)

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
        _append_ranking_block(lines, board, top_n, use_bottom, universe=universe)

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
