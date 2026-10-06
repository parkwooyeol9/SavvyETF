"""python -m unittest discover -s Claude_DB/tests -t ."""
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

from Claude_DB.factor import config as C
from Claude_DB.factor import engine as E

XLSX = Path(__file__).resolve().parents[1] / "data" / "ACWI_raw.xlsx"
OLD = Path(__file__).resolve().parents[1] / "data" / "archive" / "ACWI_raw_2026-09-30_local.xlsx"


class TestPieces(unittest.TestCase):
    def test_trimmean_matches_excel(self):
        # Excel TRIMMEAN({1..20}, 0.1) → 양쪽 1개씩 제거 → 10.5
        self.assertAlmostEqual(E._trimmean(np.arange(1, 21, dtype=float), 0.1), 10.5)

    def test_sector_z_zero_mean_unit_sd(self):
        s = pd.Series(np.r_[np.arange(20.0), np.arange(20.0) * 3])
        g = pd.Series(["A"] * 20 + ["B"] * 20)
        z, _ = E.sector_z(s, g)
        for k in "AB":
            self.assertAlmostEqual(z[g == k].mean(), 0, places=9)
            self.assertAlmostEqual(z[g == k].std(ddof=1), 1, places=9)

    def test_growth_turnaround_is_nan(self):
        g = E._growth(pd.Series([2.0, -1.0, 1.0]), pd.Series([1.0, 1.0, -1.0]))
        self.assertAlmostEqual(g[0], 100.0)
        self.assertTrue(np.isnan(g[1]) and np.isnan(g[2]))


@unittest.skipUnless(XLSX.exists(), "data/ACWI_raw.xlsx 없음")
class TestPipeline(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.d, cls.stats, cls.ex, cls.raw = E.run(str(XLSX))

    def test_universe(self):
        self.assertGreater(len(self.d), 2000)
        self.assertTrue(self.d["code"].is_unique)
        self.assertTrue((self.d["wgt"] > 0).all())

    def test_factor_scores_standardized(self):
        for k in C.FACTOR_KEYS:
            f = self.d[f"f_{k}"]
            self.assertLessEqual(f.abs().max(), C.Z_CLIP + 1e-9)
            self.assertLess(abs(f.mean()), 0.05)
        self.assertAlmostEqual(self.d["composite"].std(ddof=1), 1, places=6)

    def test_currency_fix_uk(self):
        shel = self.d.set_index("code").loc["SHEL.L"]
        self.assertTrue(4 < shel["pe"] < 25, shel["pe"])           # 원값 714배 → 보정 후 한 자릿수~10배대

    def test_size_uses_usd(self):
        x = self.d.set_index("code")
        # 삼성전자(KRW)가 엔비디아(USD)보다 '크게' 나오면 통화 미보정
        self.assertLess(x.loc["005930.KS", "mcap_usd_mn"], x.loc["NVDA.OQ", "mcap_usd_mn"])
        self.assertTrue(4e5 < x.loc["005930.KS", "mcap_usd_mn"] < 3e6)

    def test_valuation_sane(self):
        x = self.d.set_index("code")
        for code, lo, hi in [("2330.TW", 8, 40), ("005930.KS", 2, 30), ("7203.T", 4, 30), ("AAPL.OQ", 15, 60)]:
            self.assertTrue(lo < x.loc[code, "pe"] < hi, (code, x.loc[code, "pe"]))


@unittest.skipUnless(OLD.exists(), "구버전(현지통화) 파일 없음")
class TestOldFile(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.d, *_ = E.run(str(OLD))

    def test_currency_fix_uk(self):
        shel = self.d.set_index("code").loc["SHEL.L"]
        self.assertTrue(4 < shel["pe"] < 25, shel["pe"])

    def test_original_replication(self):
        # 원본 엑셀 캐시값(4~22행)과 원본 로직 재현값 비교: 가치·사이즈·퀄리티
        nv = self.d.set_index("code").loc["NVDA.OQ"]
        self.assertAlmostEqual(nv["o_value"], -0.174537, places=5)
        self.assertAlmostEqual(nv["o_size"], 0.066764, places=5)
        self.assertAlmostEqual(nv["o_quality"], 0.188615, places=5)


if __name__ == "__main__":
    unittest.main()


class TestIntakeHeaders(unittest.TestCase):
    """새 파일 요청식이 바뀌어도(열 이동·~U$·수익률 변동성) 필드를 찾는지."""

    def test_detect_shifted_usd_header(self):
        import pandas as pd
        from Claude_DB.factor import engine as E
        r1 = [None] * 12 + ["TR.CommonName", "TR.GICSsector", "TR.EPSMeanEstimate(Period=CY2026)",
                            "TR.EPSMeanEstimate(Period=CY2027)", "TR.EPSMeanEstimate(Period=CY2028)"]
        r3 = ["Wgt", "코드", "NEW COL", "X~U$", "X(MV)~U$", "PCH#(X(RI)~U$,1M)", "PCH#(X(RI)~U$,12M)",
              "X(EPS1FD12)~U$", "X(BPS1FD12)~U$", "X(DPS1FD12)~U$", "SDN#(LN(X/LAG#(X,1D)),1Y)", "RIC"] + [None] * 5
        cm, info = E.detect_columns([r1, [None] * 17, r3])
        self.assertEqual(cm["price"], 3)
        self.assertEqual(cm["ret_12m"], 6)
        self.assertEqual(cm["eps_cy27"], 16)          # 연도순 마지막 = y2 슬롯
        self.assertEqual(info["years"]["eps"], [2026, 2027, 2028])
        self.assertEqual(E.vol_kind(info["header"]["px_sd_1y"]), "return")
        self.assertEqual(E.vol_kind("SDN#(X 1Y)"), "price_level")

    def test_vol_units(self):
        import numpy as np
        import pandas as pd
        from Claude_DB.factor import engine as E
        px = pd.Series([100.0] * 3)
        self.assertAlmostEqual(E.vol_pct(pd.Series([0.02] * 3), px, "return").iloc[0], 2 * np.sqrt(252), places=6)
        self.assertAlmostEqual(E.vol_pct(pd.Series([30.0] * 3), px, "return").iloc[0], 30.0)
        self.assertAlmostEqual(E.vol_pct(pd.Series([10.0] * 3), px, "price_level").iloc[0], 10.0)
