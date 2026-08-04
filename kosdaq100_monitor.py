"""KOSDAQ 100 monitor — daily EOD snapshot + 3–4 line AI brief.

Schedule: 15:45 KST (post close) via kosdaq100_scheduler.py
R2: kosdaq100/latest.json
"""

from __future__ import annotations

import json
import re
import statistics
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import requests

KST = ZoneInfo("Asia/Seoul")
PROJECT_DIR = Path(__file__).resolve().parent
UNIVERSE_PATH = PROJECT_DIR / "data" / "universes" / "kosdaq100.json"
DATA_ROOT = PROJECT_DIR / "data" / "kosdaq100"
LATEST_PATH = DATA_ROOT / "latest.json"
R2_KEY = "kosdaq100/latest.json"

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
SESSION = requests.Session()
SESSION.headers.update({"User-Agent": UA, "Referer": "https://m.stock.naver.com/"})

THEME_TAGS: list[tuple[str, tuple[str, ...]]] = [
    ("반도체 소부장", ("테스", "심텍", "피에스케이", "원익", "리노공업", "HPSP", "주성")),
    ("바이오·헬스", ("알테오젠", "파마리서치", "펩트론", "올릭스", "휴젤", "HLB")),
    ("2차전지", ("에코프로", "서진시스템", "엔켐", "대주전자재료")),
    ("로봇·AI", ("로보티즈", "레인보우로보틱스", "클로봇")),
]

SCHEDULE_NOTE = "평일 15:45 KST(장마감 후) 데이터·브리핑 갱신"


def _now_kst() -> datetime:
    return datetime.now(KST)


def _today_kst() -> str:
    return _now_kst().strftime("%Y-%m-%d")


def _num(raw: Any) -> float | None:
    if raw is None or raw == "" or raw == "-":
        return None
    if isinstance(raw, (int, float)):
        return float(raw) if raw == raw else None
    text = str(raw).replace(",", "").replace("%", "").replace("배", "").replace("원", "").strip()
    if not text or text == "-":
        return None
    try:
        return float(text)
    except ValueError:
        return None


def theme_for(name: str) -> str | None:
    for theme, tokens in THEME_TAGS:
        if any(tok in name for tok in tokens):
            return theme
    return None


def load_universe() -> dict[str, Any]:
    raw = json.loads(UNIVERSE_PATH.read_text(encoding="utf-8"))
    constituents = [c for c in raw.get("constituents") or [] if c.get("code")]
    return {
        "as_of": raw.get("as_of"),
        "source": raw.get("source"),
        "count": len(constituents),
        "constituents": constituents,
    }


def quality_score(row: dict[str, Any]) -> dict[str, Any]:
    score = 45
    drivers: list[str] = []
    roe = row.get("roe")
    op_margin = row.get("op_margin")
    revenue_growth = row.get("revenue_growth")
    debt_ratio = row.get("debt_ratio")
    per = row.get("per")
    pbr = row.get("pbr")
    eps = row.get("eps")

    if roe is not None:
        if roe >= 20:
            score += 18
            drivers.append(f"ROE {roe:.1f}% 우수")
        elif roe >= 12:
            score += 12
            drivers.append(f"ROE {roe:.1f}% 양호")
        elif roe >= 5:
            score += 5
        elif roe < 0:
            score -= 12
            drivers.append("ROE 적자")

    if op_margin is not None:
        if op_margin >= 20:
            score += 12
            drivers.append(f"영업이익률 {op_margin:.1f}%")
        elif op_margin >= 10:
            score += 8
        elif op_margin < 0:
            score -= 10
            drivers.append("영업적자")

    if revenue_growth is not None:
        if revenue_growth >= 25:
            score += 12
            drivers.append(f"매출성장 {revenue_growth:.0f}%")
        elif revenue_growth >= 8:
            score += 7
        elif revenue_growth < -10:
            score -= 8
            drivers.append("매출 역성장")

    if debt_ratio is not None:
        if debt_ratio <= 50:
            score += 6
        elif debt_ratio <= 100:
            score += 3
        elif debt_ratio >= 200:
            score -= 8
            drivers.append(f"부채비율 {debt_ratio:.0f}%")

    if eps is not None and eps < 0:
        score -= 8

    if per is not None and per > 0:
        if per <= 15:
            score += 6
            drivers.append("PER 상대 저평가")
        elif per >= 80:
            score -= 4

    if pbr is not None and 0 < pbr <= 1.2:
        score += 4

    score = max(0, min(100, round(score)))
    label = "우량" if score >= 75 else "양호" if score >= 60 else "보통" if score >= 45 else "주의"
    return {"quality_score": score, "quality_label": label, "quality_drivers": drivers[:3]}


def _parse_annual_value(row_list: list[dict], title: str, key: str) -> float | None:
    for row in row_list:
        if str(row.get("title") or "") != title:
            continue
        cols = row.get("columns") or {}
        cell = cols.get(key) or {}
        return _num(cell.get("value"))
    return None


def _latest_actual_key(titles: list[dict]) -> tuple[str, str] | None:
    actuals = [t for t in titles if t.get("isConsensus") != "Y" and t.get("key")]
    if not actuals:
        return None
    last = actuals[-1]
    return str(last["key"]), str(last.get("title") or last["key"])


def _prev_actual_key(titles: list[dict]) -> str | None:
    actuals = [t for t in titles if t.get("isConsensus") != "Y" and t.get("key")]
    if len(actuals) < 2:
        return None
    return str(actuals[-2]["key"])


def fetch_quote_batch(codes: list[str]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for i in range(0, len(codes), 40):
        chunk = codes[i : i + 40]
        url = f"https://polling.finance.naver.com/api/realtime/domestic/stock/{','.join(chunk)}"
        try:
            r = SESSION.get(url, timeout=30)
            r.raise_for_status()
            for row in r.json().get("datas") or []:
                code = str(row.get("itemCode") or "")
                if not code:
                    continue
                out[code] = {
                    "name": str(row.get("stockName") or code),
                    "price": _num(row.get("closePriceRaw")),
                    "change": _num(row.get("compareToPreviousClosePriceRaw")),
                    "change_pct": _num(row.get("fluctuationsRatioRaw")),
                    "market_cap": _num(row.get("marketValueFullRaw")),
                    "volume": _num(row.get("accumulatedTradingVolumeRaw")),
                    "value": _num(row.get("accumulatedTradingValueRaw")),
                    "market_status": str(row.get("marketStatus") or ""),
                }
        except Exception:
            continue
    return out


def fetch_fundamentals(code: str, name: str) -> dict[str, Any]:
    base: dict[str, Any] = {
        "code": code,
        "per": None,
        "pbr": None,
        "eps": None,
        "bps": None,
        "roe": None,
        "op_margin": None,
        "net_margin": None,
        "debt_ratio": None,
        "revenue": None,
        "revenue_prev": None,
        "revenue_growth": None,
        "op_income": None,
        "dividend_yield": None,
        "fiscal_label": None,
        "theme": theme_for(name),
    }
    try:
        int_r = SESSION.get(
            f"https://m.stock.naver.com/api/stock/{code}/integration", timeout=20
        )
        if int_r.ok:
            infos = {
                str(t.get("code") or ""): t.get("value")
                for t in (int_r.json().get("totalInfos") or [])
            }
            base["per"] = _num(infos.get("per"))
            base["pbr"] = _num(infos.get("pbr"))
            base["eps"] = _num(infos.get("eps"))
            base["bps"] = _num(infos.get("bps"))
            base["dividend_yield"] = _num(infos.get("dividendYieldRatio"))

        ann_r = SESSION.get(
            f"https://m.stock.naver.com/api/stock/{code}/finance/annual", timeout=25
        )
        if ann_r.ok:
            fi = ann_r.json().get("financeInfo") or {}
            titles = fi.get("trTitleList") or []
            rows = fi.get("rowList") or []
            latest = _latest_actual_key(titles)
            prev = _prev_actual_key(titles)
            if latest:
                key, label = latest
                base["fiscal_label"] = label
                base["revenue"] = _parse_annual_value(rows, "매출액", key)
                base["op_income"] = _parse_annual_value(rows, "영업이익", key)
                base["roe"] = _parse_annual_value(rows, "ROE", key)
                base["op_margin"] = _parse_annual_value(rows, "영업이익률", key)
                base["net_margin"] = _parse_annual_value(rows, "순이익률", key)
                base["debt_ratio"] = _parse_annual_value(rows, "부채비율", key)
                if base["per"] is None:
                    base["per"] = _parse_annual_value(rows, "PER", key)
                if base["pbr"] is None:
                    base["pbr"] = _parse_annual_value(rows, "PBR", key)
                if base["eps"] is None:
                    base["eps"] = _parse_annual_value(rows, "EPS", key)
                if prev:
                    rev_prev = _parse_annual_value(rows, "매출액", prev)
                    base["revenue_prev"] = rev_prev
                    if base["revenue"] is not None and rev_prev not in (None, 0):
                        base["revenue_growth"] = (
                            (base["revenue"] - rev_prev) / abs(rev_prev)
                        ) * 100
    except Exception:
        pass
    base.update(quality_score(base))
    return base


def build_rows(universe: dict[str, Any]) -> list[dict[str, Any]]:
    constituents = universe["constituents"]
    codes = [c["code"] for c in constituents]
    name_by = {c["code"]: c["name"] for c in constituents}
    quotes = fetch_quote_batch(codes)

    funds: dict[str, dict[str, Any]] = {}
    with ThreadPoolExecutor(max_workers=12) as ex:
        futs = {
            ex.submit(fetch_fundamentals, c["code"], c["name"]): c["code"]
            for c in constituents
        }
        for fut in as_completed(futs):
            code = futs[fut]
            try:
                funds[code] = fut.result()
            except Exception:
                funds[code] = {"code": code, "theme": theme_for(name_by.get(code, ""))}

    total_mcap = sum((quotes.get(c, {}).get("market_cap") or 0) for c in codes)
    rows: list[dict[str, Any]] = []
    for code in codes:
        q = quotes.get(code, {})
        f = funds.get(code, {})
        mcap = q.get("market_cap")
        weight = (mcap / total_mcap * 100) if mcap and total_mcap > 0 else None
        rows.append(
            {
                "code": code,
                "name": q.get("name") or name_by.get(code) or code,
                "price": q.get("price"),
                "change": q.get("change"),
                "change_pct": q.get("change_pct"),
                "market_cap": mcap,
                "weight_pct": weight,
                "volume": q.get("volume"),
                "value": q.get("value"),
                "market_status": q.get("market_status"),
                **{k: f.get(k) for k in (
                    "per", "pbr", "eps", "bps", "roe", "op_margin", "net_margin",
                    "debt_ratio", "revenue", "revenue_growth", "fiscal_label", "theme",
                    "quality_score", "quality_label", "quality_drivers",
                )},
            }
        )
    rows.sort(key=lambda r: (-(r.get("weight_pct") or 0), r["code"]))
    return rows


def build_summary(rows: list[dict[str, Any]]) -> dict[str, Any]:
    adv = sum(1 for r in rows if (r.get("change_pct") or 0) > 0)
    dec = sum(1 for r in rows if (r.get("change_pct") or 0) < 0)
    unch = sum(1 for r in rows if r.get("change_pct") == 0)
    pers = [r["per"] for r in rows if r.get("per") and r["per"] > 0]
    roes = [r["roe"] for r in rows if r.get("roe") is not None]
    total_mcap = sum(r.get("market_cap") or 0 for r in rows)
    return {
        "total_mcap": total_mcap or None,
        "advancers": adv,
        "decliners": dec,
        "unchanged": unch,
        "high_quality": sum(1 for r in rows if (r.get("quality_score") or 0) >= 75),
        "median_per": statistics.median(pers) if pers else None,
        "median_roe": statistics.median(roes) if roes else None,
        "top_weight": [
            {"code": r["code"], "name": r["name"], "weight_pct": r.get("weight_pct") or 0}
            for r in rows[:5]
        ],
    }


def select_feature_stocks(rows: list[dict[str, Any]], limit: int = 3) -> list[dict[str, Any]]:
    values = [r.get("value") or 0 for r in rows if (r.get("value") or 0) > 0]
    med_val = statistics.median(values) if values else 0
    scored: list[tuple[float, dict[str, Any]]] = []
    for r in rows:
        chg = abs(r.get("change_pct") or 0)
        val = r.get("value") or 0
        vol_ratio = val / med_val if med_val > 0 else 0
        if chg < 4 and vol_ratio < 2.0:
            continue
        score = chg * 2.5 + min(vol_ratio, 6) * 2.0 + (r.get("weight_pct") or 0) * 0.05
        scored.append((score, r))
    scored.sort(key=lambda x: x[0], reverse=True)
    return [r for _, r in scored[:limit]]


def fetch_feature_news(features: list[dict[str, Any]]) -> dict[str, list[dict[str, str]]]:
    from naver_news import fetch_naver_news

    out: dict[str, list[dict[str, str]]] = {}
    for row in features:
        name = row.get("name") or row.get("code")
        try:
            out[row["code"]] = fetch_naver_news(f"{name} 주가", limit=2, korean_only=True)
        except Exception:
            out[row["code"]] = []
    return out


def _briefing_context(
    rows: list[dict[str, Any]],
    summary: dict[str, Any],
    features: list[dict[str, Any]],
    news: dict[str, list[dict[str, str]]],
) -> str:
    lines = [
        f"as_of={_today_kst()} universe={len(rows)}",
        f"advancers={summary['advancers']} decliners={summary['decliners']} high_quality={summary['high_quality']}",
        f"median_per={summary.get('median_per')} median_roe={summary.get('median_roe')}",
        "top_weight=" + ", ".join(
            f"{t['name']} {t['weight_pct']:.1f}%" for t in summary.get("top_weight") or []
        ),
    ]
    for r in features:
        headlines = news.get(r["code"]) or []
        h = headlines[0]["title"] if headlines else ""
        lines.append(
            f"feature {r['name']}({r['code']}) chg={r.get('change_pct'):+.2f}% "
            f"value={r.get('value')} theme={r.get('theme')} news={h}"
        )
    return "\n".join(lines)


def generate_briefing_gemini(context: str) -> list[str]:
    from data_briefing import _call_gemini_json

    prompt = f"""당신은 한국 코스닥100 투자자를 위한 장마감 브리핑 작성자입니다.

아래 데이터(종가·시총·펀더멘털·특징주·네이버 뉴스 헤드라인)만 근거로 3~4문장 한국어 브리핑을 작성하세요.

규칙:
- JSON만 출력: {{"lines": ["문장1", "문장2", "문장3", "문장4(선택)"]}}
- 각 line은 완전한 문장 1개 (3~4개)
- 1) 코스닥100 전체 상승/하락·수급 온도 2) 거래량·급등락 특징주와 뉴스 이슈 3) 우량/밸류 관점 종합 평가
- 투자 권유·매수 추천 금지, 교육용 시황 코멘트 톤

데이터:
{context}
"""
    result = _call_gemini_json(prompt)
    lines = result.get("lines") or []
    clean = [re.sub(r"\s+", " ", str(ln)).strip() for ln in lines if str(ln).strip()]
    return clean[:4]


def generate_briefing_fallback(
    summary: dict[str, Any],
    features: list[dict[str, Any]],
    news: dict[str, list[dict[str, str]]],
) -> list[str]:
    lines: list[str] = []
    lines.append(
        f"코스닥100 유니버스 기준 {summary['advancers']}종 상승·{summary['decliners']}종 하락, "
        f"우량(점수≥75) {summary['high_quality']}종으로 "
        f"{'강세' if summary['advancers'] > summary['decliners'] + 10 else '약세' if summary['decliners'] > summary['advancers'] + 10 else '혼조'} 흐름입니다."
    )
    if features:
        parts = []
        for r in features[:2]:
            chg = r.get("change_pct") or 0
            sign = "+" if chg > 0 else ""
            headline = ""
            heads = news.get(r["code"]) or []
            if heads:
                headline = f" — {heads[0].get('title', '')[:60]}"
            parts.append(f"{r['name']} {sign}{chg:.1f}%{headline}")
        lines.append("특징주: " + " / ".join(parts))
    top = summary.get("top_weight") or []
    if top:
        lines.append(
            "시총 상위는 "
            + ", ".join(f"{t['name']}({t['weight_pct']:.1f}%)" for t in top[:3])
            + "로 편중이 이어집니다."
        )
    med_roe = summary.get("median_roe")
    if med_roe is not None:
        lines.append(
            f"중앙 ROE {med_roe:.1f}%·우량 {summary['high_quality']}종 기준으로 "
            "개별 종목 펀더멘털 차이를 보며 선별 접근이 필요한 구간입니다."
        )
    while len(lines) < 3:
        lines.append("변동성 확대 구간에서는 추격보다 이슈·실적을 확인하는 편이 안전합니다.")
    return lines[:4]


def generate_briefing(
    rows: list[dict[str, Any]], summary: dict[str, Any]
) -> tuple[list[str], dict[str, Any]]:
    features = select_feature_stocks(rows)
    news = fetch_feature_news(features)
    meta = {
        "features": [
            {
                "code": r["code"],
                "name": r["name"],
                "change_pct": r.get("change_pct"),
                "value": r.get("value"),
                "theme": r.get("theme"),
            }
            for r in features
        ],
        "news": news,
    }
    context = _briefing_context(rows, summary, features, news)
    try:
        lines = generate_briefing_gemini(context)
        if len(lines) >= 3:
            meta["source"] = "gemini"
            return lines, meta
    except Exception as exc:
        meta["gemini_error"] = str(exc)
    lines = generate_briefing_fallback(summary, features, news)
    meta["source"] = "rule"
    return lines, meta


def build_payload(*, with_briefing: bool = True) -> dict[str, Any]:
    universe = load_universe()
    rows = build_rows(universe)
    summary = build_summary(rows)
    briefing: list[str] = []
    briefing_meta: dict[str, Any] = {}
    if with_briefing:
        briefing, briefing_meta = generate_briefing(rows, summary)

    return {
        "ok": bool(rows),
        "generated_at": _now_kst().isoformat(),
        "as_of": _today_kst(),
        "universe_as_of": universe.get("as_of"),
        "universe_count": len(rows),
        "universe_source": universe.get("source"),
        "schedule_note": SCHEDULE_NOTE,
        "weight_note": (
            "편입비는 코스닥100 유니버스 내 시가총액 비중 근사치입니다(공식 유동주식수 가중과 다를 수 있음)."
        ),
        "disclaimer": (
            "우량 점수·브리핑은 휴리스틱·공개 데이터 기반이며 투자 권유가 아닙니다."
        ),
        "briefing": briefing,
        "briefing_generated_at": _now_kst().isoformat() if briefing else None,
        "briefing_meta": briefing_meta,
        "summary": summary,
        "rows": rows,
        "source": "naver+universe",
    }


def save_local(payload: dict[str, Any]) -> Path:
    DATA_ROOT.mkdir(parents=True, exist_ok=True)
    LATEST_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return LATEST_PATH


def publish_r2(payload: dict[str, Any]) -> bool:
    try:
        from r2_data import put_json, r2_configured
    except Exception:
        return False
    if not r2_configured():
        return False
    return put_json(R2_KEY, payload)


def load_latest() -> dict[str, Any] | None:
    if LATEST_PATH.is_file():
        try:
            return json.loads(LATEST_PATH.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            pass
    try:
        from r2_data import get_json

        remote = get_json(R2_KEY)
        if remote:
            return remote
    except Exception:
        pass
    return None


def collect_all(*, persist: bool = True, with_briefing: bool = True) -> dict[str, Any]:
    payload = build_payload(with_briefing=with_briefing)
    if persist:
        save_local(payload)
        publish_r2(payload)
    return payload


if __name__ == "__main__":
    out = collect_all(persist=True, with_briefing=True)
    print(json.dumps({
        "ok": out.get("ok"),
        "as_of": out.get("as_of"),
        "briefing": out.get("briefing"),
        "n": len(out.get("rows") or []),
    }, ensure_ascii=False, indent=2))
