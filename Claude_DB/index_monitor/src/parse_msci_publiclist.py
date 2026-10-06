"""MSCI 공개 편출입 리스트(PublicList PDF) 파서.

MSCI는 정기변경마다 국가별 Additions/Deletions 를 2열 PDF로 공개한다.
  예) https://app2.msci.com/eqb/gimi/stdindex/MSCI_Aug26_STPublicList.pdf  (Standard)
      ...MSCI_Aug26_SCPublicList.pdf (Small Cap) 등 — 파일명 규칙: MSCI_{Mon}{YY}_{세그먼트}PublicList.pdf

입력: PDF 경로 또는 이미 추출한 텍스트(.txt)
출력: 행 단위 dict (country_index, action, security_name_raw)

주의: PDF에는 티커/ISIN 이 없다. security_map(이름→ISIN/KRX코드) 매핑 단계가 별도로 필요하다.
라이선스: PDF 하단 고지문은 정보로 데이터베이스 생성을 금지한다. 내부 리서치용으로만 적재하고,
외부 게시(홈페이지 등)는 MSCI 라이선스 확인 후 진행할 것.
"""
from __future__ import annotations

import csv
import re
import sys
from pathlib import Path

HEADER_RE = re.compile(r"^MSCI (.+?) INDEX\s*$")
SKIP_RE = re.compile(r"^(Page \d+|Additions\s+Deletions|Geneva|MSCI GLOBAL|The following|which will)")


def read_text(path: Path) -> str:
    if path.suffix.lower() == ".pdf":
        import pdfplumber  # pip install pdfplumber

        with pdfplumber.open(path) as pdf:
            # layout=True 로 2열 간격을 보존해야 열 분리가 된다
            return "\n".join(p.extract_text(layout=True) or "" for p in pdf.pages)
    return path.read_text(encoding="utf-8")


def parse(text: str) -> list[dict]:
    rows, country = [], None
    for raw in text.splitlines():
        line = raw.rstrip()
        if not line.strip():
            continue
        m = HEADER_RE.match(line.strip())
        if m:
            country = m.group(1).title()
            continue
        if country is None or SKIP_RE.match(line.strip()):
            continue
        if re.match(r"^\s{20,}\S", line):  # 왼쪽 열 비어 있음 → 편출만
            left, right = "", line.strip()
        else:
            parts = re.split(r"\s{3,}", line.strip(), maxsplit=1)
            left, right = parts[0], (parts[1] if len(parts) > 1 else "")
        for action, name in (("ADD", left), ("DEL", right)):
            name = re.sub(r"\s{2,}", " ", name).strip()
            if name and name != "None":
                rows.append({"country_index": f"MSCI {country}", "action": action, "security_name_raw": name})
    return rows


def main() -> None:
    src = Path(sys.argv[1])
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else src.with_suffix(".csv")
    rows = parse(read_text(src))
    with out.open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=["country_index", "action", "security_name_raw"])
        w.writeheader()
        w.writerows(rows)
    print(f"{len(rows)} rows → {out}")


if __name__ == "__main__":
    main()
