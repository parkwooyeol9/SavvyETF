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
    def _base(self, sksq_mcap=151.0):
        return engine.Scenario("base", "base", {"005930": 25, "000660": 25}, cap=15, basis="mcap",
                               mcap_jo={"009150": 114.0, "402340": sksq_mcap}, rest_mcap_jo=40.0)

    def test_sol_top2_reset_and_15pct_cap(self):
        rows = {r["code"]: r for r in engine.trades(holdings(), self._base(), 57790)}
        self.assertAlmostEqual(rows["000660"]["amount_eok"], 1745.3, places=1)
        self.assertAlmostEqual(rows["005930"]["amount_eok"], 277.4, places=1)
        # SK스퀘어는 시가총액 비중이 상한을 넘으므로 15%까지 채워진다 (가격 하락으로 13.61%)
        self.assertAlmostEqual(rows["402340"]["target_pct"], 15.0)
        self.assertAlmostEqual(rows["402340"]["amount_eok"], 803.3, places=1)
        self.assertAlmostEqual(rows["009150"]["target_pct"], 15.0)
        self.assertAlmostEqual(rows["007660"]["amount_eok"], -753.9, places=1)
        total = sum(r["amount_eok"] for r in rows.values())
        self.assertLess(abs(total), 1.0)  # 매수 합 ≈ 매도 합

    def test_small_mcap_falls_back_to_proportional(self):
        # 시가총액이 작아 상한에 안 걸리면 현재 비중 비례로 나뉜다
        sc = self._base(sksq_mcap=20.0)
        sc.mcap_jo = {"009150": 20.0, "402340": 20.0}
        tgt = engine.target_weights(holdings(), sc, cash=0.6)
        self.assertLess(tgt["402340"], 15.0)
        self.assertAlmostEqual(tgt["402340"] / tgt["009150"], 13.61 / 15.50, places=6)

    def test_full_mcap_matches_partial_estimate(self):
        # 종목별 시가총액을 모두 알 때도 같은 두 종목만 상한에 걸린다
        sc = self._base()
        sc.mcap_jo = {"009150": 115.85, "402340": 151.32, "007660": 8.98, "353200": 7.28,
                      "240810": 6.97, "319660": 4.69, "095610": 3.5, "089970": 1.84}
        sc.rest_mcap_jo = 0.0
        self.assertEqual(engine.capped_by_mcap(holdings(), sc, cash=0.6), ["402340", "009150"])
        rows = {r["code"]: r for r in engine.trades(holdings(), sc, 57790)}
        self.assertAlmostEqual(rows["402340"]["amount_eok"], 803.3, places=1)

    def test_mcap_cap_is_iterative(self):
        # A 를 상한으로 자르면 남은 분모에서 B 도 상한을 넘는다
        hs = [engine.Holding(c, c, w) for c, w in (("A", 30), ("B", 30), ("C", 20), ("D", 20))]
        sc = engine.Scenario("m", "m", cap=30, basis="mcap",
                             mcap_jo={"A": 100, "B": 60, "C": 20, "D": 20})
        self.assertEqual(engine.capped_by_mcap(hs, sc, cash=0), ["A", "B"])
        tgt = engine.target_weights(hs, sc, cash=0)
        self.assertAlmostEqual(tgt["C"], 20)
        self.assertAlmostEqual(sum(tgt.values()), 100)

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
        self.assertNotIn("event_study", res)

    def test_sol_top2_cap_uses_mcap(self):
        res = build(date(2026, 10, 1), 4)
        prim = next(f for f in res["flows"] if f["etf_code"] == "0167A0" and f["primary"])
        self.assertEqual(sorted(prim["capped_by_mcap"]), ["009150", "402340"])
        sksq = next(t for t in prim["trades"] if t["code"] == "402340")
        self.assertAlmostEqual(sksq["target_pct"], 15.0)

    def test_mcap_carries_forward_from_older_file(self):
        from Claude_Work.rebalance import build as b

        hold = {"holdings": [{"code": "009150", "name": "삼성전기", "weight": 15.5},
                             {"code": "402340", "name": "SK스퀘어", "weight": 13.6, "mcap_jo": 150.0}]}
        older = {"holdings": [{"code": "009150", "mcap_jo": 114.0}], "rest_mcap_jo_max": 40.0}
        with mock.patch.object(b, "_holding_files", return_value=["old", "new"]), \
                mock.patch.object(b, "_load_json", return_value=older):
            mcap, rest = b.mcap_inputs("0167A0", hold)
        self.assertEqual(mcap, {"009150": 114.0, "402340": 150.0})
        self.assertEqual(rest, 40.0)


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
