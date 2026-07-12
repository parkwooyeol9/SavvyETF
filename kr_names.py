"""Korean equity display names from committed universe JSON files."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parent
UNIVERSE_DIR = PROJECT_DIR / "data" / "universes"


@lru_cache(maxsize=1)
def _code_to_name() -> dict[str, str]:
    mapping: dict[str, str] = {}
    for path in (UNIVERSE_DIR / "kospi200.json", UNIVERSE_DIR / "kosdaq100.json"):
        if not path.is_file():
            continue
        try:
            doc = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        for row in doc.get("constituents") or []:
            code = str(row.get("code") or "").strip()
            name = str(row.get("name") or "").strip()
            if code and name:
                mapping[code] = name
    return mapping


def kr_code_from_yahoo(ticker: str) -> str:
    raw = str(ticker or "").strip().upper()
    if "." in raw:
        raw = raw.split(".", 1)[0]
    return raw


def format_kr_ticker_label(ticker: str) -> str:
    code = kr_code_from_yahoo(ticker)
    name = _code_to_name().get(code)
    if name:
        return f"{name}({code})"
    return code or str(ticker)
