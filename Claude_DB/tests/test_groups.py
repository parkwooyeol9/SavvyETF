"""국가·섹터·테마 집계(factor/groups.py) 단위 테스트 (합성 데이터, 원자료 불필요).

python -m unittest discover -s Claude_DB/tests -t .
"""
import unittest
from types import SimpleNamespace

import numpy as np
import pandas as pd

from Claude_DB.factor import groups as G
from Claude_DB.factor import themes as TH


def _setup(n=25):
    months = pd.date_range("2024-10-01", periods=n, freq="MS")
    codes = ["A", "B", "C"]
    d = pd.DataFrame({
        "code": codes, "name": ["a", "b", "c"], "country": ["미국", "미국", "한국"],
        "region": ["미국", "미국", "신흥"], "sector": ["Information Technology", "Financials", "Information Technology"],
        "sector_ko": ["IT", "금융", "IT"],
        "industry": ["Software", "Banks", "Semiconductors & Semiconductor Equipment"],
        "wgt": [0.5, 0.3, 0.2], "px_usd": [100.0, 50.0, 10.0], "mcap_usd_mn": [1000.0, 600.0, 400.0],
        "eps_ntm": [5.0, 5.0, 2.0], "bps_ntm": [20.0, 50.0, -1.0], "dps_ntm": [1.0, 2.0, 0.0],
        "sales_usd_mn": [500.0, 300.0, 800.0], "data_flag": ["", "", ""],
        **{f"eps_cy{y}": [4.0, 5.0, 1.0] for y in (25, 26, 27)},
        **{f"rev_cy{y}": [400.0, 300.0, 700.0] for y in (25, 26, 27)},
    })
    flat = pd.DataFrame(1.0, index=months, columns=codes)
    eps = flat.copy()
    eps["A"] = [1.0] * (n - 12) + [2.0] * 12          # A: 12개월 전 대비 이익 2배
    ts = SimpleNamespace(ri_m=flat * 100, eps=eps, bps=flat.copy(), dps=flat.copy(), sal=flat.copy())
    return d, ts


class TestGroups(unittest.TestCase):
    def test_index_style_pe_and_growth(self):
        d, ts = _setup()
        cl = G.classify(d)
        P, info = G._stock_panels(d, ts)
        M = np.stack([cl["sector_ko"].eq("IT"), cl["country"].eq("미국")], axis=1).astype(float)
        A = G.aggregate(P, M, M.sum(axis=0))
        # 현재 IT PER = Σw / Σ(w·E/P) = 0.7 / (0.5·0.05 + 0.2·0.2)
        self.assertAlmostEqual(A["pe"][-1, 0], 0.7 / (0.5 * 0.05 + 0.2 * 0.2), places=6)
        # 1년 전 A 이익은 절반 → 과거 PER 상승, YoY 성장 = (0.025+0.04)/(0.0125+0.04) − 1
        self.assertAlmostEqual(A["eg"][-1, 0], ((0.025 + 0.04) / (0.0125 + 0.04) - 1) * 100, places=4)
        # PBR: C 는 자본잠식(BPS<0) → 제외, 미국 = Σw / Σ(w·B/P)
        self.assertAlmostEqual(A["pb"][-1, 1], 0.8 / (0.5 * 0.2 + 0.3 * 1.0), places=6)
        # 배당수익률 = ΣD / ΣW (%), C 무배당 0 포함
        self.assertAlmostEqual(A["dy"][-1, 0], (0.5 * 0.01 + 0) / 0.7 * 100, places=6)
        self.assertEqual(A["cov"][-1, 0], 100.0)
        self.assertAlmostEqual(A["tr"][-1, 0], 100.0)

    def test_pe_blank_when_earnings_cancel(self):
        d, ts = _setup()
        d.loc[d["code"] == "C", "eps_ntm"] = -1.95             # A 흑자 + C 적자가 거의 상쇄 → ΣE ≈ 0
        P, _ = G._stock_panels(d, ts)
        M = np.array([[1.0], [0.0], [1.0]])
        A = G.aggregate(P, M, np.array([2.0]))
        self.assertTrue(np.isnan(A["pe"][-1, 0]))

    def test_drift_cap_limits_recap_weight(self):
        d, ts = _setup()
        ri = ts.ri_m.copy()
        ri.loc[ri.index[:6], "B"] = 100 * 1000            # 과거 가격이 1,000배 (대규모 증자·감자)
        ts.ri_m = ri
        P, info = G._stock_panels(d, ts)
        self.assertEqual(info["drift_capped_stocks"], 1)
        yrs = (ts.eps.index[-1] - ts.eps.index[0]).days / 365.25
        prel = 1000 * 1.04 ** yrs                         # RI 배당 재투자분 제거 (배당수익률 4%)
        self.assertLess(P["W"][0, 1] / 0.3, G.DRIFT_CAP * 1.1)   # 시장 중앙값(≈1) × 상한
        # 종목 자체 PER(W/E = 가격/EPS)은 보존: prel ÷ (E/P = 0.1)
        self.assertAlmostEqual(P["W"][0, 1] / P["E"][0, 1] / (prel / 0.1), 1.0, places=6)

    def test_clean_breaks(self):
        idx = pd.date_range("2025-01-01", periods=6, freq="MS")
        df = pd.DataFrame({"X": [1000, 1000, 1, 1, 1.1, 1.2], "Y": [1, 1.2, 1.3, 1.1, 1.4, 1.5]}, index=idx)
        out, n = G.clean_breaks(df, np.log(4))
        self.assertEqual(n, 1)
        self.assertTrue(out["X"].iloc[:2].isna().all())
        self.assertEqual(out["Y"].tolist(), df["Y"].tolist())

    def test_themes_and_industry_map(self):
        d, _ = _setup()
        cl = G.classify(d)
        self.assertIn("software", cl.set_index("code").at["A", "themes"])
        self.assertIn("semi_all", cl.set_index("code").at["C", "themes"])
        self.assertEqual(cl.set_index("code").at["B", "igroup"], "은행")
        for k, t in TH.THEMES.items():
            self.assertTrue(t.get("codes") or t.get("industries"), k)
            for ind in t.get("industries", []):
                self.assertIn(ind, TH.INDUSTRY, f"{k}: {ind}")


if __name__ == "__main__":
    unittest.main()
