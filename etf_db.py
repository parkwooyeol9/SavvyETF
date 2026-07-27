"""Korean listed ETF database — universe, classification, AUM & estimated flows.

Source: Naver Finance ``/api/sise/etfItemList.nhn`` (full KRX ETF list).

Classification dimensions:
  - type (유형): Naver ETF tab (국내 시장지수 / 업종·테마 / 파생 / 해외 / …)
  - country (국가): name heuristics + domestic tabs → 한국
  - sector (업종): theme/keyword heuristics with type fallbacks

AUM ≈ Naver ``marketSum`` (억원).
설정좌수 ≈ AUM / NAV (fallback: AUM / price).
수급(추정) = NAV × Δ설정좌수 (requires prior daily snapshot).
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import requests

KST = ZoneInfo("Asia/Seoul")
PROJECT_DIR = Path(__file__).resolve().parent
DATA_DIR = PROJECT_DIR / "data" / "etf_db"
SNAPSHOT_DIR = DATA_DIR / "snapshots"
LATEST_PATH = DATA_DIR / "latest.json"
HTML_PATH = DATA_DIR / "etfdb.html"
META_PATH = DATA_DIR / "etfdb_meta.json"

NAVER_ETF_LIST_URL = "https://finance.naver.com/api/sise/etfItemList.nhn"
NAVER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Referer": "https://finance.naver.com/sise/etf.naver",
}

# Naver etfTabCode ↔ 유형 (updateEtfItemListTable on finance.naver.com/sise/etf.naver)
TYPE_BY_TAB: dict[int, str] = {
    1: "국내 시장지수",
    2: "국내 업종/테마",
    3: "국내 파생",
    4: "해외 주식",
    5: "원자재",
    6: "채권",
    7: "기타",
}

# (label, keywords) — first match wins; longer/more specific keywords first where needed
COUNTRY_RULES: list[tuple[str, list[str]]] = [
    ("미국", ["미국", "S&P", "나스닥", "NASDAQ", "필라델피아", "다우", "러셀", "러셀2000", "QQQ"]),
    ("중국", ["중국", "홍콩", "항셍", "CSI", "본토", "차이나", "항셍테크"]),
    ("일본", ["일본", "니케이", "토픽스", "TOPIX", "닛케이"]),
    ("유럽", ["유럽", "유로", "독일", "STOXX", "유로스탁스"]),
    ("인도", ["인도"]),
    ("베트남", ["베트남"]),
    ("대만", ["대만", "타이완"]),
    ("브라질", ["브라질"]),
    ("신흥", ["신흥", "이머징", "EM ", "EM전", "글로벌신흥"]),
    ("글로벌", ["글로벌", "세계", "월드", "ACWI", "선진국", "MSCI월드"]),
]

# Style overlays (name match) — checked before GICS
STYLE_SECTOR_RULES: list[tuple[str, list[str]]] = [
    ("커버드콜", ["커버드콜"]),
    ("액티브", ["액티브"]),
    ("배당", ["고배당", "월배당", "배당", "인컴"]),
]

# GICS 11 sectors (+ Korean ETF name heuristics)
GICS_SECTOR_RULES: list[tuple[str, list[str]]] = [
    ("헬스케어", ["헬스케어", "바이오", "의료", "제약", "HEALTH"]),
    ("에너지", ["에너지", "원유", "천연가스", "WTI", "석유", "가스"]),
    ("소재", ["소재", "철강", "구리", "리튬", "화학", "금현물", "금선물", "은선물", "은현물", "골드", "원자재", "농산물"]),
    ("산업재", ["산업재", "방산", "우주", "항공", "조선", "해운", "건설", "인프라", "운송", "기계"]),
    ("경기소비재", ["자동차", "자율주행", "화장품", "유통", "리테일", "게임", "엔터", "소비재"]),
    ("필수소비재", ["필수소비"]),
    ("금융", ["금융", "은행", "증권", "보험", "고배당금융"]),
    ("IT", ["반도체", "AI반도체", "필라델피아반도체", "HBM", "칩", "소프트웨어", "테크", "IT", "기술"]),
    ("커뮤니케이션", ["통신", "인터넷", "미디어", "콘텐츠", "SNS"]),
    ("유틸리티", ["유틸", "전력", "원전", "태양광", "풍력", "그리드"]),
    ("부동산", ["리츠", "부동산", "REIT"]),
]

# Non-GICS fallbacks after style + GICS
SECTOR_FALLBACK_RULES: list[tuple[str, list[str]]] = [
    ("레버리지/인버스", ["레버리지", "인버스", "2X", "선물인버스"]),
    ("채권", ["채권", "국채", "회사채", "CD금리", "KOFR", "머니마켓", "단기채", "중장기", "금리"]),
    ("시장지수", ["200", "코스피", "코스닥", "KRX", "MSCI Korea", "KOSPI", "KOSDAQ", "S&P500", "나스닥100"]),
]

MAX_SNAPSHOTS = 90
STALE_HOURS = 6


def is_etfdb_command(command: str) -> bool:
    token = command.strip().split()[0].lower() if command.strip() else ""
    return token in {"/etfdb", "/etf_db", "/etf디비", "/etfDB"}


def parse_etfdb_dimension(command: str) -> str:
    parts = command.strip().split()
    if len(parts) < 2:
        return "type"
    aliases = {
        "type": "type",
        "유형": "type",
        "tab": "type",
        "country": "country",
        "국가": "country",
        "nation": "country",
        "sector": "sector",
        "업종": "sector",
        "테마": "sector",
        "theme": "sector",
    }
    key = parts[1].lower()
    if key not in aliases:
        raise ValueError(
            "Usage: /etfdb [type|country|sector]\n"
            "예: /etfdb · /etfdb 유형 · /etfdb 국가 · /etfdb 업종"
        )
    return aliases[key]


def fetch_naver_etf_universe() -> list[dict[str, Any]]:
    response = requests.get(NAVER_ETF_LIST_URL, headers=NAVER_HEADERS, timeout=45)
    response.raise_for_status()
    # Naver returns charset=EUC-KR; requests may mis-decode as ISO-8859-1/UTF-8.
    raw = response.content
    text: str
    for encoding in ("euc-kr", "cp949", "utf-8"):
        try:
            text = raw.decode(encoding)
            if encoding != "utf-8" or "\ufffd" not in text[:800]:
                break
        except UnicodeDecodeError:
            continue
    else:
        text = raw.decode("utf-8", errors="replace")
    payload = json.loads(text)
    items = ((payload.get("result") or {}).get("etfItemList")) or []
    if not isinstance(items, list) or not items:
        raise RuntimeError("Naver ETF list empty or unexpected shape")
    return items


def _match_label(name: str, rules: list[tuple[str, list[str]]]) -> str | None:
    upper = name.upper()
    for label, keywords in rules:
        for kw in keywords:
            if kw.upper() in upper or kw in name:
                return label
    return None


def classify_sector(name: str, tab: int) -> str:
    """Style overlays (커버드콜/액티브/배당) → GICS → fallbacks."""
    for rules in (STYLE_SECTOR_RULES, GICS_SECTOR_RULES, SECTOR_FALLBACK_RULES):
        hit = _match_label(name, rules)
        if hit:
            return hit
    return {
        1: "시장지수",
        2: "기타",
        3: "레버리지/인버스",
        4: "기타",
        5: "소재",
        6: "채권",
        7: "기타",
    }.get(tab, "기타")


def classify_etf(item: dict[str, Any]) -> dict[str, Any]:
    code = str(item.get("itemcode") or "").strip()
    name = str(item.get("itemname") or "").strip()
    tab = int(item.get("etfTabCode") or 0)
    etf_type = TYPE_BY_TAB.get(tab, "기타")

    country = _match_label(name, COUNTRY_RULES)
    if country is None:
        if tab in {1, 2, 3}:
            country = "한국"
        elif tab == 4:
            country = "해외(기타)"
        elif tab == 5:
            country = "원자재/기타"
        elif tab == 6:
            country = "한국" if not any(
                k in name for k in ("미국", "글로벌", "세계", "선진", "신흥", "중국", "일본", "유럽")
            ) else "해외채권"
        else:
            country = "기타"

    sector = classify_sector(name, tab)

    nav = _as_float(item.get("nav"))
    price = _as_float(item.get("nowVal"))
    # Naver marketSum is in 억원
    market_sum_eok = _as_float(item.get("marketSum")) or 0.0
    aum_won = market_sum_eok * 1e8
    denom = nav if nav and nav > 0 else price
    units = (aum_won / denom) if denom and denom > 0 else None

    return {
        "code": code,
        "name": name,
        "tab_code": tab,
        "type": etf_type,
        "country": country,
        "sector": sector,
        "price": price,
        "nav": nav,
        "change_rate": _as_float(item.get("changeRate")),
        "volume": _as_float(item.get("quant")),
        "turnover": _as_float(item.get("amonut")),
        "return_3m": _as_float(item.get("threeMonthEarnRate")),
        "aum_eok": market_sum_eok,
        "aum_won": aum_won,
        "units": units,
    }


def _as_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def build_universe_rows(raw_items: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    items = raw_items if raw_items is not None else fetch_naver_etf_universe()
    rows = [classify_etf(item) for item in items]
    rows.sort(key=lambda r: (-(r.get("aum_eok") or 0), r.get("name") or ""))
    return rows


def _snapshot_path(day: str) -> Path:
    return SNAPSHOT_DIR / f"{day}.json"


def save_snapshot(rows: list[dict[str, Any]], *, day: str | None = None) -> Path:
    SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)
    day = day or datetime.now(KST).strftime("%Y-%m-%d")
    path = _snapshot_path(day)
    compact = [
        {
            "code": r["code"],
            "nav": r.get("nav"),
            "units": r.get("units"),
            "aum_eok": r.get("aum_eok"),
            "type": r.get("type"),
            "country": r.get("country"),
            "sector": r.get("sector"),
        }
        for r in rows
    ]
    path.write_text(
        json.dumps({"date": day, "count": len(compact), "rows": compact}, ensure_ascii=False),
        encoding="utf-8",
    )
    _prune_snapshots()
    return path


def _prune_snapshots() -> None:
    files = sorted(SNAPSHOT_DIR.glob("*.json"))
    for old in files[:-MAX_SNAPSHOTS]:
        try:
            old.unlink()
        except OSError:
            pass


def list_snapshot_days() -> list[str]:
    if not SNAPSHOT_DIR.is_dir():
        return []
    return sorted(p.stem for p in SNAPSHOT_DIR.glob("*.json"))


def load_snapshot(day: str) -> dict[str, Any] | None:
    path = _snapshot_path(day)
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def compute_flows(
    current_rows: list[dict[str, Any]],
    previous: dict[str, Any] | None,
) -> dict[str, float]:
    """Return code → flow_won = NAV_t × (units_t − units_{t-1})."""
    if not previous:
        return {}
    prev_map = {r["code"]: r for r in (previous.get("rows") or []) if r.get("code")}
    flows: dict[str, float] = {}
    for row in current_rows:
        code = row.get("code")
        if not code:
            continue
        prev = prev_map.get(code)
        if not prev:
            continue
        units = row.get("units")
        prev_units = prev.get("units")
        nav = row.get("nav")
        if units is None or prev_units is None or nav is None:
            continue
        flows[code] = float(nav) * (float(units) - float(prev_units))
    return flows


def aggregate(
    rows: list[dict[str, Any]],
    *,
    dimension: str,
    flows: dict[str, float] | None = None,
) -> list[dict[str, Any]]:
    flows = flows or {}
    buckets: dict[str, dict[str, Any]] = {}
    for row in rows:
        key = str(row.get(dimension) or "기타")
        bucket = buckets.setdefault(
            key,
            {
                "label": key,
                "count": 0,
                "aum_eok": 0.0,
                "flow_won": 0.0,
                "flow_available": False,
            },
        )
        bucket["count"] += 1
        bucket["aum_eok"] += float(row.get("aum_eok") or 0)
        code = row.get("code")
        if code in flows:
            bucket["flow_won"] += flows[code]
            bucket["flow_available"] = True

    total_aum = sum(b["aum_eok"] for b in buckets.values()) or 1.0
    out = sorted(buckets.values(), key=lambda b: -b["aum_eok"])
    for bucket in out:
        bucket["aum_share_pct"] = 100.0 * bucket["aum_eok"] / total_aum
        bucket["flow_eok"] = bucket["flow_won"] / 1e8
    return out


def aum_history_by_dimension(
    dimension: str,
    *,
    limit_days: int = 60,
    live_rows: list[dict[str, Any]] | None = None,
    live_day: str | None = None,
) -> dict[str, Any]:
    """Daily category AUM sums from snapshots, optionally overlaying live Naver totals."""
    days = list_snapshot_days()[-limit_days:]
    dates: list[str] = []
    series: dict[str, list[float | None]] = {"전체": []}

    for day in days:
        snap = load_snapshot(day)
        if not snap:
            continue
        rows = snap.get("rows") or []
        aggs = aggregate(rows, dimension=dimension, flows={})
        dates.append(day)
        seen: set[str] = {"전체"}
        total = 0.0
        for a in aggs:
            label = a["label"]
            seen.add(label)
            total += float(a["aum_eok"] or 0)
            if label not in series:
                series[label] = [None] * (len(dates) - 1)
            series[label].append(float(a["aum_eok"] or 0))
        for label in list(series.keys()):
            if label not in seen:
                series[label].append(None)
        series["전체"].append(total)

    if live_rows is not None and live_day:
        live_aggs = aggregate(live_rows, dimension=dimension, flows={})
        live_total = sum(float(a["aum_eok"] or 0) for a in live_aggs)
        if dates and dates[-1] == live_day:
            series["전체"][-1] = live_total
            seen = {"전체"}
            for a in live_aggs:
                label = a["label"]
                seen.add(label)
                if label not in series:
                    series[label] = [None] * len(dates)
                series[label][-1] = float(a["aum_eok"] or 0)
            for label in series:
                if label not in seen and label != "전체":
                    series[label][-1] = None
        else:
            dates.append(live_day)
            for label in series:
                series[label].append(None)
            series["전체"][-1] = live_total
            for a in live_aggs:
                label = a["label"]
                if label not in series:
                    series[label] = [None] * (len(dates) - 1) + [float(a["aum_eok"] or 0)]
                else:
                    series[label][-1] = float(a["aum_eok"] or 0)
    ranked = sorted(
        (k for k in series if k != "전체"),
        key=lambda lab: -sum(v or 0 for v in series[lab][-10:]),
    )
    live_labels: list[str] = []
    if live_rows is not None:
        live_labels = [a["label"] for a in aggregate(live_rows, dimension=dimension, flows={})]
    keep = []
    for label in ["전체", *ranked[:12], *live_labels]:
        if label in series and label not in keep:
            keep.append(label)
    return {
        "dimension": dimension,
        "dates": dates,
        "series": {k: series[k] for k in keep},
    }


def flow_history_by_dimension(
    dimension: str,
    *,
    limit_days: int = 60,
) -> dict[str, Any]:
    """Build daily category flow series from stored snapshots."""
    days = list_snapshot_days()[-limit_days:]
    if len(days) < 2:
        return {"dates": [], "series": {}, "dimension": dimension}

    dates: list[str] = []
    series: dict[str, list[float | None]] = {}
    prev = load_snapshot(days[0])
    for day in days[1:]:
        cur = load_snapshot(day)
        if not cur or not prev:
            prev = cur
            continue
        prev_map = {r["code"]: r for r in (prev.get("rows") or [])}
        rows: list[dict[str, Any]] = []
        flows: dict[str, float] = {}
        for r in cur.get("rows") or []:
            code = r.get("code")
            rows.append(r)
            p = prev_map.get(code or "")
            if not p:
                continue
            units, p_units, nav = r.get("units"), p.get("units"), r.get("nav")
            if units is None or p_units is None or nav is None:
                continue
            flows[str(code)] = float(nav) * (float(units) - float(p_units))
        aggs = aggregate(rows, dimension=dimension, flows=flows)
        dates.append(day)
        seen: set[str] = set()
        for a in aggs:
            label = a["label"]
            seen.add(label)
            if label not in series:
                series[label] = [None] * (len(dates) - 1)
            series[label].append(a["flow_eok"])
        for label in series:
            if label not in seen:
                series[label].append(None)
        prev = cur

    ranked = sorted(
        series.keys(),
        key=lambda lab: -sum(abs(v or 0) for v in series[lab][-10:]),
    )
    return {
        "dimension": dimension,
        "dates": dates,
        "series": {k: series[k] for k in ranked[:12]},
    }


def build_etf_db(*, force_fetch: bool = True) -> dict[str, Any]:
    """Fetch (optional), classify, snapshot, persist latest + HTML."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    generated_at = datetime.now(KST)
    day = generated_at.strftime("%Y-%m-%d")

    if not force_fetch and LATEST_PATH.is_file():
        try:
            cached = json.loads(LATEST_PATH.read_text(encoding="utf-8"))
            if cached.get("rows"):
                return cached
        except (OSError, json.JSONDecodeError):
            pass

    rows = build_universe_rows()
    save_snapshot(rows, day=day)

    days = list_snapshot_days()
    prev_day = days[-2] if len(days) >= 2 and days[-1] == day else (days[-1] if days and days[-1] != day else None)
    if prev_day is None and len(days) >= 2:
        prev_day = days[-2]
    previous = load_snapshot(prev_day) if prev_day else None
    # Avoid comparing to same-day overwrite only: if only one day, no flow
    if previous and previous.get("date") == day:
        earlier = [d for d in days if d < day]
        previous = load_snapshot(earlier[-1]) if earlier else None

    flows = compute_flows(rows, previous)
    for row in rows:
        code = row["code"]
        if code in flows:
            row["flow_won"] = flows[code]
            row["flow_eok"] = flows[code] / 1e8
        else:
            row["flow_won"] = None
            row["flow_eok"] = None

    payload: dict[str, Any] = {
        "generated_at": generated_at.isoformat(),
        "generated_at_display": generated_at.strftime("%Y-%m-%d %H:%M KST"),
        "source": NAVER_ETF_LIST_URL,
        "as_of": day,
        "prev_as_of": previous.get("date") if previous else None,
        "count": len(rows),
        "total_aum_eok": sum(float(r.get("aum_eok") or 0) for r in rows),
        "flow_pair_count": len(flows),
        "aggregates": {
            "type": aggregate(rows, dimension="type", flows=flows),
            "country": aggregate(rows, dimension="country", flows=flows),
            "sector": aggregate(rows, dimension="sector", flows=flows),
        },
        "flow_history": {
            "type": flow_history_by_dimension("type"),
            "country": flow_history_by_dimension("country"),
            "sector": flow_history_by_dimension("sector"),
        },
        "aum_history": {
            "type": aum_history_by_dimension("type", live_rows=rows, live_day=day),
            "country": aum_history_by_dimension("country", live_rows=rows, live_day=day),
            "sector": aum_history_by_dimension("sector", live_rows=rows, live_day=day),
        },
        "rows": rows,
    }

    LATEST_PATH.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    META_PATH.write_text(
        json.dumps(
            {
                "generated_at": payload["generated_at"],
                "count": payload["count"],
                "total_aum_eok": payload["total_aum_eok"],
                "prev_as_of": payload["prev_as_of"],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    HTML_PATH.write_text(render_etfdb_html(payload), encoding="utf-8")
    return payload


def load_latest() -> dict[str, Any] | None:
    if not LATEST_PATH.is_file():
        return None
    try:
        return json.loads(LATEST_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def load_etfdb_html() -> str | None:
    if HTML_PATH.is_file():
        return HTML_PATH.read_text(encoding="utf-8")
    return None


def ensure_etf_db(*, max_age_hours: float = STALE_HOURS) -> dict[str, Any]:
    latest = load_latest()
    if latest and latest.get("rows"):
        try:
            gen = datetime.fromisoformat(latest["generated_at"])
            age_h = (datetime.now(KST) - gen.astimezone(KST)).total_seconds() / 3600
            if age_h <= max_age_hours:
                return latest
        except (KeyError, TypeError, ValueError):
            pass
    return build_etf_db(force_fetch=True)


def format_etfdb_telegram(payload: dict[str, Any], *, dimension: str = "type") -> str:
    aggs = (payload.get("aggregates") or {}).get(dimension) or []
    dim_label = {"type": "유형", "country": "국가", "sector": "업종"}.get(dimension, dimension)
    total = payload.get("total_aum_eok") or 0
    lines = [
        "<b>🇰🇷 ETF DB</b>",
        f"<i>{_esc(payload.get('generated_at_display', ''))}</i>",
        f"전체 <b>{payload.get('count', 0):,}</b>종 · AUM 합 <b>{_fmt_eok(total)}</b>",
        f"분류: <b>{_esc(dim_label)}</b>",
    ]
    prev = payload.get("prev_as_of")
    if prev:
        lines.append(f"수급 기준: {_esc(prev)} → {_esc(payload.get('as_of'))} (NAV×Δ설정좌수)")
    else:
        lines.append("<i>수급: 일별 스냅샷이 2일분 쌓이면 표시됩니다</i>")
    lines.append("")

    for idx, row in enumerate(aggs[:15], start=1):
        flow_txt = ""
        if row.get("flow_available"):
            flow_txt = f" · 수급 {_fmt_signed_eok(row.get('flow_eok'))}"
        lines.append(
            f"{idx}. <b>{_esc(row['label'])}</b>\n"
            f"    {row['count']}종 · AUM {_fmt_eok(row['aum_eok'])} "
            f"({row['aum_share_pct']:.1f}%){flow_txt}"
        )

    lines.append("")
    lines.append("웹: /etfdb 페이지에서 유형·국가·업종 탭으로 탐색")
    lines.append("다른 분류: <code>/etfdb 국가</code> · <code>/etfdb 업종</code>")
    return "\n".join(lines)


def _esc(text: Any) -> str:
    return (
        str(text)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def _fmt_eok(value: Any) -> str:
    try:
        n = float(value)
    except (TypeError, ValueError):
        return "n/a"
    if abs(n) >= 10000:
        return f"{n / 10000:,.1f}조"
    if abs(n) >= 100:
        return f"{n:,.0f}억"
    return f"{n:,.1f}억"


def _fmt_signed_eok(value: Any) -> str:
    try:
        n = float(value)
    except (TypeError, ValueError):
        return "n/a"
    sign = "+" if n > 0 else ""
    if abs(n) >= 10000:
        return f"{sign}{n / 10000:,.2f}조"
    return f"{sign}{n:,.0f}억"


def render_etfdb_html(payload: dict[str, Any]) -> str:
    """Self-contained interactive page with type / country / sector tabs."""
    # Slim client payload — drop unused fields from rows for HTML size
    client_rows = [
        {
            "code": r["code"],
            "name": r["name"],
            "type": r["type"],
            "country": r["country"],
            "sector": r["sector"],
            "aum_eok": r.get("aum_eok") or 0,
            "nav": r.get("nav"),
            "units": r.get("units"),
            "flow_eok": r.get("flow_eok"),
            "change_rate": r.get("change_rate"),
            "return_3m": r.get("return_3m"),
        }
        for r in payload.get("rows") or []
    ]
    client = {
        "generated_at_display": payload.get("generated_at_display"),
        "as_of": payload.get("as_of"),
        "prev_as_of": payload.get("prev_as_of"),
        "count": payload.get("count"),
        "total_aum_eok": payload.get("total_aum_eok"),
        "aggregates": payload.get("aggregates"),
        "flow_history": payload.get("flow_history"),
        "aum_history": payload.get("aum_history"),
        "rows": client_rows,
    }
    data_json = json.dumps(client, ensure_ascii=False).replace("</", "<\\/")

    return f"""<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>ETF DB — SavvyETF</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&family=IBM+Plex+Sans+KR:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/css/styles.css" />
  <style>
    :root {{
      --etfdb-ink: #e8eef5;
      --etfdb-muted: #8fa3b8;
      --etfdb-line: #2b3648;
      --etfdb-panel: rgba(20, 29, 43, 0.92);
      --etfdb-accent: #4da3ff;
      --etfdb-pos: #3dd68c;
      --etfdb-neg: #ff6b6b;
      --etfdb-bar: #3a7bd5;
    }}
    body {{
      font-family: "IBM Plex Sans KR", "DM Sans", system-ui, sans-serif;
      background:
        radial-gradient(ellipse 80% 50% at 0% -10%, rgba(77,163,255,0.12), transparent 55%),
        radial-gradient(ellipse 60% 40% at 100% 0%, rgba(61,214,140,0.07), transparent 50%),
        #0b1018;
      color: var(--etfdb-ink);
      margin: 0;
    }}
    .etfdb {{
      max-width: 1120px;
      margin: 0 auto;
      padding: 1.25rem 1rem 3.5rem;
    }}
    .etfdb-top {{
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      justify-content: space-between;
      gap: 0.75rem 1.5rem;
      margin-bottom: 1.25rem;
      padding-bottom: 1rem;
      border-bottom: 1px solid var(--etfdb-line);
    }}
    .etfdb-brand {{
      font-size: 1.65rem;
      font-weight: 700;
      letter-spacing: -0.02em;
      margin: 0;
    }}
    .etfdb-brand span {{ color: var(--etfdb-accent); }}
    .etfdb-meta {{ color: var(--etfdb-muted); font-size: 0.9rem; }}
    .etfdb-stats {{
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 0.75rem;
      margin-bottom: 1.25rem;
    }}
    @media (max-width: 640px) {{
      .etfdb-stats {{ grid-template-columns: 1fr; }}
    }}
    .etfdb-stat {{
      padding: 0.85rem 1rem;
      border-bottom: 2px solid var(--etfdb-line);
    }}
    .etfdb-stat .k {{ font-size: 0.78rem; color: var(--etfdb-muted); }}
    .etfdb-stat .v {{ font-size: 1.25rem; font-weight: 650; margin-top: 0.2rem; font-variant-numeric: tabular-nums; }}
    .dim-tabs {{
      display: flex;
      gap: 0.35rem;
      margin-bottom: 1rem;
      flex-wrap: wrap;
    }}
    .dim-tabs button {{
      appearance: none;
      border: 1px solid var(--etfdb-line);
      background: transparent;
      color: var(--etfdb-muted);
      font: inherit;
      font-weight: 600;
      padding: 0.55rem 1rem;
      cursor: pointer;
      border-radius: 0;
    }}
    .dim-tabs button[aria-selected="true"] {{
      color: var(--etfdb-ink);
      border-color: var(--etfdb-accent);
      border-bottom-width: 2px;
      color: var(--etfdb-accent);
    }}
    .layout {{
      display: grid;
      grid-template-columns: minmax(240px, 340px) 1fr;
      gap: 1.25rem;
      align-items: start;
    }}
    @media (max-width: 860px) {{
      .layout {{ grid-template-columns: 1fr; }}
    }}
    .panel {{
      background: var(--etfdb-panel);
      border: 1px solid var(--etfdb-line);
      padding: 0.85rem;
    }}
    .panel h2 {{
      margin: 0 0 0.75rem;
      font-size: 0.95rem;
      font-weight: 650;
      color: var(--etfdb-muted);
    }}
    .cat-list {{ list-style: none; margin: 0; padding: 0; max-height: 520px; overflow: auto; }}
    .cat-list li button {{
      width: 100%;
      text-align: left;
      appearance: none;
      border: none;
      background: transparent;
      color: inherit;
      font: inherit;
      padding: 0.55rem 0.4rem;
      cursor: pointer;
      border-bottom: 1px solid rgba(43,54,72,0.7);
    }}
    .cat-list li button:hover,
    .cat-list li button.active {{
      background: rgba(77,163,255,0.08);
    }}
    .cat-list .name {{ font-weight: 600; display: block; }}
    .cat-list .sub {{
      display: flex;
      justify-content: space-between;
      gap: 0.5rem;
      font-size: 0.8rem;
      color: var(--etfdb-muted);
      margin-top: 0.15rem;
      font-variant-numeric: tabular-nums;
    }}
    .bar {{
      height: 3px;
      background: rgba(255,255,255,0.06);
      margin-top: 0.35rem;
    }}
    .bar > i {{
      display: block;
      height: 100%;
      background: var(--etfdb-bar);
    }}
    .pos {{ color: var(--etfdb-pos); }}
    .neg {{ color: var(--etfdb-neg); }}
    .chart-wrap {{
      height: 220px;
      margin-bottom: 1rem;
      position: relative;
    }}
    canvas {{ width: 100%; height: 100%; display: block; }}
    .note {{
      font-size: 0.8rem;
      color: var(--etfdb-muted);
      margin: 0 0 0.75rem;
      line-height: 1.45;
    }}
    .toolbar {{
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin-bottom: 0.65rem;
      align-items: center;
    }}
    .toolbar input {{
      flex: 1;
      min-width: 160px;
      background: #0f1622;
      border: 1px solid var(--etfdb-line);
      color: var(--etfdb-ink);
      padding: 0.45rem 0.65rem;
      font: inherit;
    }}
    .toolbar select {{
      background: #0f1622;
      border: 1px solid var(--etfdb-line);
      color: var(--etfdb-ink);
      padding: 0.45rem 0.5rem;
      font: inherit;
    }}
    table {{
      width: 100%;
      border-collapse: collapse;
      font-size: 0.86rem;
      font-variant-numeric: tabular-nums;
    }}
    th, td {{
      padding: 0.45rem 0.35rem;
      border-bottom: 1px solid var(--etfdb-line);
      text-align: left;
    }}
    th {{ color: var(--etfdb-muted); font-weight: 550; position: sticky; top: 0; background: #121a27; }}
    td.num, th.num {{ text-align: right; }}
    .table-scroll {{ max-height: 480px; overflow: auto; }}
    .detail-title {{
      margin: 0 0 0.35rem;
      font-size: 1.1rem;
      font-weight: 700;
    }}
    a.home {{ color: var(--etfdb-muted); font-size: 0.85rem; }}
  </style>
</head>
<body>
  <div class="etfdb">
    <div class="etfdb-top">
      <div>
        <p class="etfdb-brand">SavvyETF <span>ETF DB</span></p>
        <p class="etfdb-meta" id="metaLine"></p>
      </div>
      <a class="home" href="/">← SavvyETF</a>
    </div>

    <div class="etfdb-stats">
      <div class="etfdb-stat"><div class="k">상장 ETF</div><div class="v" id="statCount">—</div></div>
      <div class="etfdb-stat"><div class="k">AUM 합계</div><div class="v" id="statAum">—</div></div>
      <div class="etfdb-stat"><div class="k">추정 수급 (전일比)</div><div class="v" id="statFlow">—</div></div>
    </div>

    <div class="dim-tabs" role="tablist" aria-label="분류 기준">
      <button type="button" role="tab" data-dim="type" aria-selected="true">유형</button>
      <button type="button" role="tab" data-dim="country" aria-selected="false">국가</button>
      <button type="button" role="tab" data-dim="sector" aria-selected="false">업종</button>
    </div>

    <div class="layout">
      <aside class="panel">
        <h2 id="catHeading">유형별 AUM</h2>
        <ul class="cat-list" id="catList"></ul>
      </aside>
      <section class="panel">
        <p class="note" id="flowNote"></p>
        <div class="chart-wrap"><canvas id="flowChart" width="800" height="220"></canvas></div>
        <p class="detail-title" id="detailTitle">전체</p>
        <div class="toolbar">
          <input type="search" id="search" placeholder="종목명·코드 검색" />
          <select id="sort">
            <option value="aum">AUM 큰순</option>
            <option value="flow">수급 큰순</option>
            <option value="name">이름순</option>
          </select>
        </div>
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>코드</th>
                <th>종목</th>
                <th class="num">AUM</th>
                <th class="num">NAV</th>
                <th class="num">설정좌수(추정)</th>
                <th class="num">수급(추정)</th>
                <th class="num">등락</th>
              </tr>
            </thead>
            <tbody id="tbody"></tbody>
          </table>
        </div>
      </section>
    </div>
  </div>
  <script>
  const DATA = {data_json};
  const DIM_LABEL = {{ type: "유형", country: "국가", sector: "업종" }};
  let dim = "type";
  let selected = null;

  function fmtEok(n) {{
    if (n == null || Number.isNaN(n)) return "—";
    const a = Math.abs(n);
    if (a >= 10000) return (n / 10000).toLocaleString("ko-KR", {{ maximumFractionDigits: 1 }}) + "조";
    return n.toLocaleString("ko-KR", {{ maximumFractionDigits: 0 }}) + "억";
  }}
  function fmtSignedEok(n) {{
    if (n == null || Number.isNaN(n)) return "—";
    const s = n > 0 ? "+" : "";
    return s + fmtEok(n);
  }}
  function fmtNum(n, d=0) {{
    if (n == null || Number.isNaN(n)) return "—";
    return Number(n).toLocaleString("ko-KR", {{ maximumFractionDigits: d }});
  }}
  function clsSigned(n) {{
    if (n == null || Number.isNaN(n) || n === 0) return "";
    return n > 0 ? "pos" : "neg";
  }}

  document.getElementById("metaLine").textContent =
    `${{DATA.generated_at_display || ""}} · 출처: 네이버 금융 ETF 전종목 · 수급=NAV×Δ설정좌수(추정)`;
  document.getElementById("statCount").textContent = (DATA.count || 0).toLocaleString("ko-KR") + "종";
  document.getElementById("statAum").textContent = fmtEok(DATA.total_aum_eok);

  function totalFlow() {{
    const aggs = (DATA.aggregates && DATA.aggregates[dim]) || [];
    if (!aggs.some(a => a.flow_available)) return null;
    return aggs.reduce((s, a) => s + (a.flow_eok || 0), 0);
  }}

  function renderCats() {{
    const aggs = (DATA.aggregates && DATA.aggregates[dim]) || [];
    const maxAum = Math.max(...aggs.map(a => a.aum_eok || 0), 1);
    document.getElementById("catHeading").textContent = DIM_LABEL[dim] + "별 AUM";
    const ul = document.getElementById("catList");
    ul.innerHTML = "";
    const allBtn = document.createElement("li");
    allBtn.innerHTML = `<button type="button" data-label="" class="${{selected==null?"active":""}}">
      <span class="name">전체</span>
      <span class="sub"><span>${{DATA.count}}종</span><span>${{fmtEok(DATA.total_aum_eok)}}</span></span>
    </button>`;
    ul.appendChild(allBtn);
    aggs.forEach(a => {{
      const li = document.createElement("li");
      const flow = a.flow_available
        ? `<span class="${{clsSigned(a.flow_eok)}}">${{fmtSignedEok(a.flow_eok)}}</span>`
        : `<span>—</span>`;
      const active = selected === a.label ? "active" : "";
      li.innerHTML = `<button type="button" data-label="${{a.label.replace(/"/g,'&quot;')}}" class="${{active}}">
        <span class="name">${{a.label}}</span>
        <span class="sub"><span>${{a.count}}종 · ${{a.aum_share_pct.toFixed(1)}}%</span>${{flow}}</span>
        <div class="bar"><i style="width:${{(100*(a.aum_eok||0)/maxAum).toFixed(1)}}%"></i></div>
      </button>`;
      ul.appendChild(li);
    }});
    ul.querySelectorAll("button").forEach(btn => {{
      btn.addEventListener("click", () => {{
        const lab = btn.getAttribute("data-label");
        selected = lab === "" ? null : lab;
        renderCats();
        renderTable();
        drawChart();
      }});
    }});
    const tf = totalFlow();
    const el = document.getElementById("statFlow");
    if (tf == null) {{
      el.textContent = DATA.prev_as_of ? "부분" : "대기중";
      el.className = "v";
    }} else {{
      el.textContent = fmtSignedEok(tf);
      el.className = "v " + clsSigned(tf);
    }}
    document.getElementById("flowNote").textContent = "AUM 시계열: 일별 스냅샷 + 당일 라이브 합산. 업종=GICS(+헬스케어·배당·커버드콜·액티브). "
      + (DATA.prev_as_of
        ? `수급: ${{DATA.prev_as_of}} → ${{DATA.as_of}} (NAV×Δ설정좌수).`
        : "수급은 스냅샷 2일분 축적 후 표시.");
  }}

  function filteredRows() {{
    const q = (document.getElementById("search").value || "").trim().toLowerCase();
    const sort = document.getElementById("sort").value;
    let rows = DATA.rows || [];
    if (selected != null) {{
      rows = rows.filter(r => r[dim] === selected);
    }}
    if (q) {{
      rows = rows.filter(r =>
        (r.name || "").toLowerCase().includes(q) ||
        (r.code || "").toLowerCase().includes(q)
      );
    }}
    rows = rows.slice();
    if (sort === "aum") rows.sort((a,b) => (b.aum_eok||0) - (a.aum_eok||0));
    else if (sort === "flow") rows.sort((a,b) => (b.flow_eok|| -1e99) - (a.flow_eok|| -1e99));
    else rows.sort((a,b) => (a.name||"").localeCompare(b.name||"", "ko"));
    return rows;
  }}

  function renderTable() {{
    const rows = filteredRows();
    document.getElementById("detailTitle").textContent =
      (selected || "전체") + ` · ${{rows.length}}종`;
    const tb = document.getElementById("tbody");
    tb.innerHTML = rows.slice(0, 400).map(r => `
      <tr>
        <td><code>${{r.code}}</code></td>
        <td>${{r.name}}</td>
        <td class="num">${{fmtEok(r.aum_eok)}}</td>
        <td class="num">${{fmtNum(r.nav, 2)}}</td>
        <td class="num">${{fmtNum(r.units, 0)}}</td>
        <td class="num ${{clsSigned(r.flow_eok)}}">${{fmtSignedEok(r.flow_eok)}}</td>
        <td class="num ${{clsSigned(r.change_rate)}}">${{r.change_rate==null?"—":(r.change_rate>0?"+":"")+Number(r.change_rate).toFixed(2)+"%"}}</td>
      </tr>`).join("");
  }}

  function drawChart() {{
    const canvas = document.getElementById("flowChart");
    const ctx = canvas.getContext("2d");
    const hist = (DATA.aum_history && DATA.aum_history[dim]) || {{ dates: [], series: {{}} }};
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 800;
    const h = canvas.clientHeight || 220;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#8fa3b8";
    ctx.font = "12px IBM Plex Sans KR, sans-serif";

    let dates = hist.dates || [];
    let series = hist.series || {{}};
    if (selected) {{
      series = series[selected] ? {{ [selected]: series[selected] }} : {{}};
    }} else if (series["전체"]) {{
      series = {{ "전체": series["전체"] }};
    }}
    const labels = Object.keys(series);
    if (!dates.length || !labels.length) {{
      ctx.fillText("AUM 시계열 없음", 16, h/2);
      return;
    }}
    const allVals = [];
    labels.forEach(lab => (series[lab] || []).forEach(v => {{ if (v != null) allVals.push(v); }}));
    if (!allVals.length) {{
      ctx.fillText("표시할 AUM 값이 없습니다", 16, h/2);
      return;
    }}
    const minV = Math.min(...allVals) * 0.98;
    const maxV = Math.max(...allVals) * 1.02;
    const pad = {{ t: 16, r: 12, b: 28, l: 48 }};
    const iw = w - pad.l - pad.r;
    const ih = h - pad.t - pad.b;
    const yScale = v => pad.t + ih * (1 - (v - minV) / ((maxV - minV) || 1));
    const xScale = i => pad.l + iw * (dates.length === 1 ? 0.5 : i / (dates.length - 1));

    ctx.strokeStyle = "#2b3648";
    ctx.beginPath();
    ctx.moveTo(pad.l, pad.t);
    ctx.lineTo(pad.l, pad.t + ih);
    ctx.lineTo(pad.l + iw, pad.t + ih);
    ctx.stroke();

    const palette = ["#4da3ff","#3dd68c","#fbbf24","#ff6b6b","#a78bfa","#22d3ee","#fb7185","#84cc16"];
    labels.slice(0, 8).forEach((lab, li) => {{
      const vals = series[lab] || [];
      ctx.strokeStyle = palette[li % palette.length];
      ctx.lineWidth = 1.75;
      ctx.beginPath();
      let started = false;
      vals.forEach((v, i) => {{
        if (v == null) {{ started = false; return; }}
        const x = xScale(i), y = yScale(v);
        if (!started) {{ ctx.moveTo(x, y); started = true; }}
        else ctx.lineTo(x, y);
      }});
      ctx.stroke();
    }});
    ctx.fillStyle = "#8fa3b8";
    if (dates.length) {{
      ctx.fillText(dates[0], pad.l, h - 8);
      ctx.fillText(dates[dates.length-1], w - pad.r - 64, h - 8);
    }}
    ctx.fillText(fmtEok(maxV), 4, pad.t + 8);
    ctx.fillText(fmtEok(minV), 4, pad.t + ih);
  }}

  document.querySelectorAll(".dim-tabs button").forEach(btn => {{
    btn.addEventListener("click", () => {{
      dim = btn.getAttribute("data-dim");
      selected = null;
      document.querySelectorAll(".dim-tabs button").forEach(b => b.setAttribute("aria-selected", b === btn ? "true" : "false"));
      renderCats();
      renderTable();
      drawChart();
    }});
  }});
  document.getElementById("search").addEventListener("input", renderTable);
  document.getElementById("sort").addEventListener("change", renderTable);
  window.addEventListener("resize", drawChart);

  renderCats();
  renderTable();
  drawChart();
  </script>
</body>
</html>
"""
