"""ETF 룩스루 매칭·가중 집계 단위 테스트 (합성 데이터, 네트워크·원자료 불필요).

python -m unittest discover -s Claude_DB/tests -t .
"""
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pandas as pd

from Claude_DB.factor import etf_lookthrough as X
from Claude_DB.factor import groups as G
from Claude_DB.tests.test_groups import _setup


def _uni():
    rows = [("AAPL.OQ", "Apple Inc.", "미국", "US0378331005", 0.04), ("BRKb.N", "Berkshire Hathaway Inc", "미국", None, 0.01),
            ("META.OQ", "Meta Platforms, Inc.", "미국", None, 0.02), ("7203.T", "TOYOTA MOTOR CORPORATION", "일본", None, 0.002),
            ("0700.HK", "Tencent Holdings Limited", "중국", None, 0.01), ("ERICb.ST", "Telefonaktiebolaget LM Ericsson", "스웨덴", None, 0.001),
            ("LVMH.PA", "Lvmh Moet Hennessy Louis Vuitton SE", "프랑스", None, 0.005),
            ("AIRP.PA", "L'Air Liquide Societe Anonyme pour l'Etude et l'Exploitation des Procedes Georges Claude", "프랑스", None, 0.004),
            ("1919.HK", "COSCO Shipping Holdings Co Ltd", "중국", None, 0.0005), ("PTT_n.BK", "PTT Public Company Limited", "태국", None, 0.0003)]
    p = Path(tempfile.mkdtemp()) / "u.csv"
    pd.DataFrame(rows, columns=["code", "name", "country", "isin", "wgt"]).to_csv(p, index=False)
    return X.Universe(p)


def _r(ticker, name, exchange, location, cusip=None):
    return SimpleNamespace(ticker=ticker, name=name, exchange=exchange, location=location, cusip=cusip)


class TestMatch(unittest.TestCase):
    def test_cusip_to_isin(self):
        self.assertEqual(X.cusip_to_isin("037833100"), "US0378331005")      # Apple
        self.assertEqual(X.cusip_to_isin("594918104"), "US5949181045")      # Microsoft

    def test_ticker_and_name_rules(self):
        u = _uni()
        cases = [
            (_r("AAPL", "APPLE INC", "US", "United States", "037833100"), "AAPL.OQ", "isin"),
            (_r("BRKB", "BERKSHIRE HATHAWAY INC CLASS B", "New York Stock Exchange Inc.", "United States"), "BRKb.N", "ticker"),
            (_r("7203", "TOYOTA MOTOR CORP", "Tokyo Stock Exchange", "Japan"), "7203.T", "ticker"),
            (_r("700", "TENCENT HOLDINGS LTD", "Hong Kong Exchanges And Clearing Ltd", "China"), "0700.HK", "ticker"),
            (_r("ERIC B", "ERICSSON B", "Nasdaq Omx Nordic", "Sweden"), "ERICb.ST", "ticker"),     # 북유럽 Nasdaq ≠ 미국
            (_r("PTT.R", "PTT NON-VOTING DR", "Stock Exchange Of Thailand", "Thailand"), "PTT_n.BK", "ticker"),
            (_r("MC", "LVMH", "Nyse Euronext - Euronext Paris", "France"), "LVMH.PA", "alias"),
            (_r("AI", "LAIR LIQUIDE SOCIETE ANONYME POUR", "Nyse Euronext - Euronext Paris", "France"), "AIRP.PA", "name"),
        ]
        for r, code, how in cases:
            c, m = u.match(r)
            self.assertEqual(c, code, r.name)
            self.assertTrue(m.startswith(how), (r.name, m))

    def test_rejects_lookalikes(self):
        u = _uni()
        for r in (_r("MTUS", "METALLUS INC", "NYSE", "United States"),                     # META 접두
                  _r("1199", "COSCO SHIPPING PORTS LTD", "Hong Kong Exchanges And Clearing Ltd", "China")):
            self.assertIsNone(u.match(r)[0], r.name)


class TestEtfAggregate(unittest.TestCase):
    def test_weighted_membership_equals_index_formula(self):
        d, ts = _setup()
        cl = G.classify(d)
        Pu, _ = G._stock_panels(d.assign(wgt=1.0), ts)
        vec = np.array([60.0, 40.0, 0.0])                 # ETF: A 60%, B 40%
        A = G.aggregate(Pu, vec[:, None], np.array([2.0]))
        # PER = Σw / Σ(w·E/P) = 100 / (60·0.05 + 40·0.1)
        self.assertAlmostEqual(A["pe"][-1, 0], 100 / (60 * 0.05 + 40 * 0.1), places=6)
        self.assertEqual(A["n"][-1, 0], 2)               # 개수는 비중이 아니라 종목 수
        self.assertAlmostEqual(A["cov"][-1, 0], 100.0)


if __name__ == "__main__":
    unittest.main()
