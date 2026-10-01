"""정기변경 목표비중과 예상 매매 규모 계산.

규칙
----
1. ``fixed`` 에 적힌 종목은 그 비중으로 맞춘다 (예: SOL AI반도체TOP2플러스의
   삼성전자·SK하이닉스 25% 리셋).
2. 현금 비중은 현재 값을 유지한다.
3. 나머지 종목은 현재 비중에 비례해 남은 비중을 나눠 갖는다.
4. 종목당 상한(``cap``)을 넘는 종목은 상한으로 자르고, 초과분을 상한 미만
   종목에 비례 배분한다 (반복).

3번은 가정이다. 실제 지수는 시가총액·스코어 등 방법론에 따라 다시 가중하고,
종목 편출입도 있을 수 있다. 그래서 결과는 '추정'이며 화면에 가정을 같이 보인다.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable

EPS = 1e-9


@dataclass
class Holding:
    code: str
    name: str
    weight: float  # %


@dataclass
class Scenario:
    id: str
    label: str
    fixed: dict[str, float] = field(default_factory=dict)  # code -> 목표 %
    cap: float | None = None  # 종목당 상한 %
    note: str = ""


def _cap_redistribute(weights: dict[str, float], budget: float, cap: float | None,
                      locked: Iterable[str] = ()) -> dict[str, float]:
    """weights 를 budget 합계로 비례 배분하되 cap 을 넘지 않게 한다."""
    locked = set(locked)
    free = {k: v for k, v in weights.items() if k not in locked}
    out = {k: weights[k] for k in locked}
    remaining = budget
    capped: set[str] = set()
    for _ in range(len(free) + 1):
        pool = {k: v for k, v in free.items() if k not in capped}
        base = sum(pool.values())
        if base <= EPS:
            break
        trial = {k: v / base * remaining for k, v in pool.items()}
        over = {k for k, v in trial.items() if cap is not None and v > cap + EPS}
        if not over:
            out.update(trial)
            break
        for k in over:
            out[k] = cap
            capped.add(k)
            remaining -= cap
    return out


def target_weights(holdings: list[Holding], scenario: Scenario, cash: float) -> dict[str, float]:
    current = {h.code: h.weight for h in holdings}
    fixed = {k: v for k, v in scenario.fixed.items() if k in current}
    budget = 100.0 - cash - sum(fixed.values())
    free = {k: v for k, v in current.items() if k not in fixed}
    out = _cap_redistribute(free, budget, scenario.cap)
    out.update(fixed)
    return out


def trades(holdings: list[Holding], scenario: Scenario, aum_eok: float,
           cash: float | None = None) -> list[dict]:
    """종목별 (목표 − 현재) × 순자산. 단위: 억원, +매수 / −매도."""
    if cash is None:
        cash = max(0.0, 100.0 - sum(h.weight for h in holdings))
    tgt = target_weights(holdings, scenario, cash)
    rows = []
    for h in holdings:
        t = tgt.get(h.code, h.weight)
        delta = t - h.weight
        rows.append({
            "code": h.code,
            "name": h.name,
            "current_pct": round(h.weight, 4),
            "target_pct": round(t, 4),
            "delta_pct": round(delta, 4),
            "amount_eok": round(delta / 100.0 * aum_eok, 1),
        })
    rows.sort(key=lambda r: -abs(r["amount_eok"]))
    return rows


def impact_level(ratio: float | None) -> str:
    """매매 규모 / 일평균 거래대금 비율로 충격 수준 구분."""
    if ratio is None:
        return "unknown"
    if ratio >= 0.10:
        return "high"
    if ratio >= 0.03:
        return "mid"
    return "low"


def aggregate(flows: list[dict], adv_eok: dict[str, float]) -> list[dict]:
    """같은 매매일의 ETF별 매매를 종목 단위로 합친다.

    flows: [{"etf_code", "etf_name", "trade_date", "trades": [...]}]
    """
    by_key: dict[tuple[str, str], dict] = {}
    for f in flows:
        for t in f["trades"]:
            key = (f["trade_date"], t["code"])
            row = by_key.setdefault(key, {
                "trade_date": f["trade_date"], "code": t["code"], "name": t["name"],
                "buy_eok": 0.0, "sell_eok": 0.0, "net_eok": 0.0, "by_etf": [],
            })
            amt = t["amount_eok"]
            row["net_eok"] += amt
            if amt >= 0:
                row["buy_eok"] += amt
            else:
                row["sell_eok"] += amt
            row["by_etf"].append({"etf_code": f["etf_code"], "etf_name": f["etf_name"],
                                  "amount_eok": amt})
    out = []
    for row in by_key.values():
        adv = adv_eok.get(row["code"])
        ratio = abs(row["net_eok"]) / adv if adv else None
        row.update({
            "buy_eok": round(row["buy_eok"], 1),
            "sell_eok": round(row["sell_eok"], 1),
            "net_eok": round(row["net_eok"], 1),
            "adv_eok": adv,
            "impact_ratio": round(ratio, 4) if ratio is not None else None,
            "impact_level": impact_level(ratio),
        })
        out.append(row)
    out.sort(key=lambda r: (r["trade_date"], -abs(r["net_eok"])))
    return out
