"""KRX ETS (KAU) scraper → R2 cache for the ESG carbon tab.

Vercel cannot reach ets.krx.co.kr (HTTP 403 from cloud IPs). The webapp
reads `esg_carbon/latest.json` when the live scrape fails; this module
fills that object from a machine that can reach KRX (local bot / scheduler).

Uses curl for the ETS handshake — plain requests often gets 403 even from
residential IPs while curl succeeds.
"""

from __future__ import annotations
import path_setup  # noqa: F401

import json
import re
import subprocess
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

KST = ZoneInfo("Asia/Seoul")
# KRX ETS blocks non-browser User-Agents (SavvyETF bot UA → 403).
UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36"
)

ETS_ORIGIN = "https://ets.krx.co.kr"
ETS_PAGE = "/contents/ETS/03/03010000/ETS03010000.jsp"
ETS_OTP = f"{ETS_ORIGIN}/contents/COM/GenerateOTP.jspx"
ETS_DATA = f"{ETS_ORIGIN}/contents/ETS/99/ETS99000001.jspx"
# Front-month fallback when item search fails (update yearly).
FALLBACK_KAU = {"isu_cd": "KRD050042609", "isu_abbrv": "KAU26"}
R2_LATEST_KEY = "esg_carbon/latest.json"


def _parse_number(raw: Any) -> float | None:
    if raw is None:
        return None
    if isinstance(raw, (int, float)) and raw == raw:
        return float(raw)
    text = str(raw).replace(",", "").replace("%", "").strip()
    if not text or text in {"-", "N/A"}:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _curl(
    url: str,
    *,
    cookie_jar: Path,
    data: dict[str, str] | None = None,
    timeout: int = 45,
) -> str:
    cmd = [
        "curl",
        "-sS",
        "-c",
        str(cookie_jar),
        "-b",
        str(cookie_jar),
        "-A",
        UA,
        "-H",
        f"Origin: {ETS_ORIGIN}",
        "-H",
        f"Referer: {ETS_ORIGIN}{ETS_PAGE}",
        "--max-time",
        str(timeout),
        "-w",
        "\n%{http_code}",
    ]
    if data is not None:
        cmd += [
            "-H",
            "Content-Type: application/x-www-form-urlencoded; charset=UTF-8",
        ]
        for k, v in data.items():
            cmd += ["--data-urlencode", f"{k}={v}"]
    cmd.append(url)

    proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or "").strip()
        raise RuntimeError(f"curl failed for {url}: {err or proc.returncode}")
    out = proc.stdout or ""
    if "\n" not in out:
        raise RuntimeError(f"curl empty response for {url}")
    body, _, code = out.rpartition("\n")
    if code.strip() != "200":
        raise RuntimeError(f"KRX ETS HTTP {code.strip()} for {url}")
    return body


def _otp(cookie_jar: Path, bld: str) -> str:
    otp = _curl(ETS_OTP, cookie_jar=cookie_jar, data={"name": "form", "bld": bld}).strip()
    if not otp or len(otp) < 8:
        raise RuntimeError("KRX OTP empty")
    return otp


def _resolve_kau(cookie_jar: Path) -> dict[str, str]:
    try:
        otp = _otp(cookie_jar, "COM/ets_itemSearch2")
        text = _curl(
            ETS_DATA,
            cookie_jar=cookie_jar,
            data={"mktsel": "ALL", "pagePath": ETS_PAGE, "code": otp},
        )
        rows = (json.loads(text) or {}).get("result") or []
        live = [
            r
            for r in rows
            if isinstance(r, dict)
            and re.fullmatch(r"KAU\d{2}", str(r.get("isu_abbrv") or ""))
            and r.get("isu_cd")
        ]
        live.sort(key=lambda r: str(r.get("isu_abbrv")))
        if live:
            top = live[0]
            return {"isu_cd": str(top["isu_cd"]), "isu_abbrv": str(top["isu_abbrv"])}
    except Exception as exc:
        print(
            f"esg_carbon: item search failed ({exc}); "
            f"using fallback {FALLBACK_KAU['isu_abbrv']}"
        )
    return dict(FALLBACK_KAU)


def fetch_domestic_carbon(*, lookback_days: int = 360) -> dict[str, Any]:
    """Return a CarbonSeries-shaped dict (matches webapp/src/lib/esgCarbon.ts)."""
    with tempfile.TemporaryDirectory(prefix="esg_carbon_") as tmp:
        jar = Path(tmp) / "ets.ck"
        jar.write_text("", encoding="utf-8")
        _curl(f"{ETS_ORIGIN}{ETS_PAGE}", cookie_jar=jar)

        isu = _resolve_kau(jar)
        today = datetime.now(KST).date()
        todate = today.strftime("%Y%m%d")
        fromdate = (today - timedelta(days=lookback_days)).strftime("%Y%m%d")

        otp = _otp(jar, "ETS/03/03010000/ets03010000_05")
        text = _curl(
            ETS_DATA,
            cookie_jar=jar,
            data={
                "isu_cd": isu["isu_cd"],
                "fromdate": fromdate,
                "todate": todate,
                "pagePath": ETS_PAGE,
                "code": otp,
            },
        )
        rows = (json.loads(text) or {}).get("DS1") or []

    bars: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        close = _parse_number(row.get("tdd_clsprc"))
        volume = _parse_number(row.get("acc_trdvol")) or 0.0
        open_ = _parse_number(row.get("tdd_opnprc"))
        high = _parse_number(row.get("tdd_hgprc"))
        low = _parse_number(row.get("tdd_lwprc"))
        value = _parse_number(row.get("acc_trdval"))
        date = str(row.get("trd_dd") or "")[:10]
        if not date or close is None or close <= 0:
            continue
        traded = (
            volume > 0
            or (open_ is not None and open_ > 0)
            or (high is not None and high > 0)
            or (value is not None and value > 0)
        )
        if not traded:
            continue
        bars.append(
            {
                "date": date,
                "close": close,
                "volume": volume,
                "open": open_,
                "high": high,
                "low": low,
                "value": value,
            }
        )
    bars.sort(key=lambda b: b["date"])

    if not bars:
        raise RuntimeError(f"KRX ETS empty history for {isu['isu_abbrv']}")

    last = bars[-1]
    prev = bars[-2] if len(bars) >= 2 else None
    change = (last["close"] - prev["close"]) if prev else None
    change_pct = (
        ((last["close"] - prev["close"]) / prev["close"]) * 100
        if prev and prev["close"]
        else None
    )

    return {
        "symbol": isu["isu_abbrv"],
        "name": f"한국 배출권 {isu['isu_abbrv']}",
        "market": "KR",
        "currency": "KRW",
        "unit": "원/톤",
        "quote": {
            "last": last["close"],
            "change": change,
            "change_pct": change_pct,
            "volume": last["volume"],
        },
        "daily": bars,
        "source": "KRX ETS (ets.krx.co.kr)",
    }


def build_cache_payload(domestic: dict[str, Any] | None = None) -> dict[str, Any]:
    series = domestic or fetch_domestic_carbon()
    return {
        "ok": True,
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "as_of_kst": datetime.now(KST).strftime("%Y-%m-%d"),
        "domestic": series,
        "note": "Bot/local scrape cache for Vercel (KRX blocks cloud IPs).",
    }


def publish_esg_carbon(domestic: dict[str, Any] | None = None) -> dict[str, Any]:
    """Scrape (unless given) and write esg_carbon/latest.json (+ daily snapshot)."""
    from r2_briefs import r2_configured
    from r2_data import put_json_daily

    payload = build_cache_payload(domestic)
    if not r2_configured():
        return {"ok": False, "error": "R2 not configured", "payload": payload}
    day = str(payload.get("as_of_kst") or "")[:10]
    ok = put_json_daily(R2_LATEST_KEY, payload, day=day)
    return {
        "ok": bool(ok),
        "key": R2_LATEST_KEY,
        "symbol": (payload.get("domestic") or {}).get("symbol"),
        "bars": len((payload.get("domestic") or {}).get("daily") or []),
        "quote": (payload.get("domestic") or {}).get("quote"),
    }


def push_to_webapp(domestic: dict[str, Any], *, base_url: str, secret: str) -> dict[str, Any]:
    import urllib.request

    payload = build_cache_payload(domestic)
    url = base_url.rstrip("/") + "/api/esg-carbon"
    req = urllib.request.Request(
        url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Content-Type": "application/json; charset=utf-8",
            "Authorization": f"Bearer {secret}",
            "User-Agent": UA,
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as res:
        return json.loads(res.read().decode("utf-8"))


def main() -> None:
    import argparse
    import os

    p = argparse.ArgumentParser(description="Scrape KRX KAU and optionally upload to R2")
    p.add_argument("--upload", action="store_true", help="Write esg_carbon/latest.json to R2")
    p.add_argument(
        "--push",
        action="store_true",
        help="POST cache to WEBAPP_PUBLIC_URL /api/esg-carbon (WEB_INGEST_SECRET)",
    )
    p.add_argument("--print", action="store_true", help="Print JSON to stdout")
    args = p.parse_args()

    domestic = fetch_domestic_carbon()
    print(
        f"scraped {domestic.get('symbol')}: "
        f"{len(domestic.get('daily') or [])} bars, "
        f"last={(domestic.get('quote') or {}).get('last')}"
    )
    if args.upload:
        result = publish_esg_carbon(domestic)
        print(json.dumps({k: v for k, v in result.items() if k != "payload"}, ensure_ascii=False))
        if not result.get("ok"):
            raise SystemExit(1)
    if args.push:
        base = (
            os.environ.get("WEBAPP_PUBLIC_URL")
            or os.environ.get("WEB_PUBLISH_URL", "").replace("/api/ingest", "")
            or "https://savvyetf.com"
        ).strip()
        secret = (os.environ.get("WEB_INGEST_SECRET") or "").strip()
        if not secret:
            raise SystemExit("WEB_INGEST_SECRET required for --push")
        result = push_to_webapp(domestic, base_url=base, secret=secret)
        print(json.dumps(result, ensure_ascii=False))
        if not result.get("ok"):
            raise SystemExit(1)
    if args.print:
        print(json.dumps(build_cache_payload(domestic), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
