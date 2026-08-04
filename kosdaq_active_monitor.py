"""KOSDAQ Active ETF holdings compare — 6 funds, daily CU top weights.

Universe (2026): KoAct · TIME · PLUS · TIGER · MIDAS · DS
Source: Koscom ETF CHECK ``getEtfPdfRankListWeight`` (daily top PDF ranks)
Schedule: 15:50 KST (post close) via ``kosdaq_active_scheduler``

Layout
------
  data/kosdaq_active/{TICKER}/snapshots/{YYYY-MM-DD}.json
  data/kosdaq_active/{TICKER}/latest.json
  data/kosdaq_active/universe.json
  data/kosdaq_active/compare/latest.json
  R2: kosdaq_active/...
"""

from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path
from statistics import median
from typing import Any
from zoneinfo import ZoneInfo

KST = ZoneInfo("Asia/Seoul")
PROJECT_DIR = Path(__file__).resolve().parent
DATA_ROOT = PROJECT_DIR / "data" / "kosdaq_active"
UNIVERSE_PATH = DATA_ROOT / "universe.json"
COMPARE_LATEST_PATH = DATA_ROOT / "compare" / "latest.json"
R2_PREFIX = "kosdaq_active"

# Curated: the six plain “코스닥액티브” products (excludes covered-call / bond-mix / bio-only).
KOSDAQ_ACTIVE_UNIVERSE: list[dict[str, str]] = [
    {
        "ticker": "0163Y0",
        "name": "KoAct 코스닥액티브",
        "brand": "KoAct",
        "issuer": "삼성액티브자산운용",
    },
    {
        "ticker": "0162Y0",
        "name": "TIME 코스닥액티브",
        "brand": "TIME",
        "issuer": "타임폴리오자산운용",
    },
    {
        "ticker": "0166N0",
        "name": "PLUS 코스닥150액티브",
        "brand": "PLUS",
        "issuer": "한화자산운용",
    },
    {
        "ticker": "0204S0",
        "name": "TIGER 코스닥액티브",
        "brand": "TIGER",
        "issuer": "미래에셋자산운용",
    },
    {
        "ticker": "0191B0",
        "name": "MIDAS 코스닥액티브",
        "brand": "MIDAS",
        "issuer": "마이다스에셋자산운용",
    },
    {
        "ticker": "0220B0",
        "name": "DS 코스닥액티브",
        "brand": "DS",
        "issuer": "DS자산운용",
    },
]

CASH_CODES = {"CASH", "KRW", "KRD010010001"}
CASH_NAMES = {"원화현금", "현금", "예탁금", "기타"}

THEME_TAGS: list[tuple[str, tuple[str, ...]]] = [
    (
        "반도체 소부장",
        (
            "테스",
            "심텍",
            "피에스케이",
            "원익",
            "브이엠",
            "인텍플러스",
            "제주반도체",
            "주성엔지니어링",
            "티에스이",
            "리노공업",
            "티엘비",
            "성호전자",
            "이오테크닉스",
            "고영",
            "하나마이크론",
            "네패스",
            "파크시스템스",
            "유진테크",
            "디아이",
            "케이씨텍",
            "원익IPS",
            "원익QnC",
            "HPSP",
            "주성",
        ),
    ),
    (
        "바이오·헬스",
        (
            "알테오젠",
            "파마리서치",
            "삼천당",
            "펩트론",
            "에이비엘",
            "올릭스",
            "보로노이",
            "리가켐",
            "휴젤",
            "씨어스",
            "에스티팜",
            "오스코텍",
            "지아이이노베이션",
        ),
    ),
    (
        "2차전지",
        ("에코프로", "엘앤에프", "포스코퓨처엠", "더블유씨피", "서진시스템", "대주전자재료"),
    ),
    ("로봇·AI하드웨어", ("로보티즈", "레인보우로보틱스", "고영", "유니슨")),
]


def _now_kst() -> datetime:
    return datetime.now(KST)


def _ymd(value: str | None) -> str | None:
    if not value:
        return None
    s = str(value).strip()
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", s):
        return s
    compact = re.sub(r"\D", "", s)
    if len(compact) == 8:
        return f"{compact[:4]}-{compact[4:6]}-{compact[6:8]}"
    return None


def _is_cash(code: str, name: str) -> bool:
    c = (code or "").strip().upper()
    n = (name or "").strip()
    if n in CASH_NAMES or "현금" in n:
        return True
    if c in {"CASH", "KRW", "KRD010010001"}:
        return True
    return False


def theme_for(name: str) -> str | None:
    n = name or ""
    for theme, tokens in THEME_TAGS:
        if any(tok in n for tok in tokens):
            return theme
    return None


def _fund_dir(ticker: str) -> Path:
    return DATA_ROOT / ticker.upper()


def snapshot_path(ticker: str, as_of: str) -> Path:
    return _fund_dir(ticker) / "snapshots" / f"{as_of}.json"


def latest_path(ticker: str) -> Path:
    return _fund_dir(ticker) / "latest.json"


def load_snapshot(ticker: str, as_of: str | None = None) -> dict[str, Any] | None:
    path = snapshot_path(ticker, as_of) if as_of else latest_path(ticker)
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def list_snapshot_dates(ticker: str) -> list[str]:
    folder = _fund_dir(ticker) / "snapshots"
    if not folder.is_dir():
        return []
    out: list[str] = []
    for path in folder.glob("*.json"):
        day = _ymd(path.stem)
        if day:
            out.append(day)
    return sorted(out)


def previous_snapshot(ticker: str, as_of: str) -> dict[str, Any] | None:
    dates = [d for d in list_snapshot_dates(ticker) if d < as_of]
    if not dates:
        # try R2
        try:
            from r2_data import get_json, list_prefix_keys

            keys = list_prefix_keys(f"{R2_PREFIX}/{ticker.upper()}/snapshots/")
            days = sorted(
                d
                for k in keys
                if (d := _ymd(k.rsplit("/", 1)[-1].replace(".json", ""))) and d < as_of
            )
            if days:
                return get_json(f"{R2_PREFIX}/{ticker.upper()}/snapshots/{days[-1]}.json")
        except Exception:
            pass
        return None
    return load_snapshot(ticker, dates[-1])


def save_snapshot(snapshot: dict[str, Any]) -> Path:
    ticker = str(snapshot["ticker"]).upper()
    as_of = str(snapshot["as_of"])
    folder = _fund_dir(ticker) / "snapshots"
    folder.mkdir(parents=True, exist_ok=True)
    path = snapshot_path(ticker, as_of)
    path.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2), encoding="utf-8")
    latest_path(ticker).write_text(
        json.dumps(snapshot, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return path


def publish_to_r2(snapshot: dict[str, Any]) -> bool:
    try:
        from r2_data import put_json, r2_configured
    except Exception:
        return False
    if not r2_configured():
        return False
    ticker = str(snapshot["ticker"]).upper()
    as_of = str(snapshot["as_of"])
    put_json(f"{R2_PREFIX}/{ticker}/snapshots/{as_of}.json", snapshot)
    put_json(f"{R2_PREFIX}/{ticker}/latest.json", snapshot)
    return True


def save_universe(entries: list[dict[str, Any]]) -> None:
    payload = {
        "updated_at": _now_kst().isoformat(),
        "count": len(entries),
        "tickers": entries,
        "schedule_note": "매일 15:50 KST(장마감 후) ETF CHECK PDF 상위 편입비 스냅샷",
    }
    DATA_ROOT.mkdir(parents=True, exist_ok=True)
    UNIVERSE_PATH.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    try:
        from r2_data import put_json, r2_configured

        if r2_configured():
            put_json(f"{R2_PREFIX}/universe.json", payload)
    except Exception:
        pass


def load_universe() -> dict[str, Any]:
    if UNIVERSE_PATH.is_file():
        try:
            return json.loads(UNIVERSE_PATH.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            pass
    try:
        from r2_data import get_json

        remote = get_json(f"{R2_PREFIX}/universe.json")
        if remote:
            return remote
    except Exception:
        pass
    return {
        "updated_at": None,
        "count": len(KOSDAQ_ACTIVE_UNIVERSE),
        "tickers": [
            {**u, "as_of": None, "aum_krw_eok": None, "holdings": None}
            for u in KOSDAQ_ACTIVE_UNIVERSE
        ],
        "schedule_note": "매일 15:50 KST(장마감 후) ETF CHECK PDF 상위 편입비 스냅샷",
    }


def _parse_aum_eok(raw: Any) -> float | None:
    if raw is None:
        return None
    if isinstance(raw, (int, float)):
        # Naver marketValue sometimes already in 억 units as string elsewhere
        return float(raw) if raw < 1_000_000 else float(raw) / 1e8
    text = str(raw).replace(",", "").replace("억", "").strip()
    try:
        return float(text)
    except ValueError:
        return None


def fetch_fund_snapshot(meta: dict[str, str]) -> dict[str, Any]:
    from dart_etf_memb import fetch_etf_meta
    from etfcheck_client import EtfCheckClient, fetch_kr_pdf_weights

    ticker = meta["ticker"]
    client = EtfCheckClient()
    rows = fetch_kr_pdf_weights(client, ticker, limit=30)
    as_of = None
    holdings: list[dict[str, Any]] = []
    for row in rows:
        code = str(row.get("code") or "").strip()
        name = str(row.get("name") or "").strip()
        if not code and not name:
            continue
        if _is_cash(code, name):
            continue
        # Skip self-cash rows that reuse ETF ticker as code
        if code.upper() == ticker.upper() and ("현금" in name or not name):
            continue
        weight = row.get("weight_pct")
        try:
            weight_f = float(weight) if weight is not None else None
        except (TypeError, ValueError):
            weight_f = None
        as_of = as_of or _ymd(str(row.get("as_of") or ""))
        holdings.append(
            {
                "code": code or name,
                "name": name or code,
                "weight_pct": weight_f,
                "price": row.get("price"),
                "change_pct": row.get("change_pct"),
                "theme": theme_for(name or code),
            }
        )

    naver_meta: dict[str, Any] = {}
    try:
        naver_meta = fetch_etf_meta(ticker)
    except Exception:
        naver_meta = {}

    if not as_of:
        as_of = _now_kst().strftime("%Y-%m-%d")

    aum = _parse_aum_eok(naver_meta.get("market_value") or naver_meta.get("total_nav"))

    return {
        "ok": True,
        "ticker": ticker,
        "name": naver_meta.get("name") or meta["name"],
        "brand": meta["brand"],
        "issuer": naver_meta.get("issuer") or meta["issuer"],
        "as_of": as_of,
        "aum_krw_eok": aum,
        "source": "etfcheck",
        "source_note": "ETF CHECK 일별 PDF 상위 편입비중 (공개 랭킹 · 전 종목 CU 아님)",
        "generated_at": _now_kst().isoformat(),
        "count": len(holdings),
        "holdings": holdings,
        "top": holdings[:10],
    }


def compare_holdings(
    current: list[dict[str, Any]],
    previous: list[dict[str, Any]] | None,
    *,
    previous_as_of: str | None = None,
) -> dict[str, Any]:
    if not previous:
        return {
            "has_previous": False,
            "previous_as_of": None,
            "added": [],
            "removed": [],
            "increased": [],
            "decreased": [],
            "note": "직전 스냅샷이 없어 편출입 비교는 내일부터 표시됩니다.",
        }

    prev_map = {str(r["code"]): r for r in previous if r.get("code")}
    curr_map = {str(r["code"]): r for r in current if r.get("code")}
    added = []
    for code in curr_map.keys() - prev_map.keys():
        row = curr_map[code]
        added.append(
            {
                "code": code,
                "name": row.get("name"),
                "weight_pct": row.get("weight_pct"),
                "theme": row.get("theme"),
            }
        )
    removed = []
    for code in prev_map.keys() - curr_map.keys():
        row = prev_map[code]
        removed.append(
            {
                "code": code,
                "name": row.get("name"),
                "weight_pct": row.get("weight_pct"),
                "theme": row.get("theme"),
            }
        )
    increased: list[dict[str, Any]] = []
    decreased: list[dict[str, Any]] = []
    for code in curr_map.keys() & prev_map.keys():
        before = prev_map[code].get("weight_pct")
        after = curr_map[code].get("weight_pct")
        if before is None or after is None:
            continue
        delta = float(after) - float(before)
        if abs(delta) < 0.05:
            continue
        item = {
            "code": code,
            "name": curr_map[code].get("name"),
            "before": float(before),
            "after": float(after),
            "delta": delta,
            "theme": curr_map[code].get("theme"),
        }
        if delta > 0:
            increased.append(item)
        else:
            decreased.append(item)
    increased.sort(key=lambda r: r["delta"], reverse=True)
    decreased.sort(key=lambda r: r["delta"])
    added.sort(key=lambda r: (r.get("weight_pct") is None, -(r.get("weight_pct") or 0)))
    removed.sort(key=lambda r: (r.get("weight_pct") is None, -(r.get("weight_pct") or 0)))
    return {
        "has_previous": True,
        "previous_as_of": previous_as_of,
        "added": added,
        "removed": removed,
        "increased": increased,
        "decreased": decreased,
        "note": None,
    }


def _build_matrix(funds: list[dict[str, Any]]) -> list[dict[str, Any]]:
    # code -> name/theme + weights by ticker
    stock_map: dict[str, dict[str, Any]] = {}
    for fund in funds:
        ticker = fund["ticker"]
        for row in fund.get("holdings") or []:
            code = str(row.get("code") or "")
            if not code:
                continue
            entry = stock_map.setdefault(
                code,
                {
                    "code": code,
                    "name": row.get("name") or code,
                    "theme": row.get("theme"),
                    "weights": {},
                    "fund_count": 0,
                },
            )
            w = row.get("weight_pct")
            if w is None:
                continue
            entry["weights"][ticker] = float(w)
            if not entry.get("theme"):
                entry["theme"] = row.get("theme")
            if entry.get("name") in (None, code) and row.get("name"):
                entry["name"] = row["name"]

    rows: list[dict[str, Any]] = []
    for code, entry in stock_map.items():
        weights = entry["weights"]
        vals = list(weights.values())
        if not vals:
            continue
        entry["fund_count"] = len(weights)
        entry["avg_weight"] = sum(vals) / len(vals)
        entry["max_weight"] = max(vals)
        entry["median_weight"] = float(median(vals)) if vals else None
        rows.append(entry)
    rows.sort(
        key=lambda r: (-int(r["fund_count"]), -(r.get("avg_weight") or 0), r["code"])
    )
    return rows


def _manager_overweights(
    funds: list[dict[str, Any]], matrix: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    fund_by_ticker = {f["ticker"]: f for f in funds}
    for row in matrix:
        weights: dict[str, float] = row.get("weights") or {}
        if len(weights) < 1:
            continue
        peer_vals = list(weights.values())
        peer_med = float(median(peer_vals)) if peer_vals else 0.0
        for ticker, w in weights.items():
            # vs peers that also hold, else vs 0
            others = [v for t, v in weights.items() if t != ticker]
            base = float(median(others)) if others else 0.0
            delta = w - base
            if delta < 0.8:  # material idiosyncratic overweight
                continue
            fund = fund_by_ticker.get(ticker) or {}
            out.append(
                {
                    "ticker": ticker,
                    "brand": fund.get("brand"),
                    "issuer": fund.get("issuer"),
                    "fund_name": fund.get("name"),
                    "code": row["code"],
                    "name": row["name"],
                    "theme": row.get("theme"),
                    "weight_pct": w,
                    "peer_median": base,
                    "delta_vs_peers": delta,
                    "fund_count": row["fund_count"],
                    "rationale": _rationale_overweight(
                        fund.get("brand") or ticker,
                        row.get("name") or row["code"],
                        w,
                        base,
                        row.get("theme"),
                        row["fund_count"],
                    ),
                }
            )
    out.sort(key=lambda r: r["delta_vs_peers"], reverse=True)
    return out[:40]


def _rationale_overweight(
    brand: str,
    name: str,
    weight: float,
    peer_med: float,
    theme: str | None,
    fund_count: int,
) -> str:
    theme_bit = f"{theme} 테마 내에서 " if theme else ""
    if fund_count <= 1:
        return (
            f"{brand}만 상위 랭킹에 {name} {weight:.2f}% 편입 — "
            f"{theme_bit}운용사 고유 아이디어(피어 상위권 미편입)."
        )
    if peer_med <= 0.05:
        return (
            f"{brand}이(가) {name}을(를) {weight:.2f}%로 가져가 피어 대비 뚜렷한 오버웨이트입니다."
        )
    return (
        f"{brand} {name} {weight:.2f}% vs 피어 중앙값 {peer_med:.2f}% "
        f"(+{weight - peer_med:.2f}pp) — {theme_bit}상대적 비중확대."
    )


def _build_insights(
    funds: list[dict[str, Any]],
    matrix: list[dict[str, Any]],
    overweights: list[dict[str, Any]],
) -> list[str]:
    lines: list[str] = []
    consensus = [r for r in matrix if r["fund_count"] >= 4][:5]
    if consensus:
        names = ", ".join(
            f"{r['name']}({r['fund_count']}/6)" for r in consensus
        )
        lines.append(f"다수 운용사 공통 상위 편입: {names}")

    theme_hits: dict[str, int] = {}
    for r in matrix:
        if r["fund_count"] >= 3 and r.get("theme"):
            theme_hits[r["theme"]] = theme_hits.get(r["theme"], 0) + 1
    if theme_hits:
        top_theme = max(theme_hits.items(), key=lambda kv: kv[1])
        lines.append(
            f"공통 상위권 테마 집중: {top_theme[0]} ({top_theme[1]}개 종목이 3개 이상 ETF 상위권)"
        )

    for ow in overweights[:3]:
        lines.append(ow["rationale"])

    # Day-over-day highlights
    bumps: list[tuple[str, dict[str, Any]]] = []
    for fund in funds:
        flow = fund.get("flow") or {}
        for item in (flow.get("increased") or [])[:2]:
            bumps.append((fund.get("brand") or fund["ticker"], item))
        for item in (flow.get("added") or [])[:1]:
            bumps.append(
                (
                    fund.get("brand") or fund["ticker"],
                    {
                        **item,
                        "delta": item.get("weight_pct"),
                        "after": item.get("weight_pct"),
                        "before": 0,
                    },
                )
            )
    bumps.sort(key=lambda x: abs(float(x[1].get("delta") or 0)), reverse=True)
    for brand, item in bumps[:4]:
        delta = item.get("delta")
        name = item.get("name")
        if item.get("before") == 0 and item.get("after") == item.get("weight_pct"):
            lines.append(
                f"{brand} 신규 상위 편입: {name} {float(item.get('weight_pct') or 0):.2f}%"
            )
        elif delta is not None:
            lines.append(
                f"{brand} 비중확대: {name} "
                f"{float(item.get('before') or 0):.2f}%→{float(item.get('after') or 0):.2f}% "
                f"({float(delta):+.2f}pp)"
            )

    if not lines:
        lines.append("해석 포인트가 충분하지 않습니다. 스냅샷 축적 후 편출입 비교가 풍부해집니다.")
    return lines[:10]


def build_compare_payload(funds: list[dict[str, Any]]) -> dict[str, Any]:
    matrix = _build_matrix(funds)
    overweights = _manager_overweights(funds, matrix)
    insights = _build_insights(funds, matrix, overweights)
    as_of_dates = sorted({f.get("as_of") for f in funds if f.get("as_of")})
    return {
        "ok": True,
        "generated_at": _now_kst().isoformat(),
        "as_of": as_of_dates[-1] if as_of_dates else None,
        "as_of_list": as_of_dates,
        "schedule_note": "매일 15:50 KST 장마감 후 ETF CHECK 편입비 스냅샷 · 웹은 장중에도 최신 공개 랭킹을 불러옵니다",
        "disclaimer": "운용사 공식 코멘트가 아닌 PDF 상위 랭킹·피어 대비 휴리스틱 해석입니다. 투자 권유가 아닙니다.",
        "source_note": "ETF CHECK 일별 PDF 상위 편입비중(보통 Top10 내외, 현금 제외) · Naver 메타(AUM/운용사)",
        "universe_count": len(funds),
        "funds": funds,
        "matrix": matrix[:60],
        "consensus": [r for r in matrix if r["fund_count"] >= 3][:25],
        "manager_overweights": overweights[:25],
        "insights": insights,
        "universe": load_universe(),
    }


def enrich_fund_with_flow(snapshot: dict[str, Any]) -> dict[str, Any]:
    as_of = str(snapshot.get("as_of") or "")
    prev = previous_snapshot(snapshot["ticker"], as_of) if as_of else None
    flow = compare_holdings(
        snapshot.get("holdings") or [],
        (prev or {}).get("holdings"),
        previous_as_of=(prev or {}).get("as_of"),
    )
    out = dict(snapshot)
    out["flow"] = flow
    return out


def collect_all(*, persist: bool = True) -> dict[str, Any]:
    funds: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    universe_entries: list[dict[str, Any]] = []

    for meta in KOSDAQ_ACTIVE_UNIVERSE:
        try:
            snap = fetch_fund_snapshot(meta)
            if persist:
                save_snapshot(snap)
                publish_to_r2(snap)
            enriched = enrich_fund_with_flow(snap)
            funds.append(enriched)
            universe_entries.append(
                {
                    **meta,
                    "name": enriched.get("name") or meta["name"],
                    "issuer": enriched.get("issuer") or meta["issuer"],
                    "as_of": enriched.get("as_of"),
                    "aum_krw_eok": enriched.get("aum_krw_eok"),
                    "holdings": enriched.get("count"),
                }
            )
        except Exception as exc:
            errors.append({"ticker": meta["ticker"], "error": str(exc)})
            funds.append(
                {
                    "ok": False,
                    "ticker": meta["ticker"],
                    "name": meta["name"],
                    "brand": meta["brand"],
                    "issuer": meta["issuer"],
                    "as_of": None,
                    "aum_krw_eok": None,
                    "holdings": [],
                    "top": [],
                    "flow": {
                        "has_previous": False,
                        "added": [],
                        "removed": [],
                        "increased": [],
                        "decreased": [],
                        "note": str(exc),
                    },
                    "error": str(exc),
                }
            )
            universe_entries.append({**meta, "as_of": None, "error": str(exc)})

    if persist:
        save_universe(universe_entries)

    payload = build_compare_payload(funds)
    payload["errors"] = errors
    payload["ok"] = len([f for f in funds if f.get("ok") is not False and f.get("holdings")]) >= 1

    if persist:
        COMPARE_LATEST_PATH.parent.mkdir(parents=True, exist_ok=True)
        COMPARE_LATEST_PATH.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        try:
            from r2_data import put_json, r2_configured

            if r2_configured():
                put_json(f"{R2_PREFIX}/compare/latest.json", payload)
        except Exception:
            pass

    return payload


def compare_payload_from_store() -> dict[str, Any] | None:
    if COMPARE_LATEST_PATH.is_file():
        try:
            return json.loads(COMPARE_LATEST_PATH.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            pass
    try:
        from r2_data import get_json

        remote = get_json(f"{R2_PREFIX}/compare/latest.json")
        if remote:
            return remote
    except Exception:
        pass

    # Rebuild from per-fund latest if compare missing
    funds: list[dict[str, Any]] = []
    for meta in KOSDAQ_ACTIVE_UNIVERSE:
        snap = load_snapshot(meta["ticker"])
        if not snap:
            try:
                from r2_data import get_json

                snap = get_json(f"{R2_PREFIX}/{meta['ticker']}/latest.json")
            except Exception:
                snap = None
        if snap:
            funds.append(enrich_fund_with_flow(snap))
    if not funds:
        return None
    return build_compare_payload(funds)


if __name__ == "__main__":
    result = collect_all(persist=True)
    print(
        json.dumps(
            {
                "ok": result.get("ok"),
                "as_of": result.get("as_of"),
                "funds": [
                    {
                        "ticker": f.get("ticker"),
                        "name": f.get("name"),
                        "count": len(f.get("holdings") or []),
                        "top1": (f.get("holdings") or [{}])[0].get("name"),
                    }
                    for f in result.get("funds") or []
                ],
                "insights": result.get("insights"),
                "errors": result.get("errors"),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
