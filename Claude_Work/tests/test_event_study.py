"""합성 가격으로 event_study 계산을 검증한다 (네트워크 없음)."""

from __future__ import annotations

import unittest

import pandas as pd

from Claude_Work.rebalance import event_study as es


def synthetic(trade_date="2026-06-12"):
    idx = pd.bdate_range("2026-05-01", "2026-07-15")
    mkt = pd.Series(100.0, index=idx)
    stk = pd.Series(100.0, index=idx)
    t = idx.get_loc(pd.Timestamp(trade_date))
    # T-2..T 에 매일 -5% (매도 압력), T+1..T+3 에 매일 +4% (되돌림), 시장은 평탄
    for k in range(t - 2, t + 1):
        stk.iloc[k:] *= 0.95
    for k in range(t + 1, t + 4):
        stk.iloc[k:] *= 1.04
    return pd.DataFrame({"009150.KS": stk, "^KS11": mkt, "^KQ11": mkt})


class EventStudyTest(unittest.TestCase):
    def test_sell_event_front_and_reversal_signs(self):
        px = synthetic()
        ev = [{"event_id": "x", "label": "x", "trade_date": "2026-06-12", "confidence": "mid", "kind": "rebalance",
               "code": "009150", "name": "삼성전기", "market": "KS", "side": "sell",
               "flow_eok": -5000, "adv_eok": 20000, "note": ""}]
        res = es.study(ev, loader=lambda t, s, e: px, pre=-5, hold=5)
        r = res["events"][0]
        self.assertEqual(r["status"], "ok")
        self.assertAlmostEqual(r["ar_0"], -0.05, places=6)
        self.assertGreater(r["strat_front"], 0.14)       # 숏으로 하락 3일 수취
        self.assertGreater(r["strat_reversal"], 0.12)    # 종가 매수 후 되돌림 수취
        self.assertIn("high(>=10%)", res["summary"]["reversal_by_impact"])

    def test_adv_computed_and_publishable_paths(self):
        px = synthetic()
        value = pd.DataFrame({"009150.KS": pd.Series(2e12, index=px.index)})
        ev = [{"event_id": "x", "label": "x", "trade_date": "2026-06-12", "confidence": "mid", "kind": "rebalance",
               "code": "009150", "name": "삼성전기", "market": "KS", "side": "sell",
               "flow_eok": -5000, "adv_eok": None, "note": ""}]
        res = es.study(ev, loader=lambda t, s, e: (px, value), pre=-5, hold=5)
        self.assertEqual(res["events"][0]["adv_eok"], 20000.0)
        pub = es.publishable(res)
        row = pub["rows"][0]
        self.assertEqual(row["impact_ratio"], 0.25)
        self.assertEqual(len(row["car_path"]), 16)  # T-5 .. T+10
        self.assertAlmostEqual(row["car_path"][5], row["car_pre"] + row["ar_0"], places=3)
        self.assertEqual([p["t"] for p in pub["paths"]][:2], [-5, -4])
        self.assertIsNone(pub["paths"][0]["buy"])
        self.assertEqual(pub["summary"]["by_side"]["sell"]["n"], 1)
        self.assertNotIn("strat_front", row)

    def test_naver_parse(self):
        from Claude_Work.rebalance import naver

        text = """[['날짜', '시가', '고가', '저가', '종가', '거래량', '외국인소진율'],
        ["20260601", 8485.67, 8874.16, 8485.67, 8788.38, 636175, 0.0],
        ["20260602", 8883.19, 8933.62, 8503.12, 8801.49, 632553, 0.0]
        ]"""
        df = naver.parse(text)
        self.assertEqual(list(df["close"]), [8788.38, 8801.49])
        self.assertEqual(df.index[0], pd.Timestamp("2026-06-01"))

    def test_missing_trade_day_rolls_forward(self):
        px = synthetic().drop(pd.Timestamp("2026-06-12"))
        ar = es.abnormal_returns(px["009150.KS"], px["^KS11"], "2026-06-12")
        self.assertIn(0, ar.index)

    def test_events_file_loads(self):
        evs = es.load_events()
        self.assertTrue(all(e["trade_date"] for e in evs))
        self.assertFalse(any(e["event_id"] == "sol_top2_2610" for e in evs))  # forecast 제외
        self.assertFalse(any(e["confidence"] == "low" for e in evs))


if __name__ == "__main__":
    unittest.main()
