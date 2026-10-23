"""ACWI 종가 갱신 (Yahoo Chart).

유니버스는 Datastream RIC → Yahoo 티커로 맞춘 공개 식별자만 담는다.
매일 06:30 KST 스케줄러가 종가·주요 종목 2년 일봉을 R2 ``acwi_px/latest.json`` 에 올린다.
"""

from __future__ import annotations

import path_setup  # noqa: F401

import json
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests

ROOT = path_setup.PROJECT_DIR
UNIVERSE_PATH = ROOT / "webapp" / "src" / "data" / "acwiYahooUniverse.json"
R2_KEY = "acwi_px/latest.json"
UA = "Mozilla/5.0 (compatible; SavvyETF/1.0; +https://github.com/parkwooyeol9/SavvyETF)"

# 거래소 접미사가 Yahoo 와 다른 RIC.
SUFFIX_SWAP = {
    "S": "SW",   # 스위스
    "SE": "SR",  # 사우디 (Yahoo .SE 는 스웨덴)
    "J": "JO",   # 요하네스버그
    "I": "IR",   # 아일랜드
    "BU": "BD",  # 부다페스트
}
US_SUFFIXES = {"N", "OQ", "O", "K"}
SKIP_SUFFIXES = {"MM"}  # 러시아
# 독일 우선주 RIC → Yahoo
DE_PREF = {
    "VOWG_p.DE": "VOW3.DE",
    "HNKG_p.DE": "HEN3.DE",
    "PSHG_p.DE": "PAH3.DE",
    "P911_p.DE": "P911.DE",
    "BMWG_p.DE": "BMW.DE",
}
PAD4 = {"HK", "T", "TW"}
PAD6 = {"KS", "KQ"}


def _class_split(base: str) -> tuple[str, str | None]:
    """Reuters 소문자 종목구분(BRKb, VOLVb, SIEGn, DELTA_n)을 떼어 낸다."""
    match = re.fullmatch(r"(.+)_([a-z])", base) or re.fullmatch(r"([A-Za-z0-9]*[A-Z0-9])([a-z])", base)
    if not match:
        return base, None
    return match.group(1), match.group(2)


def yahoo_candidates(ric: str) -> list[str]:
    """한 RIC 에 대해 시도할 Yahoo 심볼. 앞쪽이 우선."""
    code = (ric or "").strip()
    if not code or "." not in code or "^" in code:
        return []
    if code in DE_PREF:
        return [DE_PREF[code]]
    base, suf = code.rsplit(".", 1)
    if suf in SKIP_SUFFIXES:
        return []
    stem, cls = _class_split(base)
    stem = stem.strip("-")
    if suf == "J":
        # NPNJn / GFIJ → NPN.JO / GFI.JO
        if cls == "n":
            stem = stem[:-1] if stem.endswith("J") else stem
        elif stem.endswith("J") and cls is None:
            stem = stem[:-1]
        cls = None
    if suf == "AT" and cls == "r":
        cls = None
    if suf == "DE" and cls == "n":
        cands = [stem]
        if stem.endswith("G") and len(stem) > 2:
            cands.append(stem[:-1])
        if stem and stem[-1].isdigit():
            trimmed = stem.rstrip("0123456789")
            if trimmed:
                cands.append(trimmed)
        cands.append(f"{stem}2")
        out: list[str] = []
        for item in cands:
            sym = f"{item}.DE"
            if sym not in out and item:
                out.append(sym)
        return out
    if cls == "n":
        cls = None
    yahoo_suf = SUFFIX_SWAP.get(suf, suf)
    if yahoo_suf in PAD4 and stem.isdigit():
        stem = stem.zfill(4)
    if yahoo_suf in PAD6 and stem.isdigit():
        stem = stem.zfill(6)
    if suf in US_SUFFIXES:
        if cls:
            return [f"{stem}-{cls.upper()}"]
        return [stem]
    if cls and yahoo_suf in {"ST", "CO", "TO", "HE", "OL", "AS"}:
        return [f"{stem}-{cls.upper()}.{yahoo_suf}"]
    if not stem:
        return []
    return [f"{stem}.{yahoo_suf}"]


def _yahoo_ok(symbol: str, session: requests.Session) -> bool:
    try:
        response = session.get(
            f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}",
            params={"range": "5d", "interval": "1d"},
            timeout=12,
        )
        if response.status_code != 200:
            return False
        result = ((response.json().get("chart") or {}).get("result") or [None])[0]
        meta = (result or {}).get("meta") or {}
        return bool(meta.get("regularMarketPrice") or meta.get("symbol"))
    except requests.RequestException:
        return False


def resolve_yahoo(ric: str, session: requests.Session | None = None, probe: bool = False) -> str | None:
    cands = yahoo_candidates(ric)
    if not cands:
        return None
    if not probe or len(cands) == 1:
        return cands[0]
    own = session or requests.Session()
    own.headers["User-Agent"] = UA
    for cand in cands:
        if _yahoo_ok(cand, own):
            return cand
    return None


def load_universe() -> list[dict[str, Any]]:
    if not UNIVERSE_PATH.exists():
        return []
    data = json.loads(UNIVERSE_PATH.read_text(encoding="utf-8"))
    rows = data.get("rows") if isinstance(data, dict) else data
    return [row for row in rows or [] if row.get("yahoo")]


def major_yahoos(rows: list[dict[str, Any]], per_country: int = 12, per_sector: int = 12) -> set[str]:
    """표에 쓰는 주요 종목. 국가·업종 각각의 비중 상위."""
    by_c: dict[str, list[dict[str, Any]]] = {}
    by_s: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        by_c.setdefault(row.get("country") or "기타", []).append(row)
        by_s.setdefault(row.get("sector") or "기타", []).append(row)
    picked: set[str] = set()
    for group in list(by_c.values()) + list(by_s.values()):
        group.sort(key=lambda r: -(r.get("weight") or 0))
    for group in by_c.values():
        for row in group[:per_country]:
            picked.add(row["yahoo"])
    for group in by_s.values():
        for row in group[:per_sector]:
            picked.add(row["yahoo"])
    return picked


def fetch_closes(symbol: str, rng: str, session: requests.Session) -> list[list[Any]]:
    response = session.get(
        f"https://query1.finance.yahoo.com/v8/finance/chart/{requests.utils.quote(symbol, safe='')}",
        params={"range": rng, "interval": "1d", "includePrePost": "false"},
        timeout=20,
    )
    if response.status_code != 200:
        return []
    result = ((response.json().get("chart") or {}).get("result") or [None])[0]
    if not result:
        return []
    stamps = result.get("timestamp") or []
    closes = ((result.get("indicators") or {}).get("quote") or [{}])[0].get("close") or []
    out: list[list[Any]] = []
    for i, stamp in enumerate(stamps):
        close = closes[i] if i < len(closes) else None
        if close is None or not isinstance(close, (int, float)) or close <= 0:
            continue
        day = datetime.fromtimestamp(int(stamp), timezone.utc).strftime("%Y-%m-%d")
        out.append([day, round(float(close), 6)])
    return out


def build_payload(rows: list[dict[str, Any]] | None = None, *, deadline: float | None = None) -> dict[str, Any]:
    """주요 종목은 2년 일봉, 나머지는 최근 종가만. SPY 는 베타용으로 항상 넣는다."""
    universe = rows if rows is not None else load_universe()
    majors = major_yahoos(universe)
    symbols = []
    seen: set[str] = set()
    for row in sorted(universe, key=lambda r: -(r.get("weight") or 0)):
        yahoo = row["yahoo"]
        if yahoo in seen:
            continue
        seen.add(yahoo)
        symbols.append(yahoo)
    if "SPY" not in seen:
        symbols.append("SPY")

    session = requests.Session()
    session.headers["User-Agent"] = UA
    quotes: list[dict[str, Any]] = []
    series: dict[str, list[list[Any]]] = {}
    errors = 0
    stopped = False

    def one(symbol: str) -> tuple[str, list[list[Any]]]:
        rng = "2y" if symbol in majors or symbol == "SPY" else "5d"
        try:
            return symbol, fetch_closes(symbol, rng, session)
        except requests.RequestException:
            return symbol, []

    def consume(batch: list[str]) -> None:
        nonlocal errors, stopped
        if stopped or not batch:
            return
        with ThreadPoolExecutor(max_workers=8) as pool:
            futures = [pool.submit(one, symbol) for symbol in batch]
            for fut in as_completed(futures):
                if deadline is not None and time.time() > deadline:
                    stopped = True
                    for pending in futures:
                        pending.cancel()
                    break
                symbol, closes = fut.result()
                if not closes:
                    errors += 1
                    continue
                last = closes[-1]
                quotes.append({"yahoo": symbol, "date": last[0], "close": last[1]})
                if symbol in majors or symbol == "SPY":
                    series[symbol] = closes

    majors_first = [symbol for symbol in symbols if symbol in majors or symbol == "SPY"]
    rest = [symbol for symbol in symbols if symbol not in majors and symbol != "SPY"]
    for start in range(0, len(majors_first), 40):
        if stopped or (deadline is not None and time.time() > deadline):
            break
        consume(majors_first[start : start + 40])
    for start in range(0, len(rest), 80):
        if stopped or (deadline is not None and time.time() > deadline):
            break
        consume(rest[start : start + 80])
    quotes.sort(key=lambda q: q["yahoo"])
    return {
        "as_of": max((q["date"] for q in quotes), default=None),
        "built_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "Yahoo Finance",
        "n_mapped": len(universe),
        "n_ok": len(quotes),
        "n_error": errors,
        "n_series": len(series),
        "quotes": quotes,
        "series": series,
    }


def publish(payload: dict[str, Any]) -> bool:
    from r2_data import put_json_daily

    return bool(put_json_daily(R2_KEY, payload, day=payload.get("as_of")))


def write_universe() -> int:
    """봉인된 summary.bin 에서 이름·국가·업종·비중과 Yahoo 티커만 뽑는다."""
    import sys

    sys.path.insert(0, str(ROOT / "Claude_DB"))
    from sealed_r2 import open_sealed

    blob = ROOT / "Claude_DB" / "out" / "sealed_local" / "private" / "acwi" / "latest" / "summary.bin"
    stocks = open_sealed(blob.read_bytes())["stocks"]
    session = requests.Session()
    session.headers["User-Agent"] = UA
    rows = []
    probed = 0
    for stock in stocks:
        ric = str(stock.get("c") or "")
        cands = yahoo_candidates(ric)
        if not cands:
            continue
        yahoo = cands[0]
        if len(cands) > 1:
            probed += 1
            yahoo = ""
            for cand in cands:
                if _yahoo_ok(cand, session):
                    yahoo = cand
                    break
                time.sleep(0.05)
            if not yahoo:
                continue
        rows.append(
            {
                "ric": ric,
                "yahoo": yahoo,
                "name": stock.get("n") or yahoo,
                "country": stock.get("ct") or "기타",
                "sector": stock.get("s") or "기타",
                "weight": stock.get("w") or 0,
            }
        )
    rows.sort(key=lambda r: -(r["weight"] or 0))
    UNIVERSE_PATH.parent.mkdir(parents=True, exist_ok=True)
    UNIVERSE_PATH.write_text(
        json.dumps(
            {"built_from": "acwi summary", "n": len(rows), "rows": rows},
            ensure_ascii=False,
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )
    print(f"wrote {len(rows)} rows, probed {probed} → {UNIVERSE_PATH}")
    return len(rows)


if __name__ == "__main__":
    import sys

    if "--write-universe" in sys.argv:
        write_universe()
    else:
        payload = build_payload()
        print(json.dumps({k: payload[k] for k in ("as_of", "n_mapped", "n_ok", "n_error", "n_series")}))
        if "--publish" in sys.argv:
            print("published" if publish(payload) else "publish skipped (R2 미설정)")
