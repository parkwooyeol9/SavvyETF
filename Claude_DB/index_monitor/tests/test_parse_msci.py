"""MSCI 파서 회귀 테스트: 2026-08 Standard 리스트의 국가별 편입/편출 수가 MSCI 요약표와 같아야 한다.

실행: python -m pytest tests/  (또는 python tests/test_parse_msci.py)
새 리뷰를 추가하면 EXPECTED 에 그 리뷰의 요약표(SUMMARY PER COUNTRY) 값을 넣어 같은 검증을 걸 것.
"""
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))
from parse_msci_publiclist import parse, read_text  # noqa: E402

EXPECTED_AUG26 = {
    "Australia": (0, 4), "Japan": (1, 2), "Indonesia": (0, 2), "Philippines": (0, 1), "Taiwan": (6, 6),
    "Korea": (1, 4), "India": (4, 3), "China": (33, 32), "Singapore": (0, 1), "Denmark": (0, 1),
    "France": (0, 1), "Germany": (0, 2), "Netherlands": (0, 1), "United Kingdom": (1, 1), "Greece": (1, 0),
    "Turkey": (1, 0), "Sweden": (0, 4), "Saudi Arabia": (0, 5), "United Arab Emirates": (1, 0),
    "Qatar": (0, 1), "Usa": (6, 18), "Canada": (0, 2), "Brazil": (0, 1),
}


def test_aug26_counts_match_msci_summary():
    rows = parse(read_text(ROOT / "data/raw/msci/MSCI_Aug26_STPublicList.txt"))
    c = Counter((r["country_index"].replace("MSCI ", ""), r["action"]) for r in rows)
    for country, (add, dele) in EXPECTED_AUG26.items():
        assert (c[(country, "ADD")], c[(country, "DEL")]) == (add, dele), country
    assert sum(v for (_, a), v in c.items() if a == "ADD") == 55  # 보도자료 ACWI 편입 수
    assert sum(v for (_, a), v in c.items() if a == "DEL") == 92  # 보도자료 ACWI 편출 수


if __name__ == "__main__":
    test_aug26_counts_match_msci_summary()
    print("ok")
