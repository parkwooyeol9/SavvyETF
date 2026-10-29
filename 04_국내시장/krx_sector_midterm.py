"""
KRX 코스피 업종지수 → 미 중간선거 이벤트 창 JSON (웹앱 번들용, 1회성).

웹앱 '정치분석 · 중간선거 스터디'의 한국 업종 분석이 이 파일을 읽는다.
  출력: webapp/src/data/krSectorMidterm.json

데이터: KRX 정보데이터시스템 [11003] 개별지수 시세 추이 (MDCSTAT00301).
2025-12-27부터 로그인이 필요하므로 아래 둘 중 하나가 있어야 한다.
  1) KRX_ID / KRX_PW  (저장소 루트 .env 또는 환경변수)
  2) KRX_COOKIE       브라우저로 data.krx.co.kr 로그인 후 요청 헤더의 Cookie 값 전체

각 중간선거 날짜 기준 −45일 ~ +410일(달력일) 창만 저장한다. 과거 구간이라
한 번 만들면 다시 돌릴 필요가 없다.

실행:
  python3 04_국내시장/krx_sector_midterm.py
  python3 04_국내시장/krx_sector_midterm.py --check   # 로그인·첫 응답만 확인
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "webapp" / "src" / "data" / "krSectorMidterm.json"

KRX = "https://data.krx.co.kr"
JSON_URL = f"{KRX}/comm/bldAttendant/getJsonData.cmd"
LOGIN_PAGE = f"{KRX}/contents/MDC/COMS/client/MDCCOMS001.cmd"
LOGIN_URL = f"{KRX}/contents/MDC/COMS/client/MDCCOMS001D1.cmd"
INDEX_PAGE = f"{KRX}/contents/MDC/MDI/mdiLoader/index.cmd?menuId=MDC0201010105"
UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
)

# 웹앱 midtermStudy.ts 의 MIDTERM_ELECTIONS 중 KOSPI(1980-01-04 기준) 이후
MIDTERMS = [
    "1982-11-02", "1986-11-04", "1990-11-06", "1994-11-08", "1998-11-03",
    "2002-11-05", "2006-11-07", "2010-11-02", "2014-11-04", "2018-11-06",
    "2022-11-08",
]
PRE_DAYS = 45
POST_DAYS = 410

# KRX 지수코드 (pykrx 표기: 그룹 1 + 3자리). 웹앱 KR_*_SPECS 의 krx 와 맞춘다.
INDICES = {
    "1001": "코스피",
    "1005": "음식료품",
    "1006": "섬유의복",
    "1007": "종이목재",
    "1008": "화학",
    "1009": "의약품",
    "1010": "비금속광물",
    "1011": "철강금속",
    "1012": "기계",
    "1013": "전기전자",
    "1014": "의료정밀",
    "1015": "운수장비",
    "1016": "유통업",
    "1017": "전기가스업",
    "1018": "건설업",
    "1019": "운수창고업",
    "1020": "통신업",
    "1021": "금융업",
    "1024": "증권",
    "1025": "보험",
    "1026": "서비스업",
}


def load_env_file() -> None:
    env = ROOT / ".env"
    if not env.exists():
        return
    for raw in env.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, val = line.split("=", 1)
        os.environ.setdefault(key.strip(), val.strip().strip('"').strip("'"))


def new_session() -> requests.Session:
    s = requests.Session()
    s.headers.update({"User-Agent": UA, "Referer": INDEX_PAGE})
    cookie = os.environ.get("KRX_COOKIE", "").strip()
    if cookie:
        s.headers["Cookie"] = cookie
        return s
    user = os.environ.get("KRX_ID", "").strip()
    pw = os.environ.get("KRX_PW", "").strip()
    if not (user and pw):
        sys.exit("KRX_ID/KRX_PW 또는 KRX_COOKIE 가 필요합니다 (.env 또는 환경변수).")
    s.get(LOGIN_PAGE, timeout=20)
    form = {"mbrNm": "", "telNo": "", "di": "", "certType": "", "mbrId": user, "pw": pw}
    res = s.post(LOGIN_URL, data=form, headers={"Referer": LOGIN_PAGE}, timeout=20)
    try:
        body = res.json()
    except ValueError:
        body = {}
    code = str(body.get("_error_code", ""))
    if code == "CD011":  # 다른 곳에서 로그인 중 → 기존 세션 끊고 다시
        form["skipDup"] = "Y"
        res = s.post(LOGIN_URL, data=form, headers={"Referer": LOGIN_PAGE}, timeout=20)
        body = res.json() if res.headers.get("content-type", "").startswith("application/json") else {}
        code = str(body.get("_error_code", ""))
    if code and code != "CD001":
        sys.exit(
            f"KRX 로그인 실패 ({code} {body.get('_error_message', '')}). "
            "브라우저 로그인 후 KRX_COOKIE 로 다시 실행하세요."
        )
    s.get(INDEX_PAGE, timeout=20)
    return s


def fetch_index(s: requests.Session, code: str, start: str, end: str) -> list[tuple[str, float]]:
    """[11003] 개별지수 시세 추이. KRX 는 한 번에 2년까지만 준다."""
    out: dict[str, float] = {}
    d0 = dt.date.fromisoformat(start)
    d_end = dt.date.fromisoformat(end)
    while d0 <= d_end:
        d1 = min(d0 + dt.timedelta(days=730), d_end)
        params = {
            "bld": "dbms/MDC/STAT/standard/MDCSTAT00301",
            "locale": "ko_KR",
            "indIdx": code[0],
            "indIdx2": code[1:],
            "strtDd": d0.strftime("%Y%m%d"),
            "endDd": d1.strftime("%Y%m%d"),
            "share": "2",
            "money": "3",
            "csvxls_isNo": "false",
        }
        res = s.post(JSON_URL, data=params, timeout=30)
        text = res.text.strip()
        if text == "LOGOUT":
            sys.exit("KRX 세션이 로그인 상태가 아닙니다 (LOGOUT). 계정 또는 쿠키를 확인하세요.")
        for row in res.json().get("output", []):
            raw_date = str(row.get("TRD_DD", "")).replace("/", "-")
            raw_close = str(row.get("CLSPRC_IDX", "")).replace(",", "")
            try:
                close = float(raw_close)
            except ValueError:
                continue
            if close > 0 and len(raw_date) == 10:
                out[raw_date] = close
        d0 = d1 + dt.timedelta(days=1)
        time.sleep(0.6)
    return sorted(out.items())


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="로그인과 코스피 한 구간만 확인")
    args = ap.parse_args()

    load_env_file()
    s = new_session()

    if args.check:
        rows = fetch_index(s, "1001", "1982-09-01", "1982-12-31")
        print(f"코스피 1982-09~12: {len(rows)}일", rows[:3], rows[-1:] if rows else "")
        return

    windows = []
    first_seen: dict[str, str] = {}
    for election in MIDTERMS:
        e = dt.date.fromisoformat(election)
        start = (e - dt.timedelta(days=PRE_DAYS)).isoformat()
        end = (e + dt.timedelta(days=POST_DAYS)).isoformat()
        per_code: dict[str, dict[str, float]] = {}
        for code, label in INDICES.items():
            rows = fetch_index(s, code, start, end)
            per_code[code] = dict(rows)
            if rows and code not in first_seen:
                first_seen[code] = rows[0][0]
            print(f"{election} {code} {label}: {len(rows)}일")
        dates = sorted({d for m in per_code.values() for d in m})
        if not dates:
            continue
        windows.append(
            {
                "election": election,
                "dates": dates,
                "closes": {
                    code: [m.get(d) for d in dates]
                    for code, m in per_code.items()
                    if m
                },
            }
        )

    payload = {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "source": "KRX 정보데이터시스템 [11003] 개별지수 시세 추이 (MDCSTAT00301)",
        "window": {"pre_days": PRE_DAYS, "post_days": POST_DAYS},
        "indices": INDICES,
        "first_seen": first_seen,
        "windows": windows,
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"저장: {OUT} ({OUT.stat().st_size / 1024:.0f} KB, 창 {len(windows)}개)")
    for code, label in INDICES.items():
        print(f"  {code} {label}: 첫 데이터 {first_seen.get(code, '없음')}")


if __name__ == "__main__":
    main()
