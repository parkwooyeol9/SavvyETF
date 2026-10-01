"""정기변경 일정 + 예상 매매 + 종목별 충격을 한 JSON으로 만든다.

실행 (저장소 루트에서)::

    python -m Claude_Work.rebalance.build                 # 오늘 기준 4개월
    python -m Claude_Work.rebalance.build --as-of 2026-10-01 --months 4
    python -m Claude_Work.rebalance.build --publish        # R2 에도 적재

결과
    Claude_Work/out/rebalance.json   전체 결과 (R2 적재·API 용)
    Claude_Work/web/data.js          화면(web/index.html)이 읽는 같은 데이터
    webapp/src/lib/rebalanceSnapshot.json
                                     웹앱 '리밸런싱' 탭 기본값 (R2 가 비었거나 더 오래됐을 때)
"""

from __future__ import annotations

import argparse
import json
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from . import engine, kcal

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT = ROOT / "out"
WEB = ROOT / "web"
WEBAPP_SNAPSHOT = ROOT.parent / "webapp" / "src" / "lib" / "rebalanceSnapshot.json"
KST = ZoneInfo("Asia/Seoul")

ASSUMPTIONS = [
    "매매는 정기변경 효력일 직전 영업일 종가에 일어난다고 본다.",
    "고정 비중이 없는 종목은 현재 비중에 비례해 남은 비중을 나눈다. 실제 지수는 시가총액·스코어로 다시 가중할 수 있다.",
    "종목당 상한은 최근 시가총액(네이버 금융, 매일 갱신)으로 판정한다. 실제 지수는 정기변경 기준일 시가총액을 쓴다.",
    "종목 편출입은 반영하지 않는다. 맞춤형 지수는 변경 공지가 공개되지 않는 경우가 많다.",
    "순자산은 보유비중 파일의 값을 우선 쓰고, 없으면 유니버스의 참고 AUM을 쓴다.",
    "레버리지·커버드콜 액티브 ETF는 현물 매매 규모가 다를 수 있어 규칙이 확인된 상품만 계산한다.",
]


def _load_json(path: Path, default):
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def _holding_files(code: str) -> list[Path]:
    folder = DATA / "holdings" / code
    return sorted(folder.glob("*.json")) if folder.exists() else []


def latest_holdings(code: str) -> dict | None:
    files = _holding_files(code)
    return _load_json(files[-1], None) if files else None


def mcap_inputs(code: str, hold: dict) -> tuple[dict[str, float], float]:
    """최신 보유비중의 종목 시가총액. 오늘 조회에 실패한 종목은 이전 파일 값을 쓴다."""
    members = {h["code"] for h in hold["holdings"]}
    mcap = {h["code"]: float(h["mcap_jo"]) for h in hold["holdings"] if h.get("mcap_jo")}
    rest = hold.get("rest_mcap_jo_max")
    for path in reversed(_holding_files(code)[:-1]):
        if members <= mcap.keys():
            break
        old = _load_json(path, {})
        for h in old.get("holdings") or []:
            if h["code"] in members and h["code"] not in mcap and h.get("mcap_jo"):
                mcap[h["code"]] = float(h["mcap_jo"])
        if rest is None:
            rest = old.get("rest_mcap_jo_max")
    return mcap, float(rest or 0.0)


def previous_event_study() -> dict | None:
    for path in (OUT / "rebalance.json", WEBAPP_SNAPSHOT):
        prev = _load_json(path, {}) if path.exists() else {}
        if prev.get("event_study"):
            return prev["event_study"]
    return None


def event_study_block() -> dict | None:
    """과거 정기변경 이벤트 스터디. 가격 조회가 실패하면 직전 결과를 유지한다."""
    from . import event_study

    try:
        block = event_study.publishable(event_study.study(event_study.load_events()))
    except Exception as exc:  # noqa: BLE001
        print(f"이벤트 스터디 실패: {exc}")
        block = None
    if not block or not block["summary"].get("n"):
        return previous_event_study()
    return block


def build(as_of: date, months: int = 4, with_event_study: bool = False) -> dict:
    universe = _load_json(DATA / "universe.json", {"etfs": []})
    adv_doc = _load_json(DATA / "adv.json", {"adv_eok": {}})
    adv = {k: float(v) for k, v in (adv_doc.get("adv_eok") or {}).items() if v}

    window = kcal.months_ahead(as_of, months)
    events, flows, etf_rows = [], [], []

    for etf in universe["etfs"]:
        rule = etf.get("rule")
        supported = rule in kcal.RULE_LABELS
        hold = latest_holdings(etf["code"]) if etf.get("kind") == "etf" else None
        aum = (hold or {}).get("aum_eok") or etf.get("aum_eok")
        scenarios = etf.get("scenarios") or []
        next_event = None

        for (y, m) in window:
            if m not in etf.get("months", []) or not supported:
                continue
            eff = kcal.effective_date(rule, y, m)
            trd = kcal.prev_trading_day(eff)
            ev = {
                "etf_code": etf["code"], "etf_name": etf["name"], "issuer": etf.get("issuer"),
                "kind": etf.get("kind", "etf"), "theme": etf.get("theme"),
                "aum_eok": aum, "rule": rule, "rule_label": kcal.RULE_LABELS[rule],
                "expiry": kcal.expiry_date(y, m).isoformat(),
                "effective": eff.isoformat(), "trade_date": trd.isoformat(),
                "status": "past" if trd < as_of else "upcoming",
                "holiday_list_ok": kcal.has_holiday_list(y),
            }
            events.append(ev)
            if ev["status"] == "upcoming" and next_event is None:
                next_event = ev

        flow_status = "no_rule"
        if not supported:
            flow_status = "rule_unknown"
        elif not scenarios:
            flow_status = "no_rule"
        elif not hold:
            flow_status = "no_holdings"
        elif not aum:
            flow_status = "no_aum"
        elif next_event is None:
            flow_status = "no_event"
        else:
            flow_status = "ok"
            holdings = [engine.Holding(h["code"], h["name"], float(h["weight"])) for h in hold["holdings"]]
            mcap, rest_mcap = mcap_inputs(etf["code"], hold)
            for i, sc in enumerate(scenarios):
                s = engine.Scenario(
                    sc["id"], sc["label"], sc.get("fixed") or {}, sc.get("cap"), sc.get("note", ""),
                    basis=sc.get("basis", "current"), mcap_jo=mcap, rest_mcap_jo=rest_mcap,
                )
                rows = engine.trades(holdings, s, float(aum))
                cash = max(0.0, 100.0 - sum(h.weight for h in holdings))
                at_cap = engine.capped_by_mcap(holdings, s, cash)
                flows.append({
                    "etf_code": etf["code"], "etf_name": etf["name"],
                    "trade_date": next_event["trade_date"], "effective": next_event["effective"],
                    "scenario_id": s.id, "scenario_label": s.label, "scenario_note": s.note,
                    "capped_by_mcap": at_cap,
                    "primary": i == 0, "aum_eok": aum,
                    "holdings_as_of": hold.get("as_of"), "holdings_source": hold.get("source"),
                    "coverage_pct": round(sum(h.weight for h in holdings), 2),
                    "buy_eok": round(sum(r["amount_eok"] for r in rows if r["amount_eok"] > 0), 1),
                    "sell_eok": round(sum(r["amount_eok"] for r in rows if r["amount_eok"] < 0), 1),
                    "trades": rows,
                })

        etf_rows.append({
            "code": etf["code"], "name": etf["name"], "issuer": etf.get("issuer"),
            "kind": etf.get("kind", "etf"), "theme": etf.get("theme"), "index": etf.get("index"),
            "months": etf.get("months"), "rule": rule,
            "rule_label": kcal.RULE_LABELS.get(rule, "규칙 확인 필요"),
            "cap_pct": etf.get("cap_pct"), "aum_eok": aum,
            "aum_as_of": (hold or {}).get("as_of") or etf.get("aum_as_of"),
            "holdings_as_of": (hold or {}).get("as_of"),
            "next_trade_date": next_event["trade_date"] if next_event else None,
            "next_effective": next_event["effective"] if next_event else None,
            "flow_status": flow_status, "notes": etf.get("notes", []),
        })

    events.sort(key=lambda e: (e["trade_date"], -(e["aum_eok"] or 0)))
    primary = [f for f in flows if f["primary"]]
    impact = engine.aggregate(primary, adv)

    days: dict[str, dict] = {}
    for ev in events:
        d = days.setdefault(ev["trade_date"], {"trade_date": ev["trade_date"], "status": ev["status"],
                                                "etfs": [], "aum_eok": 0.0, "has_index": False})
        d["etfs"].append(ev["etf_code"])
        d["aum_eok"] += ev["aum_eok"] or 0
        d["has_index"] = d["has_index"] or ev["kind"] == "index"
        exp = ev["expiry"]
        d["expiry_same_day"] = d.get("expiry_same_day", False) or exp == ev["trade_date"]
    trade_days = sorted(days.values(), key=lambda d: d["trade_date"])
    for d in trade_days:
        d["aum_eok"] = round(d["aum_eok"])

    expiries = [{"month": f"{y}-{m:02d}", "expiry": kcal.expiry_date(y, m).isoformat(),
                 "quarterly": m in (3, 6, 9, 12)} for (y, m) in window]

    result = {
        "generated_at": datetime.now(KST).isoformat(timespec="seconds"),
        "as_of": as_of.isoformat(),
        "window": [f"{y}-{m:02d}" for (y, m) in window],
        "expiries": expiries,
        "trade_days": trade_days,
        "events": events,
        "etfs": etf_rows,
        "flows": flows,
        "impact": impact,
        "adv_as_of": adv_doc.get("as_of"),
        "assumptions": ASSUMPTIONS,
        "sources": universe.get("sources", []),
        "rule_legend": kcal.RULE_LABELS,
    }
    if with_event_study:
        result["event_study"] = event_study_block()
    return result


def write(result: dict) -> tuple[Path, Path]:
    OUT.mkdir(exist_ok=True)
    WEB.mkdir(exist_ok=True)
    out = OUT / "rebalance.json"
    js = WEB / "data.js"
    text = json.dumps(result, ensure_ascii=False, indent=1)
    out.write_text(text, encoding="utf-8")
    js.write_text("window.REBALANCE_DATA = " + text + ";\n", encoding="utf-8")
    if WEBAPP_SNAPSHOT.parent.is_dir():
        WEBAPP_SNAPSHOT.write_text(text + "\n", encoding="utf-8")
    return out, js


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--as-of", help="기준일 YYYY-MM-DD (기본: 오늘 KST)")
    p.add_argument("--months", type=int, default=4, help="기준월부터 몇 개월 (기본 4)")
    p.add_argument("--publish", action="store_true",
                   help="R2 rebalance/latest.json + snapshots/{날짜}.json 에도 올린다 (R2_* 환경변수 필요)")
    p.add_argument("--no-event-study", action="store_true", help="과거 이벤트 스터디(네이버 일봉 조회) 생략")
    args = p.parse_args(argv)
    as_of = date.fromisoformat(args.as_of) if args.as_of else datetime.now(KST).date()
    result = build(as_of, args.months, with_event_study=not args.no_event_study)
    out, js = write(result)
    up = [d for d in result["trade_days"] if d["status"] == "upcoming"]
    print(f"기준일 {result['as_of']} · 이벤트 {len(result['events'])}건 · 매매일 {len(result['trade_days'])}일 "
          f"(예정 {len(up)}일) · 계산된 ETF {len({f['etf_code'] for f in result['flows']})}개")
    print(f"→ {out}\n→ {js}")
    if args.publish:
        from r2_data import put_json_daily  # 저장소 루트 모듈

        ok = put_json_daily("rebalance/latest.json", result, day=result["as_of"])
        print("R2 업로드: " + ("완료 (rebalance/latest.json)" if ok else "건너뜀 — R2 설정 없음"))


if __name__ == "__main__":
    main()
