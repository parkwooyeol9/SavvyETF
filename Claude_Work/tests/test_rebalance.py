"""실행: 저장소 루트에서 ``python -m unittest discover -s Claude_Work/tests -t .``"""

from __future__ import annotations

import unittest
from datetime import date
from unittest import mock

from Claude_Work.rebalance import engine, fetch, kcal
from Claude_Work.rebalance.build import build

SOL_TOP2 = [
    ("005930", "삼성전자", 24.52), ("000660", "SK하이닉스", 21.98), ("009150", "삼성전기", 15.50),
    ("402340", "SK스퀘어", 13.61), ("007660", "이수페타시스", 7.07), ("353200", "대덕전자", 4.96),
    ("240810", "원익IPS", 4.74), ("319660", "피에스케이", 3.26), ("095610", "테스", 2.17),
    ("089970", "브이엠", 1.59),
]


def holdings():
    return [engine.Holding(c, n, w) for c, n, w in SOL_TOP2]


class CalendarTest(unittest.TestCase):
    def test_expiries(self):
        self.assertEqual(kcal.expiry_date(2026, 10), date(2026, 10, 8))
        self.assertEqual(kcal.expiry_date(2026, 11), date(2026, 11, 12))
        self.assertEqual(kcal.expiry_date(2026, 12), date(2026, 12, 10))
        self.assertEqual(kcal.expiry_date(2027, 1), date(2027, 1, 14))

    def test_october_holidays_push_trades_to_expiry_day(self):
        # 10/9 한글날 휴장 → D+1, D+2 모두 10/12 효력, 10/8 매매
        for rule in ("D+1", "D+2"):
            self.assertEqual(kcal.effective_date(rule, 2026, 10), date(2026, 10, 12))
            self.assertEqual(kcal.trade_date(rule, 2026, 10), date(2026, 10, 8))
        self.assertEqual(kcal.trade_date("D", 2026, 10), date(2026, 10, 7))

    def test_month_start_rule_skips_new_year(self):
        self.assertEqual(kcal.effective_date("S", 2027, 1), date(2027, 1, 4))
        self.assertEqual(kcal.trade_date("S", 2027, 1), date(2026, 12, 30))  # 12/31 휴장

    def test_december_index_change(self):
        self.assertEqual(kcal.trade_date("D+1", 2026, 12), date(2026, 12, 10))
        self.assertEqual(kcal.effective_date("D+2", 2026, 12), date(2026, 12, 14))


class EngineTest(unittest.TestCase):
    def test_sol_top2_reset_scenario_a(self):
        sc = engine.Scenario("A", "A", {"005930": 25, "000660": 25}, cap=25)
        rows = {r["code"]: r for r in engine.trades(holdings(), sc, 57790)}
        self.assertAlmostEqual(rows["000660"]["amount_eok"], 1745.3, places=1)
        self.assertAlmostEqual(rows["005930"]["amount_eok"], 277.4, places=1)
        total = sum(r["amount_eok"] for r in rows.values())
        self.assertLess(abs(total), 1.0)  # 매수 합 ≈ 매도 합

    def test_sol_top2_scenario_b_flips_sk_square(self):
        sc = engine.Scenario("B", "B", {"005930": 25, "000660": 25, "402340": 15, "009150": 15}, cap=25)
        rows = {r["code"]: r for r in engine.trades(holdings(), sc, 57790)}
        self.assertAlmostEqual(rows["402340"]["amount_eok"], 803.3, places=1)
        self.assertAlmostEqual(rows["007660"]["amount_eok"], -753.9, places=1)

    def test_cap_redistributes_excess(self):
        hs = [engine.Holding("A", "A", 30), engine.Holding("B", "B", 40), engine.Holding("C", "C", 30)]
        tgt = engine.target_weights(hs, engine.Scenario("cap", "cap", cap=35), cash=0)
        self.assertAlmostEqual(tgt["B"], 35)
        self.assertAlmostEqual(tgt["A"], 32.5)
        self.assertAlmostEqual(sum(tgt.values()), 100)

    def test_aggregate_nets_across_etfs(self):
        flows = [
            {"etf_code": "X", "etf_name": "X", "trade_date": "2026-10-08",
             "trades": [{"code": "005930", "name": "삼성전자", "amount_eok": -2000.0}]},
            {"etf_code": "Y", "etf_name": "Y", "trade_date": "2026-10-08",
             "trades": [{"code": "005930", "name": "삼성전자", "amount_eok": 300.0}]},
        ]
        row = engine.aggregate(flows, {"005930": 20000.0})[0]
        self.assertEqual(row["net_eok"], -1700.0)
        self.assertEqual(row["impact_level"], "mid")
        self.assertEqual(len(row["by_etf"]), 2)


class BuildTest(unittest.TestCase):
    def test_build_october(self):
        res = build(date(2026, 10, 1), 4)
        day = next(d for d in res["trade_days"] if d["trade_date"] == "2026-10-08")
        self.assertIn("0167A0", day["etfs"])
        self.assertGreaterEqual(len(day["etfs"]), 10)
        prim = [f for f in res["flows"] if f["etf_code"] == "0167A0" and f["primary"]]
        self.assertEqual(prim[0]["trade_date"], "2026-10-08")
        hynix = next(r for r in res["impact"] if r["code"] == "000660")
        self.assertGreater(hynix["net_eok"], 1700)


class FetchTest(unittest.TestCase):
    def test_clean_rows_drops_cash_and_self(self):
        rows = fetch.clean_rows("0167A0", [
            {"code": "005930", "name": "삼성전자", "weight_pct": 24.5},
            {"code": "0167A0", "name": "원화예금", "weight_pct": 0.6},
            {"code": "KRD010010001", "name": "현금", "weight_pct": 0.1},
        ])
        self.assertEqual([r["code"] for r in rows], ["005930"])

    def test_aum_parses_jo_and_eok(self):
        self.assertEqual(fetch._aum_eok({"total_nav": "10조 2,124억"}), 102124)
        self.assertEqual(fetch._aum_eok({"total_nav": "6,374억"}), 6374)
        self.assertEqual(fetch._aum_eok({"total_nav": "1조"}), 10000)
        self.assertEqual(fetch._aum_eok({"total_nav": 101520}), 101520)
        self.assertIsNone(fetch._aum_eok({"total_nav": "-"}))

    def test_fetch_holdings_uses_etfcheck(self):
        fake_rows = [{"code": "005930", "name": "삼성전자", "weight_pct": 27.1, "as_of": "20261001"},
                     {"code": "000660", "name": "SK하이닉스", "weight_pct": 24.0, "as_of": "20261001"}]
        with mock.patch.dict("sys.modules", {
            "etfcheck_client": mock.Mock(EtfCheckClient=mock.Mock(), fetch_kr_pdf_weights=mock.Mock(return_value=fake_rows)),
            "dart_etf_memb": mock.Mock(fetch_etf_meta=mock.Mock(return_value={"total_nav": 101520})),
        }):
            snap = fetch.fetch_holdings("396500")
        self.assertEqual(snap["as_of"], "2026-10-01")
        self.assertEqual(snap["aum_eok"], 101520)
        self.assertEqual(snap["coverage_pct"], 51.1)


if __name__ == "__main__":
    unittest.main()
