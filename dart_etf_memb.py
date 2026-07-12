"""Korean ETF membership (PDF) via Naver Finance — Open DART has no structured ETF holdings API."""

from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import requests

from dart_data import PROJECT_DIR, _esc

KST = ZoneInfo("Asia/Seoul")
SNAPSHOT_DIR = PROJECT_DIR / "data" / "etf_memb"
NAVER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Referer": "https://finance.naver.com/",
}


def parse_dart_etf_memb_query(command: str) -> str:
    """Parse `/dart etf memb <ticker|name>` → query string."""
    parts = command.strip().split()
    if len(parts) < 4:
        raise ValueError("missing ETF ticker or name")
    # /dart etf memb ...
    if parts[1].lower() != "etf" or parts[2].lower() not in {"memb", "member", "members", "pdf"}:
        raise ValueError("expected: /dart etf memb <ticker|name>")
    query = " ".join(parts[3:]).strip()
    if not query:
        raise ValueError("missing ETF ticker or name")
    return query


def is_dart_etf_memb_command(command: str) -> bool:
    parts = command.strip().split()
    if len(parts) < 3:
        return False
    return (
        parts[0].lower().startswith("/dart")
        and parts[1].lower() == "etf"
        and parts[2].lower() in {"memb", "member", "members", "pdf"}
    )


def resolve_etf_ticker(query: str) -> dict[str, str]:
    query = query.strip()
    if re.fullmatch(r"[0-9A-Za-z]{6}", query):
        # Confirm via autocomplete
        matches = _naver_autocomplete(query)
        for item in matches:
            if item["code"].upper() == query.upper():
                return item
        return {"code": query.upper(), "name": query.upper()}

    matches = _naver_autocomplete(query)
    if not matches:
        # retry without spaces
        compact = re.sub(r"\s+", "", query)
        if compact != query:
            matches = _naver_autocomplete(compact)
    if not matches:
        raise RuntimeError(
            f"No Korean ETF matched '{query}'. Try ticker e.g. 0167A0 "
            "(SOL AI반도체TOP2플러스)."
        )
    if len(matches) == 1:
        return matches[0]

    # Prefer exact / contains name match
    qn = re.sub(r"\s+", "", query.lower())
    exact = [m for m in matches if re.sub(r"\s+", "", m["name"].lower()) == qn]
    if len(exact) == 1:
        return exact[0]
    contains = [m for m in matches if qn in re.sub(r"\s+", "", m["name"].lower())]
    if len(contains) == 1:
        return contains[0]

    preview = ", ".join(f"{m['name']}({m['code']})" for m in matches[:5])
    raise RuntimeError(f"Multiple ETF matches. Be more specific.\nCandidates: {preview}")


def _naver_autocomplete(query: str) -> list[dict[str, str]]:
    url = "https://m.stock.naver.com/front-api/search/autoComplete"
    response = requests.get(
        url,
        params={"query": query, "target": "stock"},
        headers=NAVER_HEADERS,
        timeout=20,
    )
    response.raise_for_status()
    payload = response.json()
    items = ((payload.get("result") or {}).get("items")) or []
    out: list[dict[str, str]] = []
    for item in items:
        code = str(item.get("code") or "").strip()
        name = str(item.get("name") or "").strip()
        if not code or not name:
            continue
        out.append(
            {
                "code": code,
                "name": name,
                "type_code": str(item.get("typeCode") or ""),
                "type_name": str(item.get("typeName") or ""),
            }
        )
    return out


def fetch_etf_meta(ticker: str) -> dict[str, Any]:
    url = f"https://m.stock.naver.com/api/stock/{ticker}/integration"
    response = requests.get(url, headers=NAVER_HEADERS, timeout=20)
    response.raise_for_status()
    data = response.json()
    indicator = data.get("etfKeyIndicator") or {}
    return {
        "ticker": ticker,
        "name": data.get("stockName") or ticker,
        "description": data.get("description") or "",
        "issuer": indicator.get("issuerName") or "",
        "nav": indicator.get("nav"),
        "total_nav": indicator.get("totalNav"),
        "market_value": indicator.get("marketValue"),
        "total_fee": indicator.get("totalFee"),
        "return_1m": indicator.get("returnRate1m"),
        "return_3m": indicator.get("returnRate3m"),
    }


def fetch_etf_holdings(ticker: str) -> list[dict[str, Any]]:
    """Parse Naver PC ETF page for CU holdings (구성종목 / 구성비중)."""
    url = f"https://finance.naver.com/item/main.naver?code={ticker}"
    response = requests.get(url, headers=NAVER_HEADERS, timeout=25)
    response.raise_for_status()
    text = response.content.decode("utf-8", errors="replace")

    match = re.search(r"구성자산</span></h4>\s*<table[^>]*>(.*?)</table>", text, re.S)
    if not match:
        raise RuntimeError(f"Could not find ETF holdings table for {ticker} on Naver Finance.")

    holdings: list[dict[str, Any]] = []
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", match.group(1), re.S):
        link = re.search(r'code=([0-9A-Za-z]+)"[^>]*>([^<]+)</a>', tr)
        if not link:
            continue
        member_code, member_name = link.group(1), link.group(2).strip()
        cells = []
        for cell in re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S):
            cleaned = re.sub(r"<[^>]+>", "", cell)
            cleaned = re.sub(r"\s+", " ", cleaned).strip()
            cells.append(cleaned)
        # Expected: name, shares, weight%, price, change, change%
        shares = _parse_number(cells[1] if len(cells) > 1 else None)
        weight = _parse_percent(cells[2] if len(cells) > 2 else None)
        price = _parse_number(cells[3] if len(cells) > 3 else None)
        holdings.append(
            {
                "code": member_code,
                "name": member_name,
                "shares": shares,
                "weight_pct": weight,
                "price": price,
            }
        )

    if not holdings:
        raise RuntimeError(f"ETF holdings table for {ticker} was empty.")

    holdings.sort(key=lambda row: (row.get("weight_pct") is None, -(row.get("weight_pct") or 0)))
    return holdings


def _parse_number(raw: str | None) -> float | None:
    if raw is None:
        return None
    text = str(raw).replace(",", "").strip()
    if not text or text == "-":
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _parse_percent(raw: str | None) -> float | None:
    if raw is None:
        return None
    text = str(raw).replace("%", "").replace(",", "").strip()
    if not text or text == "-":
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _snapshot_path(ticker: str) -> Path:
    return SNAPSHOT_DIR / f"{ticker.upper()}.json"


def load_snapshot(ticker: str) -> dict | None:
    path = _snapshot_path(ticker)
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def save_snapshot(profile: dict[str, Any]) -> None:
    SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)
    payload = {
        "ticker": profile["ticker"],
        "name": profile["name"],
        "as_of": profile["generated_at"],
        "holdings": [
            {
                "code": row["code"],
                "name": row["name"],
                "weight_pct": row.get("weight_pct"),
                "shares": row.get("shares"),
            }
            for row in profile["holdings"]
        ],
    }
    _snapshot_path(profile["ticker"]).write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def compare_holdings(current: list[dict], previous: list[dict] | None) -> dict[str, Any]:
    if not previous:
        return {
            "has_previous": False,
            "added": [],
            "removed": [],
            "changed": [],
            "note": "첫 조회 — 다음 실행부터 편입비 변경 내역을 비교합니다.",
        }

    prev_map = {row["code"]: row for row in previous}
    curr_map = {row["code"]: row for row in current}
    added = [curr_map[code] for code in curr_map.keys() - prev_map.keys()]
    removed = [prev_map[code] for code in prev_map.keys() - curr_map.keys()]
    changed: list[dict[str, Any]] = []
    for code in curr_map.keys() & prev_map.keys():
        before = prev_map[code].get("weight_pct")
        after = curr_map[code].get("weight_pct")
        if before is None or after is None:
            continue
        delta = after - before
        if abs(delta) >= 0.05:  # ignore tiny noise
            changed.append(
                {
                    "code": code,
                    "name": curr_map[code]["name"],
                    "before": before,
                    "after": after,
                    "delta": delta,
                }
            )
    changed.sort(key=lambda row: abs(row["delta"]), reverse=True)
    return {
        "has_previous": True,
        "added": added,
        "removed": removed,
        "changed": changed,
        "previous_as_of": None,
    }


def build_etf_memb_profile(query: str) -> dict[str, Any]:
    resolved = resolve_etf_ticker(query)
    ticker = resolved["code"]
    meta = fetch_etf_meta(ticker)
    holdings = fetch_etf_holdings(ticker)
    previous = load_snapshot(ticker)
    changes = compare_holdings(holdings, (previous or {}).get("holdings"))
    if previous:
        changes["previous_as_of"] = previous.get("as_of")

    profile = {
        "query": query,
        "ticker": ticker,
        "name": meta.get("name") or resolved.get("name") or ticker,
        "description": meta.get("description") or "",
        "issuer": meta.get("issuer") or "",
        "nav": meta.get("nav"),
        "total_nav": meta.get("total_nav"),
        "market_value": meta.get("market_value"),
        "total_fee": meta.get("total_fee"),
        "return_1m": meta.get("return_1m"),
        "return_3m": meta.get("return_3m"),
        "holdings": holdings,
        "changes": changes,
        "generated_at": datetime.now(KST).strftime("%Y-%m-%d %H:%M KST"),
        "source": "Naver Finance (CU holdings) + Open DART fund disclosures",
        "dart_note": (
            "편입종목·구성비는 네이버(거래소 CU). "
            "리밸런싱·투자설명서 변경은 Open DART 펀드공시에서 검색·파싱합니다."
        ),
    }
    try:
        from dart_etf_disclosures import fetch_etf_disclosures

        print(
            f"DART ETF disclosures: {profile['name']} / issuer={profile.get('issuer') or '?'}"
        )
        profile["disclosures"] = fetch_etf_disclosures(
            etf_name=str(profile["name"]),
            ticker=ticker,
            issuer=str(profile.get("issuer") or ""),
        )
    except Exception as exc:
        profile["disclosures"] = {"error": str(exc), "filings": [], "parsed": []}
        print(f"DART ETF disclosures attach failed: {exc}")

    save_snapshot(profile)
    return profile


def format_etf_memb_telegram(profile: dict[str, Any]) -> str:
    lines = [
        f"<b>📦 ETF 편입종목 — {profile['name']}</b>",
        f"종목코드: <code>{profile['ticker']}</code>",
    ]
    if profile.get("issuer"):
        lines.append(f"운용사: {_esc(profile['issuer'])}")
    if profile.get("description"):
        lines.append(f"<i>{_esc(profile['description'])}</i>")

    meta_bits = []
    if profile.get("total_nav"):
        meta_bits.append(f"순자산 {profile['total_nav']}")
    if profile.get("total_fee") is not None:
        meta_bits.append(f"총보수 {profile['total_fee']}%")
    if profile.get("return_1m") is not None:
        meta_bits.append(f"1M {profile['return_1m']:+.2f}%")
    if profile.get("return_3m") is not None:
        meta_bits.append(f"3M {profile['return_3m']:+.2f}%")
    if meta_bits:
        lines.append(" · ".join(meta_bits))

    lines.extend(["", f"<i>{profile['generated_at']}</i>", "", "<b>구성종목 (CU 기준)</b>"])
    for index, row in enumerate(profile["holdings"], start=1):
        weight = row.get("weight_pct")
        weight_txt = f"{weight:.2f}%" if weight is not None else "n/a"
        shares = row.get("shares")
        shares_txt = f"{shares:,.0f}" if shares is not None else "n/a"
        lines.append(
            f"{index}. <code>{row['code']}</code> {_esc(row['name'])} — "
            f"<b>{weight_txt}</b> (수량 {shares_txt})"
        )

    changes = profile.get("changes") or {}
    lines.extend(["", "<b>편입비 변경 내역</b>"])
    if not changes.get("has_previous"):
        lines.append(f"<i>{changes.get('note', '이전 스냅샷 없음')}</i>")
    else:
        if changes.get("previous_as_of"):
            lines.append(f"<i>이전 조회: {changes['previous_as_of']}</i>")
        if changes.get("added"):
            names = ", ".join(f"{r['name']}({r['code']})" for r in changes["added"])
            lines.append(f"➕ 신규 편입: {_esc(names)}")
        if changes.get("removed"):
            names = ", ".join(f"{r['name']}({r['code']})" for r in changes["removed"])
            lines.append(f"➖ 편출: {_esc(names)}")
        if changes.get("changed"):
            lines.append("↕ 비중 변동:")
            for row in changes["changed"][:10]:
                lines.append(
                    f"  • {_esc(row['name'])}: {row['before']:.2f}% → {row['after']:.2f}% "
                    f"({row['delta']:+.2f}%p)"
                )
        if not (changes.get("added") or changes.get("removed") or changes.get("changed")):
            lines.append("<i>이전 스냅샷 대비 유의미한 편입비 변경 없음 (±0.05%p)</i>")

    lines.extend(
        [
            "",
            f"<i>Source: {profile['source']}</i>",
            f"<i>{profile['dart_note']}</i>",
            "<i>Not financial advice.</i>",
        ]
    )
    return "\n".join(lines)
