"""KOSPI 200 daily panel — close, volume, NLP score, fundamentals levels.

R2:
  kospi200_panel/latest.json
  kospi200_panel/snapshots/{YYYY-MM-DD}.json

Daily rows are thin. Do not sum close / volume / nlp_score / PER.
Fundamentals attach only on the collection day (no look-ahead onto history).
"""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import requests

from kr_calendar import is_kr_equity_trading_day
from kosdaq100_monitor import fetch_fundamentals

KST = ZoneInfo("Asia/Seoul")
PROJECT_DIR = Path(__file__).resolve().parent
UNIVERSE_PATH = PROJECT_DIR / "data" / "universes" / "kospi200.json"
NLP_DIR = PROJECT_DIR / "data" / "nlp_history"
DATA_ROOT = PROJECT_DIR / "data" / "kospi200_panel"
SNAPSHOT_DIR = DATA_ROOT / "snapshots"
LATEST_PATH = DATA_ROOT / "latest.json"
R2_LATEST_KEY = "kospi200_panel/latest.json"
R2_SNAP_PREFIX = "kospi200_panel/snapshots/"

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
SESSION = requests.Session()
SESSION.headers.update(
    {
        "User-Agent": UA,
        "Referer": "https://finance.naver.com/",
        "Accept": "*/*",
    }
)

BAR_RE = re.compile(
    r'\["(\d{8})",\s*([0-9.]+),\s*([0-9.]+),\s*([0-9.]+),\s*([0-9.]+),\s*([0-9.]+)'
)
FUND_FIELDS = (
    "per",
    "pbr",
    "eps",
    "bps",
    "roe",
    "op_margin",
    "net_margin",
    "debt_ratio",
    "dividend_yield",
    "fiscal_label",
)
LOOKBACK_TODAY = 14
LOOKBACK_BACKFILL = 400
BAR_WORKERS = 12
FUND_WORKERS = 8


def _now_kst() -> datetime:
    return datetime.now(KST)


def _today_kst() -> date:
    return _now_kst().date()


def _ymd(day: date | str) -> str:
    if isinstance(day, date):
        return day.isoformat()
    return str(day)[:10]


def load_universe() -> list[dict[str, str]]:
    raw = json.loads(UNIVERSE_PATH.read_text(encoding="utf-8"))
    out: list[dict[str, str]] = []
    for row in raw.get("constituents") or []:
        code = str(row.get("code") or "").strip()
        name = str(row.get("name") or "").strip()
        if not re.fullmatch(r"\d{6}", code) or not name:
            continue
        out.append(
            {
                "code": code,
                "name": name,
                "yahoo": str(row.get("yahoo") or f"{code}.KS"),
            }
        )
    return out


def _parse_bars(text: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for match in BAR_RE.finditer(text):
        ymd = match.group(1)
        day = f"{ymd[:4]}-{ymd[4:6]}-{ymd[6:]}"
        close = float(match.group(5))
        volume = float(match.group(6))
        if close <= 0:
            continue
        rows.append(
            {
                "date": day,
                "open": float(match.group(2)),
                "high": float(match.group(3)),
                "low": float(match.group(4)),
                "close": close,
                "volume": volume,
            }
        )
    rows.sort(key=lambda r: r["date"])
    return rows


def fetch_daily_bars(code: str, start: date, end: date) -> list[dict[str, Any]]:
    url = (
        "https://fchart.stock.naver.com/siseJson.naver"
        f"?symbol={code}&requestType=1"
        f"&startTime={start:%Y%m%d}&endTime={end:%Y%m%d}&timeframe=day"
    )
    try:
        res = SESSION.get(url, timeout=20)
        if not res.ok:
            return []
        text = res.content.decode("utf-8", errors="replace")
        return _parse_bars(text)
    except Exception:
        return []


def load_nlp_index() -> dict[str, dict[str, dict[str, Any]]]:
    """code -> date -> {score, n}."""
    out: dict[str, dict[str, dict[str, Any]]] = {}
    if not NLP_DIR.is_dir():
        return out
    for path in NLP_DIR.glob("*.json"):
        if path.name == "index.json":
            continue
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        code = str(payload.get("code") or path.stem)
        by_day: dict[str, dict[str, Any]] = {}
        for row in payload.get("days") or []:
            day = str(row.get("date") or "")[:10]
            if not day:
                continue
            by_day[day] = {
                "nlp_score": row.get("score"),
                "nlp_n": int(row.get("n") or 0),
            }
        if by_day:
            out[code] = by_day
    return out


def _pick_as_of(bars_by_code: dict[str, list[dict[str, Any]]]) -> str | None:
    counts: Counter[str] = Counter()
    for bars in bars_by_code.values():
        if bars:
            counts[str(bars[-1]["date"])] += 1
    if not counts:
        return None
    return counts.most_common(1)[0][0]


def _bar_on(bars: list[dict[str, Any]], day: str) -> dict[str, Any] | None:
    for row in reversed(bars):
        if row["date"] == day:
            return row
        if row["date"] < day:
            break
    return None


def _row_for_day(
    spec: dict[str, str],
    bars: list[dict[str, Any]],
    day: str,
    nlp: dict[str, dict[str, Any]],
    fund: dict[str, Any] | None,
) -> dict[str, Any] | None:
    bar = _bar_on(bars, day)
    nlp_row = nlp.get(day) or {}
    if not bar and nlp_row.get("nlp_score") is None and not fund:
        return None
    row: dict[str, Any] = {
        "code": spec["code"],
        "name": spec["name"],
        "open": None if not bar else bar["open"],
        "high": None if not bar else bar["high"],
        "low": None if not bar else bar["low"],
        "close": None if not bar else bar["close"],
        "volume": None if not bar else bar["volume"],
        "nlp_score": nlp_row.get("nlp_score"),
        "nlp_n": nlp_row.get("nlp_n") or 0,
    }
    if fund:
        for key in FUND_FIELDS:
            row[key] = fund.get(key)
    else:
        for key in FUND_FIELDS:
            row[key] = None
    return row


def build_payload(
    *,
    day: str,
    specs: list[dict[str, str]],
    bars_by_code: dict[str, list[dict[str, Any]]],
    nlp_by_code: dict[str, dict[str, dict[str, Any]]],
    fund_by_code: dict[str, dict[str, Any]] | None,
) -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    for spec in specs:
        row = _row_for_day(
            spec,
            bars_by_code.get(spec["code"]) or [],
            day,
            nlp_by_code.get(spec["code"]) or {},
            None if fund_by_code is None else fund_by_code.get(spec["code"]),
        )
        if row:
            rows.append(row)
    coverage = {
        "bars": sum(1 for r in rows if r.get("close") is not None),
        "nlp": sum(1 for r in rows if r.get("nlp_score") is not None),
        "fund": sum(1 for r in rows if r.get("per") is not None or r.get("roe") is not None),
    }
    return {
        "ok": bool(rows),
        "universe": "kospi200",
        "as_of": day,
        "generated_at": _now_kst().isoformat(),
        "membership": [r["code"] for r in rows],
        "n": len(rows),
        "coverage": coverage,
        "note": (
            "일봉(OHLCV)·뉴스 점수·재무 레벨은 패밀리가 다름. 합산하지 말 것. "
            "재무 필드는 수집일 스냅샷에만 붙임."
        ),
        "rows": rows,
    }


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


def persist_payload(payload: dict[str, Any], *, latest: bool) -> dict[str, Any]:
    day = _ymd(payload.get("as_of") or "")
    local_ok = False
    r2_ok = False
    if day:
        _write_json(SNAPSHOT_DIR / f"{day}.json", payload)
        if latest:
            _write_json(LATEST_PATH, payload)
        local_ok = True
    try:
        from r2_data import put_json, put_json_daily, r2_configured
    except Exception:
        return {"local": local_ok, "r2": False, "day": day}
    if not r2_configured() or not day:
        return {"local": local_ok, "r2": False, "day": day}
    if latest:
        r2_ok = put_json_daily(R2_LATEST_KEY, payload, day=day)
    else:
        r2_ok = put_json(f"{R2_SNAP_PREFIX}{day}.json", payload)
    return {"local": local_ok, "r2": bool(r2_ok), "day": day}


def local_snapshot_exists(day: str) -> bool:
    return (SNAPSHOT_DIR / f"{day}.json").is_file()


def _map_pool(items: list[Any], workers: int, fn) -> dict[str, Any]:
    out: dict[str, Any] = {}
    if not items:
        return out
    with ThreadPoolExecutor(max_workers=max(1, min(workers, len(items)))) as pool:
        futs = {pool.submit(fn, item): item for item in items}
        for fut in as_completed(futs):
            item = futs[fut]
            code = item["code"] if isinstance(item, dict) else str(item)
            try:
                out[code] = fut.result()
            except Exception:
                out[code] = None
    return out


def collect(
    *,
    lookback_days: int,
    with_fundamentals: bool,
    backfill: bool,
    force: bool,
    codes: list[str] | None = None,
) -> dict[str, Any]:
    specs = load_universe()
    if codes:
        want = {c.strip() for c in codes}
        specs = [s for s in specs if s["code"] in want]
    end = _today_kst()
    start = end - timedelta(days=lookback_days)
    print(f"kospi200_panel: {len(specs)} names, bars {start} → {end}", flush=True)

    bars_by_code = _map_pool(
        specs,
        BAR_WORKERS,
        lambda spec: fetch_daily_bars(spec["code"], start, end),
    )
    bars_by_code = {k: v or [] for k, v in bars_by_code.items()}
    nlp_by_code = load_nlp_index()
    as_of = _pick_as_of(bars_by_code) or _ymd(end)

    fund_by_code: dict[str, dict[str, Any]] | None = None
    if with_fundamentals:
        raw = _map_pool(
            specs,
            FUND_WORKERS,
            lambda spec: fetch_fundamentals(spec["code"], spec["name"]),
        )
        fund_by_code = {k: v for k, v in raw.items() if isinstance(v, dict)}

    latest = build_payload(
        day=as_of,
        specs=specs,
        bars_by_code=bars_by_code,
        nlp_by_code=nlp_by_code,
        fund_by_code=fund_by_code,
    )
    written = [persist_payload(latest, latest=True)]

    if backfill:
        dates: set[str] = set()
        for bars in bars_by_code.values():
            for bar in bars:
                dates.add(bar["date"])
        for day in sorted(dates):
            if day == as_of:
                continue
            if not force and local_snapshot_exists(day):
                continue
            if not is_kr_equity_trading_day(date.fromisoformat(day)):
                continue
            payload = build_payload(
                day=day,
                specs=specs,
                bars_by_code=bars_by_code,
                nlp_by_code=nlp_by_code,
                fund_by_code=None,
            )
            written.append(persist_payload(payload, latest=False))

    return {
        "ok": bool(latest.get("ok")),
        "as_of": as_of,
        "n": latest.get("n"),
        "coverage": latest.get("coverage"),
        "written": len(written),
        "r2": sum(1 for w in written if w.get("r2")),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="KOSPI 200 daily panel ingest")
    parser.add_argument("--today", action="store_true", help="write latest session only")
    parser.add_argument("--backfill", action="store_true", help="write missing history days from bars")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--lookback", type=int, default=None)
    parser.add_argument("--codes", nargs="*", default=None)
    args = parser.parse_args()
    backfill = bool(args.backfill)
    lookback = args.lookback or (LOOKBACK_BACKFILL if backfill else LOOKBACK_TODAY)
    result = collect(
        lookback_days=lookback,
        with_fundamentals=True,
        backfill=backfill,
        force=bool(args.force),
        codes=args.codes,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
