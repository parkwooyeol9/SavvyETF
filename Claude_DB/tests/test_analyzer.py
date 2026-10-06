"""시계열·기술적 지표·MSCI 연동 단위 테스트 (합성 데이터, 원자료 불필요).

python -m unittest discover -s Claude_DB/tests -t .
"""
import sys
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

from Claude_DB.factor import fundamentals_ts as FT
from Claude_DB.factor import index_link as L
from Claude_DB.factor import technicals as TE
from Claude_DB.factor import timeseries as T


def _ri(n=400, seed=0, codes=("A", "B", "C")):
    rng = np.random.default_rng(seed)
    idx = pd.bdate_range("2024-01-01", periods=n)
    r = rng.normal(0.0005, 0.01, (n, len(codes)))
    return pd.DataFrame(100 * np.exp(np.cumsum(r, axis=0)), index=idx, columns=list(codes))


class TestTimeseries(unittest.TestCase):
    def test_cut_stale_tail(self):
        # 월간 3행 뒤에 이전 일간 값(날짜 역행)이 남은 경우
        idx = [pd.Timestamp("2026-08-01"), pd.Timestamp("2026-09-01"), pd.Timestamp("2026-10-01"),
               pd.Timestamp("2023-11-21"), pd.Timestamp("2023-11-22")]
        df = pd.DataFrame({"X": [1, 2, 3, 99, 98]}, index=idx)
        out, dropped = T._cut_stale_tail(df)
        self.assertEqual(dropped, 2)
        self.assertEqual(out["X"].tolist(), [1, 2, 3])


class TestTechnicals(unittest.TestCase):
    def test_returns_and_ranges(self):
        ri = _ri()
        tech, bench = TE.compute(ri, pd.Series({"A": 0.5, "B": 0.3, "C": 0.2}))
        for c in ri:
            exp = (ri[c].iloc[-1] / ri[c].iloc[-1 - 21] - 1) * 100
            self.assertAlmostEqual(tech.at[c, "r_1m"], exp, places=8)
        self.assertTrue(tech["rsi14"].between(0, 100).all())
        self.assertTrue((tech["mdd_1y"] <= 0).all() and (tech["dd_52w"] <= 0).all())
        self.assertTrue(tech["tech_score"].between(0, 6).all())
        self.assertAlmostEqual(tech["vol_1y"].median(), 100 * 0.01 * np.sqrt(252), delta=3)

    def test_beta_of_benchmark_itself_is_one(self):
        ri = _ri(codes=("A",))
        tech, _ = TE.compute(ri, pd.Series({"A": 1.0}))
        self.assertAlmostEqual(tech.at["A", "beta_1y"], 1.0, places=6)

    def test_rsi_monotone_series(self):
        px = pd.DataFrame({"U": np.arange(1, 60, dtype=float)})
        self.assertAlmostEqual(TE._rsi(px).iloc[-1, 0], 100.0)

    def test_suspended_flag(self):
        ri = _ri()
        ri.iloc[-30:, 0] = ri.iloc[-31, 0]
        tech, _ = TE.compute(ri, pd.Series({"A": 1, "B": 1, "C": 1}))
        self.assertTrue(tech.at["A", "suspended"])
        self.assertTrue(np.isnan(tech.at["A", "tech_score"]))


class TestFundamentals(unittest.TestCase):
    def test_revision_and_pe_band_anchor(self):
        ri = _ri(n=800)
        months = pd.date_range("2023-10-01", periods=37, freq="MS")
        eps = pd.DataFrame({c: np.linspace(1, 2, 37) for c in ri}, index=months)
        ts = T.TimeSeries(ri=ri, eps=eps, bps=eps * 10, dps=eps * 0.3)
        cur = pd.DataFrame({"pe": [20.0, 15.0, 10.0], "pb": [2.0, 1.5, 1.0], "dy": [1.0, 2.0, 3.0]}, index=list(ri))
        out, charts = FT.compute(ts, cur)
        self.assertAlmostEqual(out.at["A", "eps_rev_12m"], (eps["A"].iloc[-1] / eps["A"].iloc[-13] - 1) * 100)
        # 마지막 달 근사 PER = 현재 PER
        self.assertAlmostEqual(charts["pe"]["A"].iloc[-1], 20.0, places=6)
        self.assertTrue(out["pe_pct_3y"].between(0, 100).all())


class TestIndexLink(unittest.TestCase):
    def test_auc(self):
        self.assertAlmostEqual(L.auc(pd.Series([1, 2, 3, 4]), pd.Series([0, 0, 1, 1])), 1.0)
        self.assertAlmostEqual(L.auc(pd.Series([4, 3, 2, 1]), pd.Series([0, 0, 1, 1])), 0.0)

    def test_size_tail_company_level(self):
        st = pd.DataFrame({"code": ["BIG", "FOXA", "FOX", "SML"], "name": ["Big Co", "Fox Corp Class A", "Fox Corp Class B", "Small"],
                           "country": ["US"] * 4, "wgt": [0.80, 0.08, 0.07, 0.05]})
        t = L.size_tail(st)
        self.assertEqual(t["FOX"], t["FOXA"])              # 같은 회사 → 같은 위치
        self.assertGreater(t["SML"], t["FOX"])              # 회사 합산(0.15)이 SML(0.05)보다 커서 앞

    def test_size_tail_ties_ignore_row_order(self):
        st = pd.DataFrame({"code": ["A", "B", "C", "D"], "name": ["Alpha", "Beta", "Gamma", "Delta"],
                           "country": ["KR"] * 4, "wgt": [0.5, 0.2, 0.2, 0.1]})
        t = L.size_tail(st)
        self.assertEqual(t["B"], t["C"])                    # 같은 비중 → 같은 위치 (묶음 가운데)
        self.assertAlmostEqual(t["B"], 70.0)                # 앞 0.5 + 동률 0.4 의 절반
        pd.testing.assert_series_equal(L.size_tail(st.iloc[::-1]).sort_index(), t.sort_index())

    def test_bollinger_blank_when_price_flat(self):
        ri = _ri()
        ri.iloc[-30:, 0] = ri.iloc[-31, 0]
        tech, _ = TE.compute(ri, pd.Series({"A": 1, "B": 1, "C": 1}))
        self.assertTrue(np.isnan(tech.at["A", "bb_pctb"]))

    def test_event_study_constant_excess(self):
        ri = _ri(n=200, codes=("A", "B"))
        bench = ri["B"] / ri["B"].iloc[-1] * 1000
        ri["A"] = ri["B"] * np.exp(np.arange(200) * 0.001)          # 매일 약 +0.1% 초과
        ev = pd.DataFrame([{"code": "A", "review": "X", "action": "ADD", "announce": ri.index[100],
                            "close": ri.index[110], "effective": ri.index[111]}])
        res = L.event_study(ri, bench, ev)
        self.assertAlmostEqual(res["per_event"].at[0, "car_pre"], 20 * 0.1, delta=0.05)


class TestNameNorm(unittest.TestCase):
    def test_hyphen_short_part(self):
        sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "index_monitor" / "src"))
        import msci_pit as P
        self.assertNotEqual(P.norm_name("Snap-On Inc"), P.norm_name("SNAP A"))
        self.assertEqual(P.norm_name("Sichuan Kelun-Biotech Biopharmaceutical")[:21], P.norm_name("SICHUAN KELUN BIOTECH H"))


if __name__ == "__main__":
    unittest.main()


class TestBacktest(unittest.TestCase):
    """factor/backtest.py — 과거 주가 복원·분위 포트폴리오·PIT 마스크."""

    def test_price_relative_removes_dividends(self):
        from Claude_DB.factor import backtest as BT
        idx = pd.date_range("2020-01-01", periods=25, freq="MS")
        # 주가 고정 + 연 6% 배당 재투자 → RI 는 월 0.5% 상승, 주가 상대값은 1 근처여야 함
        ri = pd.DataFrame({"A": 100 * 1.005 ** np.arange(25)}, index=idx)
        dps = pd.DataFrame({"A": [6.0] * 25}, index=idx)
        prel = BT.price_relative(ri, dps, pd.Series({"A": 6.0}))
        self.assertAlmostEqual(prel["A"].iloc[-1], 1.0)
        self.assertLess(abs(prel["A"].iloc[0] - 1.0), 0.01)
        # 배당 무시(RI 그대로)면 11% 이상 차이 → 복원이 배당을 되돌렸는지 확인
        self.assertGreater(abs(ri["A"].iloc[0] / ri["A"].iloc[-1] - 1), 0.1)

    def test_quintile_backtest_perfect_signal(self):
        from Claude_DB.factor import backtest as BT
        rng = np.random.default_rng(1)
        idx = pd.date_range("2020-01-01", periods=14, freq="MS")
        cols = [f"S{i}" for i in range(100)]
        fwd = pd.DataFrame(rng.normal(0, 0.05, (14, 100)), index=idx, columns=cols)
        score = fwd.copy()                           # 미래 수익률을 그대로 점수로 → IC=1, Q1>…>Q5
        univ = pd.DataFrame(True, index=idx, columns=cols)
        r = BT.quintile_backtest(score, fwd, univ)
        self.assertTrue(np.allclose(r["ic"][np.isfinite(r["ic"])], 1.0))
        q = np.nanmean(r["q"], axis=1)
        self.assertTrue(all(q[i] > q[i + 1] for i in range(4)))

    def test_membership_mask_intervals(self):
        from Claude_DB.factor import backtest as BT
        dates = pd.date_range("2020-01-01", periods=6, freq="MS")
        snap = pd.DataFrame({"isin": ["X1", "X2", ""]}, index=["A", "B", "C"])
        iv = pd.DataFrame({"isin": ["X1", "X2"], "start": [pd.NaT, pd.Timestamp("2020-03-01")],
                           "end": [pd.Timestamp("2020-04-01"), pd.NaT]})
        m = BT.membership_mask(dates, snap, iv)
        self.assertEqual(m["A"].tolist(), [True, True, True, False, False, False])   # 편출 후 제외
        self.assertEqual(m["B"].tolist(), [False, False, True, True, True, True])    # 편입 전 제외
        self.assertFalse(m["C"].any())                                               # ISIN 없음 → 보수적으로 제외

    def test_sheet_classify(self):
        self.assertEqual(T._classify("Price(Daily_3Y)"), "ri")
        self.assertEqual(T._classify("Price_(Monthly_10Y)"), "ri_m")
        self.assertEqual(T._classify("Volume(Daily_3Y)"), "vol")
        self.assertEqual(T._classify("SALE"), "sal")
        self.assertEqual(T._classify("Price"), "ri")
        self.assertIsNone(T._classify("UNIVERSE"))
