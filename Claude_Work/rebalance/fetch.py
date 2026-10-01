"""보유비중(PDF)·순자산·종목 거래대금을 모아 data/ 아래에 저장한다.

저장소의 기존 수집기를 그대로 쓴다.
  - ETF CHECK 일별 PDF 비중: ``etfcheck_client.fetch_kr_pdf_weights`` (코스닥 액티브 모니터와 같은 경로)
  - 실패 시 네이버 금융 구성자산: ``dart_etf_memb.fetch_etf_holdings``
  - 순자산: ``dart_etf_memb.fetch_etf_meta`` (네이버 모바일 API)
  - 종목 시가총액: 네이버 실시간 시세 (15% 상한 판정용, ``mcap_jo``)
  - 20일 평균 거래대금: 네이버 일봉, 실패 시 yfinance (``.KS`` → ``.KQ``)

실행 (저장소 루트, .venv 활성화 상태)::

    python -m Claude_Work.rebalance.fetch               # 규칙이 확인된 ETF 보유비중 + 거래대금
    python -m Claude_Work.rebalance.fetch --all         # 유니버스 전체 ETF
    python -m Claude_Work.rebalance.fetch --codes 396500 0167A0
    python -m Claude_Work.rebalance.fetch --no-adv      # 거래대금 생략
"""

from __future__ import annotations

import argparse
import json
import re
import time
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
KST = ZoneInfo("Asia/Seoul")
CASH_WORDS = ("현금", "원화", "예금", "CASH", "설정현금")


def _today() -> str:
    return datetime.now(KST).strftime("%Y-%m-%d")


def _ymd(raw: Any) -> str | None:
    digits = re.sub(r"\D", "", str(raw or ""))
    if len(digits) >= 8:
        return f"{digits[:4]}-{digits[4:6]}-{digits[6:8]}"
    return None


def _aum_eok(meta: dict[str, Any]) -> float | None:
    """네이버 totalNav / marketValue → 억원. 문자열은 '10조 2,124억' 형식도 받는다."""
    raw = meta.get("total_nav") or meta.get("market_value")
    if raw is None:
        return None
    if isinstance(raw, (int, float)):
        return float(raw) if raw < 1_000_000 else float(raw) / 1e8
    text = str(raw).replace(",", "").replace(" ", "")
    m = re.fullmatch(r"(?:(\d+(?:\.\d+)?)조)?(?:(\d+(?:\.\d+)?)억?)?", text)
    if not m or not (m.group(1) or m.group(2)):
        return None
    return float(m.group(1) or 0) * 10_000 + float(m.group(2) or 0)


def _is_cash(etf_code: str, code: str, name: str) -> bool:
    if code.upper() == etf_code.upper():
        return True
    return any(w in name.upper() for w in CASH_WORDS)


def clean_rows(etf_code: str, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for r in rows:
        code = str(r.get("code") or "").strip()
        name = str(r.get("name") or code).strip()
        w = r.get("weight_pct", r.get("weight"))
        if not code or w is None or _is_cash(etf_code, code, name):
            continue
        out.append({"code": code, "name": name, "weight": round(float(w), 4)})
    out.sort(key=lambda r: -r["weight"])
    return out


def fetch_holdings(etf_code: str) -> dict[str, Any]:
    """한 ETF의 보유비중 스냅샷. ETF CHECK → 네이버 순서."""
    source = None
    rows: list[dict[str, Any]] = []
    as_of = None
    try:
        from etfcheck_client import EtfCheckClient, fetch_kr_pdf_weights

        raw = fetch_kr_pdf_weights(EtfCheckClient(), etf_code, limit=60)
        rows = clean_rows(etf_code, raw)
        as_of = next((_ymd(r.get("as_of")) for r in raw if r.get("as_of")), None)
        source = "Koscom ETF CHECK getEtfPdfRankListWeight"
    except Exception as exc:  # noqa: BLE001 - 다음 소스로 넘어간다
        print(f"  [{etf_code}] ETF CHECK 실패: {exc}")
    if not rows:
        from dart_etf_memb import fetch_etf_holdings

        raw = fetch_etf_holdings(etf_code)
        rows = clean_rows(etf_code, [{"code": h.get("code"), "name": h.get("name"),
                                      "weight_pct": h.get("weight_pct", h.get("weight"))} for h in raw])
        source = "네이버 금융 ETF 구성자산"
    aum = None
    try:
        from dart_etf_memb import fetch_etf_meta

        aum = _aum_eok(fetch_etf_meta(etf_code))
    except Exception as exc:  # noqa: BLE001
        print(f"  [{etf_code}] 순자산 조회 실패: {exc}")
    return {
        "etf_code": etf_code,
        "as_of": as_of or _today(),
        "aum_eok": round(aum) if aum else None,
        "source": source,
        "coverage_pct": round(sum(r["weight"] for r in rows), 2),
        "fetched_at": datetime.now(KST).isoformat(timespec="seconds"),
        "holdings": rows,
    }


def fetch_mcap_jo(codes: list[str]) -> dict[str, float]:
    """종목별 시가총액(조원). 네이버 실시간 시세 ``marketValueFullRaw``."""
    import requests

    codes = [c for c in codes if re.fullmatch(r"[0-9A-Z]{6}", c)]
    out: dict[str, float] = {}
    for i in range(0, len(codes), 40):
        chunk = codes[i:i + 40]
        try:
            r = requests.get(
                f"https://polling.finance.naver.com/api/realtime/domestic/stock/{','.join(chunk)}",
                headers={"User-Agent": "Mozilla/5.0", "Referer": "https://m.stock.naver.com/"},
                timeout=20,
            )
            r.raise_for_status()
            rows = r.json().get("datas") or []
        except Exception as exc:  # noqa: BLE001
            print(f"  시가총액 조회 실패: {exc}")
            continue
        for row in rows:
            raw = str(row.get("marketValueFullRaw") or "").replace(",", "")
            try:
                value = float(raw)
            except ValueError:
                continue
            if row.get("itemCode") and value > 0:
                out[str(row["itemCode"])] = round(value / 1e12, 2)
    return out


def attach_mcap(snap: dict[str, Any]) -> int:
    mcap = fetch_mcap_jo([h["code"] for h in snap["holdings"]])
    for h in snap["holdings"]:
        if h["code"] in mcap:
            h["mcap_jo"] = mcap[h["code"]]
    if mcap:
        snap["mcap_source"] = "네이버 금융 실시간 시세 시가총액"
    return len(mcap)


def save_holdings(snap: dict[str, Any]) -> Path:
    folder = DATA / "holdings" / snap["etf_code"]
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{snap['as_of']}.json"
    path.write_text(json.dumps(snap, ensure_ascii=False, indent=1), encoding="utf-8")
    return path


def fetch_adv(codes: list[str], days: int = 20) -> dict[str, float]:
    """종목별 최근 ``days`` 거래일 평균 거래대금(억원). 네이버 일봉 → yfinance 순서."""
    from datetime import timedelta

    from . import naver

    codes = [c for c in codes if re.fullmatch(r"[0-9A-Z]{6}", c)]
    today = datetime.now(KST).date()
    out: dict[str, float] = {}
    for code, df in naver.many(codes, today - timedelta(days=60), today).items():
        if len(df) >= 5:
            out[code] = round(float((df["close"] * df["volume"]).tail(days).mean() / 1e8), 1)
    missing = [c for c in codes if c not in out]
    if not missing:
        return out

    import yfinance as yf

    for code in missing:
        for suffix in (".KS", ".KQ"):
            try:
                hist = yf.Ticker(code + suffix).history(period="3mo", auto_adjust=False)
            except Exception:  # noqa: BLE001
                hist = None
            if hist is not None and len(hist) >= 5:
                value = (hist["Close"] * hist["Volume"]).tail(days).mean() / 1e8
                out[code] = round(float(value), 1)
                break
        time.sleep(0.2)
    return out


def _universe() -> list[dict[str, Any]]:
    doc = json.loads((DATA / "universe.json").read_text(encoding="utf-8"))
    return [e for e in doc["etfs"] if e.get("kind") == "etf"]


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--codes", nargs="*", help="ETF 코드 (기본: 규칙이 확인된 ETF)")
    p.add_argument("--all", action="store_true", help="유니버스 전체 ETF")
    p.add_argument("--no-adv", action="store_true", help="거래대금 수집 생략")
    p.add_argument("--build", action="store_true", help="수집 후 build 까지 실행")
    args = p.parse_args(argv)

    uni = _universe()
    if args.codes:
        targets = args.codes
    elif args.all:
        targets = [e["code"] for e in uni]
    else:
        targets = [e["code"] for e in uni if e.get("scenarios")]

    members: set[str] = set()
    for code in targets:
        print(f"보유비중 수집: {code}")
        try:
            snap = fetch_holdings(code)
        except Exception as exc:  # noqa: BLE001
            print(f"  실패: {exc}")
            continue
        if not snap["holdings"]:
            print("  종목 없음 — 저장 생략")
            continue
        n_mcap = attach_mcap(snap)
        path = save_holdings(snap)
        members.update(h["code"] for h in snap["holdings"])
        print(f"  {len(snap['holdings'])}종목 · 합계 {snap['coverage_pct']}% · AUM {snap['aum_eok']}억 "
              f"· 시가총액 {n_mcap}종목 → {path.name}")

    if not args.no_adv and members:
        print(f"거래대금 수집: {len(members)}종목")
        adv_path = DATA / "adv.json"
        doc = json.loads(adv_path.read_text(encoding="utf-8")) if adv_path.exists() else {}
        adv = doc.get("adv_eok") or {}
        adv.update(fetch_adv(sorted(members)))
        doc.update({"as_of": _today(), "adv_eok": adv})
        adv_path.write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")

    if args.build:
        from .build import main as build_main

        build_main([])


if __name__ == "__main__":
    main()
