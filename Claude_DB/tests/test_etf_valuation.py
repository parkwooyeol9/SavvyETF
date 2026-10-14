"""밸류에이션 탭 ETF 조립(factor/etf_valuation.py) 단위 테스트 (합성 데이터).

python -m unittest discover -s Claude_DB/tests -t .
"""
import unittest
from unittest import mock

import numpy as np
import pandas as pd

from Claude_DB.factor import etf_valuation as EV
from Claude_DB.factor import groups as G
from Claude_DB.tests.test_groups import _setup


class TestEtfValuation(unittest.TestCase):
    def test_cap_weights(self):
        v = EV.cap_weights(np.array([70.0, 20.0, 10.0, 0.0]), 40)
        self.assertAlmostEqual(v.sum(), 100.0)
        self.assertAlmostEqual(v[0], 40.0)
        self.assertAlmostEqual(v[1] / v[2], 2.0)            # 나머지는 원래 비율대로
        self.assertEqual(v[3], 0.0)

    def test_rule_mask(self):
        d, _ = _setup()
        cl = G.classify(d)
        gm = {"theme:x": np.array([True, False, False])}
        self.assertEqual(EV._rule_mask(cl, {"country": "미국", "sector_ko": "IT"}, gm).tolist(), [True, False, False])
        self.assertEqual(EV._rule_mask(cl, {"sector_ko": "IT", "exclude_industry": ["Software"]}, gm).tolist(), [False, False, True])
        self.assertEqual(EV._rule_mask(cl, {"groups": ["theme:x"]}, gm).tolist(), [True, False, False])

    def test_low_coverage_falls_back_or_drops(self):
        d, _ = _setup()
        cl = G.classify(d)
        mapped = [
            {"ticker": "GOOD", "issuer": "iShares", "category": "국가", "label": "g", "compare": None, "asof": "20261012",
             "coverage": 95.0, "n_holdings": 2, "weights": {"A": 60.0, "B": 35.0}},
            {"ticker": "IHAK", "issuer": "iShares", "category": "테마", "label": "cyber", "compare": None, "asof": "20261012",
             "coverage": 20.0, "n_holdings": 30, "weights": {"A": 20.0}},
            {"ticker": "LOW", "issuer": "SPDR", "category": "테마", "label": "low", "compare": None, "asof": "20261012",
             "coverage": 10.0, "n_holdings": 50, "weights": {"C": 10.0}},
        ]
        gm = {g["id"]: g["mask"] for g in G._group_defs(cl)} | {"theme:cyber": np.array([True, False, True])}
        with mock.patch.object(EV.X, "load_mapped", return_value=mapped), mock.patch.object(EV, "PROXIES", []), \
                mock.patch.object(EV, "UNAVAILABLE", []):
            etfs, dropped = EV._entries(cl, gm)
        by = {e["ticker"]: e for e in etfs}
        self.assertEqual(by["GOOD"]["method"], "보유종목")
        self.assertEqual(by["IHAK"]["method"], "ACWI 근사")                 # 커버리지 낮음 → 테마 근사
        self.assertAlmostEqual(by["IHAK"]["vec"].sum(), 100.0)
        self.assertEqual([x["ticker"] for x in dropped], ["LOW"])


if __name__ == "__main__":
    unittest.main()
