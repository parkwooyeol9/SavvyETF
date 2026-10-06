"""로컬에 받은 MSCI PublicList PDF → PSV(T/S/A/D) 변환 + 요약표 대조.

    python src/pdf_to_psv.py                 # data/raw/msci/pdf/*.pdf 전부
    python src/pdf_to_psv.py MSCI_Feb19_STPublicList.pdf

출력: data/raw/msci/pdf_psv/MSCI_{Tag}_ST.psv  (msci_pit.py 가 웹 수집본보다 우선 사용)
요약표(SUMMARY PER COUNTRY)와 국가별 개수가 다르면 ERR 로 표시한다 → 해당 PDF만 눈으로 확인.
"""
from __future__ import annotations

import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PDF_DIR = ROOT / "data/raw/msci/pdf"
OUT_DIR = ROOT / "data/raw/msci/pdf_psv"

HEADER_RE = re.compile(r"^\s*MSCI\s+(.+?)\s+INDEX\s*$")
SUMMARY_ROW = re.compile(r"^\s*(?:Asia Pacific|Europe, Middle East (?:and|&) Africa|Americas)?\s*"
                         r"([A-Z][A-Z .&'\-]*?[A-Z])\s*(\d+)\s+(\d+)\s*$")
DATE_RE = re.compile(r"^\s*([A-Z][a-z]+,\s+[A-Z][a-z]+ \d{1,2},\s*\d{4})")
SKIP = re.compile(r"^\s*(Page \d+|Additions\s+Deletions|MSCI GLOBAL|The following|which will|SUMMARY|Region|Nb of|Securities|"
                  r"Notice and Disclaimer|©|ASIA PACIFIC\s*$|EUROPE, MIDDLE EAST|AMERICAS\s*$)", re.I)


def extract_lines(pdf: Path) -> list[list[tuple[float, str]]]:
    """페이지별 단어를 줄 단위로 묶어 [(x0, word), ...] 리스트로 반환 (좌표 기반 열 분리용)."""
    import pdfplumber

    out = []
    with pdfplumber.open(pdf) as doc:
        for page in doc.pages:
            rows: dict[int, list] = {}
            for w in page.extract_words(x_tolerance=1.5, y_tolerance=2, keep_blank_chars=False):
                key = round(w["top"] / 2)
                k = next((k for k in (key, key - 1, key + 1) if k in rows), key)
                rows.setdefault(k, []).append((w["x0"], w["x1"], w["text"]))
            for k in sorted(rows):
                out.append(sorted(rows[k]))
    return out


def _join(words) -> str:
    """단어 간격이 넓으면(>6pt) 3칸 공백으로 이어 붙여 요약표·헤더 정규식이 기존처럼 동작하게 한다."""
    s, prev = "", None
    for x0, x1, t in words:
        if prev is not None:
            s += "   " if x0 - prev > 6 else " "
        s += t
        prev = x1
    return s


def to_psv(rows) -> tuple[list[str], dict, Counter]:
    lines, summary, counts = [], {}, Counter()
    title, country, in_summary, del_x = None, None, False, None
    for words in rows:
        line = _join(words)
        if not line.strip():
            continue
        if line.strip().startswith("Notice and Disclaimer"):
            break
        if title is None and (m := DATE_RE.match(line)):
            title = m.group(1)
            continue
        if "SUMMARY PER COUNTRY" in line.upper():
            in_summary = True
            continue
        m = HEADER_RE.match(line)
        if m and not line.strip().upper().startswith("MSCI GLOBAL"):
            in_summary, country = False, " ".join(m.group(1).upper().split())
            continue
        if in_summary:
            if (m := SUMMARY_ROW.match(line)) and m.group(1).upper() not in ("NB OF", "SECURITIES"):
                summary[" ".join(m.group(1).upper().split())] = (int(m.group(2)), int(m.group(3)))
            continue
        texts = [w[2] for w in words]
        if "Deletions" in texts and "Additions" in texts:
            del_x = words[texts.index("Deletions")][0]
            continue
        if country is None or del_x is None or SKIP.match(line):
            continue
        left = " ".join(t for x0, _, t in words if x0 < del_x - 3)
        right = " ".join(t for x0, _, t in words if x0 >= del_x - 3)
        for act, name in (("A", left), ("D", right)):
            name = name.strip()
            if name and name.upper() != "NONE":
                lines.append(f"{act}|{country}|{name}")
                counts[(act, country)] += 1
    head = [f"T|{title or ''}"] + [f"S|{c}|{a}|{d}" for c, (a, d) in summary.items()]
    return head + lines, summary, counts


# PDF 원문 표기 보정 (개수는 요약표와 일치하나 이름이 깨진 경우만). (tag, 원문 줄) -> 보정 줄
NAME_FIXES = {
    ("Aug23", "A|INDIA|CUMMINS INDIA KIRLOSKAR"): "A|INDIA|CUMMINS INDIA",
}


def convert(pdf: Path) -> bool:
    tag = pdf.name.split("_")[1]
    psv, summary, counts = to_psv(extract_lines(pdf))
    psv = [NAME_FIXES.get((tag, l), l) for l in psv]
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / f"MSCI_{tag}_ST.psv").write_text("\n".join(psv) + "\n", encoding="utf-8")
    bad = [c for c in set(summary) | {c for _, c in counts}
           if summary.get(c, (0, 0)) != (counts[("A", c)], counts[("D", c)])]
    na, nd = sum(v for (a, _), v in counts.items() if a == "A"), sum(v for (a, _), v in counts.items() if a == "D")
    print(f"{'OK ' if not bad and summary else 'ERR'} {tag}: A/D={na}/{nd} summary_countries={len(summary)} "
          + (f"mismatch={bad[:6]}" if bad else ""))
    return not bad and bool(summary)


if __name__ == "__main__":
    files = [PDF_DIR / a for a in sys.argv[1:]] or sorted(PDF_DIR.glob("MSCI_*_STPublicList.pdf"))
    ok = sum(convert(f) for f in files)
    print(f"{ok}/{len(files)} PDFs consistent with their summary tables")
