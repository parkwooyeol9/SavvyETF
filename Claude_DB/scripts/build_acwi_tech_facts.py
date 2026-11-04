"""봉인된 ACWI summary.bin 에서 공개 가능한 종목 팩트만 뽑아 웹앱 JSON 으로 쓴다.

기술적분석에서 고른 종목의 밸류 맥락과 AI Pick 팩트가 이 파일을 읽는다.
추정치·ISIN·팩터 점수·MSCI 상태는 넣지 않는다.

    python Claude_DB/scripts/build_acwi_tech_facts.py
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "Claude_DB"))

from sealed_r2 import open_sealed  # noqa: E402

SUMMARY = ROOT / "Claude_DB" / "out" / "sealed_local" / "private" / "acwi" / "latest" / "summary.bin"
OUT = ROOT / "webapp" / "src" / "data" / "acwiTechFacts.json"

# 화면이 소수 한 자리(PBR·배당만 두 자리)로 읽으므로 저장도 거기에 맞춘다.
FIELDS = (
    ("pe", 1),
    ("pb", 2),
    ("dy", 2),
    ("roe", 1),
    ("pep", 1),
    ("pep10", 1),
    ("r12m", 1),
    ("dd52", 1),
    ("vol", 1),
    ("ts", 1),
)


def _num(value: object, places: int) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number):
        return None
    return round(number, places)


def build(summary: dict) -> dict:
    rows: dict[str, dict[str, float]] = {}
    for stock in summary.get("stocks") or []:
        ric = str(stock.get("c") or "").strip()
        if not ric:
            continue
        facts = {}
        for key, places in FIELDS:
            number = _num(stock.get(key), places)
            if number is not None:
                facts[key] = number
        if facts:
            rows[ric] = facts
    as_of = str((summary.get("meta") or {}).get("as_of") or "")
    return {"as_of": as_of, "n": len(rows), "rows": rows}


def main() -> None:
    if not SUMMARY.is_file():
        raise SystemExit(f"봉인 summary 가 없습니다: {SUMMARY}")
    payload = build(open_sealed(SUMMARY.read_bytes()))
    if not payload["as_of"]:
        raise SystemExit("summary meta.as_of 가 비어 있습니다.")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    print(f"as_of {payload['as_of']} n {payload['n']} → {OUT}")


if __name__ == "__main__":
    main()
