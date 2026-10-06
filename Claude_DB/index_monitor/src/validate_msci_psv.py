"""MSCI 편출입 PSV(T/S/A/D 라인) 검증: 국가별 A/D 개수 == 요약표(S) 값인지 확인.

    python src/validate_msci_psv.py                # data/raw/msci/web_psv/*.psv 전체
    python src/validate_msci_psv.py MSCI_Feb26_ST.psv

PSV 형식 (웹 수집본·PDF 파싱본 공통)
  T|Geneva, February 10, 2026
  S|<COUNTRY>|<added>|<deleted>
  A|<COUNTRY>|<security name as printed>
  D|<COUNTRY>|<security name as printed>
"""
from __future__ import annotations

import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PSV_DIR = ROOT / "data/raw/msci/web_psv"


def norm_country(c: str) -> str:
    return " ".join(c.upper().replace("&", "AND").split())


def load(path: Path) -> dict:
    title, summary, rows = None, {}, []
    for line in path.read_text(encoding="utf-8").splitlines():
        parts = [p.strip() for p in line.split("|")]
        if not parts or not parts[0]:
            continue
        k = parts[0]
        if k == "T":
            title = parts[1]
        elif k == "S" and len(parts) >= 4:
            summary[norm_country(parts[1])] = (int(parts[2]), int(parts[3]))
        elif k in ("A", "D") and len(parts) >= 3 and parts[2] and parts[2].upper() != "NONE":
            rows.append((k, norm_country(parts[1]), parts[2]))
    return {"title": title, "summary": summary, "rows": rows}


def check(path: Path) -> list[str]:
    d = load(path)
    c = Counter((a, ctry) for a, ctry, _ in d["rows"])
    errs = []
    for ctry in sorted(set(d["summary"]) | {ctry for _, ctry in c}):
        exp = d["summary"].get(ctry, (0, 0))
        got = (c[("A", ctry)], c[("D", ctry)])
        if exp != got:
            errs.append(f"{ctry}: summary {exp} vs listed {got}")
    dup = [k for k, v in Counter(d["rows"]).items() if v > 1]
    if dup:
        errs.append(f"duplicates: {dup[:5]}")
    return errs


def main(args: list[str]) -> int:
    files = [PSV_DIR / a for a in args] if args else sorted(PSV_DIR.glob("*.psv"))
    bad = 0
    for f in files:
        d = load(f)
        errs = check(f)
        tot = sum(1 for r in d["rows"] if r[0] == "A"), sum(1 for r in d["rows"] if r[0] == "D")
        stot = tuple(map(sum, zip(*d["summary"].values()))) if d["summary"] else (0, 0)
        flag = "OK " if not errs else "ERR"
        print(f"{flag} {f.name:28s} listed A/D={tot}  summary={stot}  {d['title']}")
        for e in errs:
            print("     ", e)
        bad += bool(errs)
    print(f"{len(files) - bad}/{len(files)} files consistent")
    return bad


if __name__ == "__main__":
    sys.exit(1 if main(sys.argv[1:]) else 0)
