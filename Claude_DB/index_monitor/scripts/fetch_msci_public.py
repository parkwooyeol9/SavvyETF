"""MSCI 공개 자료 일괄 다운로드 (로컬 맥에서 실행).

    cd SavvyETF/Claude_DB/index_monitor
    python scripts/fetch_msci_public.py            # MSCI 편출입 PDF + 리뷰 일정
    python scripts/fetch_msci_public.py --ishares  # + iShares ACWI ETF 월말 보유종목(시점 앵커)

받는 것
  1) MSCI Global Standard Indexes 편출입 리스트 PDF: 2013-08 ~ 현재 (분기 4회)
       https://app2.msci.com/eqb/gimi/stdindex/MSCI_{Mon}{YY}_STPublicList.pdf
     → data/raw/msci/pdf/
  2) 리뷰 발표·반영일: ir_dates.csv / ir_dates.pdf → data/raw/msci/
  3) (--ishares) iShares MSCI ACWI ETF 보유종목 CSV, 월말 기준 → data/raw/ishares_acwi/
     ※ 2026-10-02 실행 결과 iShares 는 스크립트 요청에 CSV 대신 웹페이지(HTML)를 돌려줌 → 사용 불가.
       과거 시점 앵커는 Datastream 의 과거 시점 지수 구성종목 리스트로 받는 것을 권장.
     ETF 보유종목은 지수 구성과 완전히 같지는 않지만 '그 시점에 실제로 알 수 있었던 구성'의
     독립 앵커로 쓴다 (역산 결과 검증용).

이미 받은 파일은 건너뛴다. 2006~2013-05 리뷰는 MSCI가 종목 리스트를 공개하지 않았다(보도자료만 있음).
권리: MSCI 자료는 내부 리서치용으로만 사용. 외부 게시·재배포 금지.
"""
from __future__ import annotations

import argparse
import calendar
import datetime as dt
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Safari/605.1.15"}
MONTHS = ["Feb", "May", "Aug", "Nov"]


def review_tags(start=(2013, 8), today: dt.date | None = None) -> list[str]:
    today = today or dt.date.today()
    tags = []
    for y in range(start[0], today.year + 1):
        for m in MONTHS:
            mnum = list(calendar.month_abbr).index(m)
            if (y, mnum) < start or dt.date(y, mnum, 1) > today:
                continue
            tags.append(f"{m}{str(y)[2:]}")
    return tags


def _is_html(b: bytes) -> bool:
    head = b[:512].lstrip().lower()
    return head.startswith(b"<!doctype") or head.startswith(b"<html")


def get(url: str, dest: Path, min_bytes: int = 1000) -> str:
    if dest.exists() and dest.stat().st_size >= min_bytes and not _is_html(dest.read_bytes()[:512]):
        return "skip"
    dest.parent.mkdir(parents=True, exist_ok=True)
    for attempt in range(3):
        try:
            r = requests.get(url, headers=UA, timeout=60)
            if r.status_code == 200 and _is_html(r.content):
                # 차단·리다이렉트로 데이터 대신 웹페이지가 온 경우 (2026-10 iShares 가 이렇게 응답) → 저장 안 함
                if dest.exists() and _is_html(dest.read_bytes()[:512]):
                    dest.unlink()
                return "html(blocked)"
            if r.status_code == 200 and len(r.content) >= min_bytes:
                dest.write_bytes(r.content)
                return "ok"
            if r.status_code == 404:
                return "404"
        except requests.RequestException:
            pass
        time.sleep(2 * (attempt + 1))
    return "fail"


def fetch_msci() -> None:
    base = "https://app2.msci.com/eqb"
    for name in ("ir_dates.csv", "ir_dates.pdf"):
        print(name, get(f"{base}/pressreleases/archive/{name}", ROOT / "data/raw/msci" / name, 100))
    for tag in review_tags():
        fn = f"MSCI_{tag}_STPublicList.pdf"
        print(fn, get(f"{base}/gimi/stdindex/{fn}", ROOT / "data/raw/msci/pdf" / fn))
        time.sleep(1)


def month_ends(start=dt.date(2013, 7, 31), today: dt.date | None = None):
    today = today or dt.date.today()
    y, m = start.year, start.month
    while True:
        d = dt.date(y, m, calendar.monthrange(y, m)[1])
        if d >= today:
            break
        while d.weekday() >= 5:  # 주말이면 직전 금요일
            d -= dt.timedelta(days=1)
        yield d
        m += 1
        if m == 13:
            y, m = y + 1, 1


def fetch_ishares() -> None:
    url = ("https://www.ishares.com/us/products/239600/ishares-msci-acwi-etf/1467271812596.ajax"
           "?fileType=csv&fileName=ACWI_holdings&dataType=fund&asOfDate={d}")
    for d in month_ends():
        ds = d.strftime("%Y%m%d")
        dest = ROOT / "data/raw/ishares_acwi" / f"ACWI_holdings_{ds}.csv"
        status = get(url.format(d=ds), dest, 20000)
        print(dest.name, status)
        time.sleep(1.5)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--ishares", action="store_true", help="iShares ACWI 월말 보유종목도 받기")
    a = ap.parse_args()
    fetch_msci()
    if a.ishares:
        fetch_ishares()
