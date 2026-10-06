"""새 ACWI 원자료 파일 수령 점검 (intake) — 팩터 빌드 전에 돌린다.

    python -m Claude_DB.factor.intake --xlsx ~/Downloads/ACWI_new.xlsx
    python -m Claude_DB.factor.intake --xlsx <새파일> --prev Claude_DB/data/ACWI_raw.xlsx --build --as-of 2026-10-31
    python -m Claude_DB.factor.intake --xlsx <새파일> --pit      # + 새 파일을 앵커로 ACWI 시점별 구성 재생성

점검 항목 (이전 검증 리포트 docs/01 의 지적 사항 기준)
  1. 요청식: 주가·시총·추정치 ~U$ 여부, 변동성 정의(가격 수준 SD vs 수익률 변동성), 수익률 RI/USD 여부,
     MSCI 국가코드 열 유무, 추정 연도, 헤더로 못 찾은 열
  2. 구조: 종목 수, 중복(ISIN·RIC·코드), 비중 합계·0 비중, 섹터 결측
  3. 결측률: 필드별, 이전 파일 대비 변화
  4. 값 상식: USD 기준 P/E·P/B·배당수익률·변동성 범위 이탈 종목
  5. MSCI 구성 대조: 이 목록이 어느 정기변경까지 반영됐는지(index_monitor PIT), 최신 편입 누락·편출 잔존 종목
  6. 이전 파일 대비: 추가·삭제 종목(ISIN)
  7. (--build) 팩터 빌드 후 이전 결과와 순위상관·상위 100 유지율

출력: Claude_DB/out/intake/intake_report.md + 세부 CSV
"""
from __future__ import annotations

import argparse
import datetime as dt
import sys
import warnings
from pathlib import Path

import numpy as np
import pandas as pd

from . import config as C
from . import engine as E

warnings.filterwarnings("ignore", category=UserWarning)
ROOT = Path(__file__).resolve().parents[1]          # Claude_DB
OUT = ROOT / "out" / "intake"
PIT_SRC = ROOT / "index_monitor" / "src"

RECOMMENDED = [  # (점검, 판정 함수, 권장 내용)
    ("주가 USD (X~U$)", lambda r: r.attrs["usd"]["price"], "X → X~U$ : 현지 주가 환산·호가단위(펜스 등) 판별 불필요"),
    ("시총 USD (MV~U$)", lambda r: r.attrs["usd"]["mv"], "X(MV)~U$"),
    ("추정치 USD (EPS/BPS/DPS ~U$)", lambda r: r.attrs["usd"]["fund"], "EPS1FD12~U$ 등"),
    ("변동성 = 수익률 기준", lambda r: r.attrs["vol_kind"] == "return", "SDN#(X,1Y)(가격 수준) → 일간 수익률 표준편차"),
    ("수익률 배당포함·USD", lambda r: all(k in r.attrs["col_info"]["header"].get("ret_12m", "").upper()
                                    for k in ("RI", "~U$")), "PCH#(X(RI)~U$,1M/3M/12M)"),
    ("MSCI 국가코드 열", lambda r: "country_src" in r.attrs["col_info"]["found"], "국가 분류를 추정 대신 원천으로"),
]


def _pct(x):
    return f"{x * 100:.1f}%"


def anchor_frame(raw: pd.DataFrame) -> pd.DataFrame:
    d = raw[raw["code"].notna() & (raw["wgt"].fillna(0) > 0)].copy()
    d["ric"] = d["ric"].fillna(d["code"]).astype(str)
    d["isin"] = d["isin"].fillna("").astype(str)
    d["name"] = d["name"].where(d["name"].notna() & (d["name"] != "NULL"), d["code"]).astype(str)
    return d[["wgt", "ric", "isin", "name"]].drop_duplicates("isin").reset_index(drop=True)


def msci_check(raw: pd.DataFrame) -> dict:
    """index_monitor 의 MSCI 편출입 이력으로 이 목록의 반영 시점과 누락/잔존 종목을 찾는다."""
    if not PIT_SRC.exists():
        return {"error": f"{PIT_SRC} 없음"}
    sys.path.insert(0, str(PIT_SRC))
    import msci_pit as P  # noqa: E402

    reviews = P.load_reviews()
    if not reviews:
        return {"error": "편출입 PSV 없음"}
    anchor = anchor_frame(raw)
    tag, det = P.detect_anchor_review(reviews, anchor)
    probe = [P.Node(i, P.anchor_country_pool(r["ric"], r["isin"]), [P.norm_name(r["name"])], r["isin"], r["ric"], r["name"])
             for i, r in enumerate(anchor.to_dict("records"))]
    later = [rv for rv in reviews if tag is None or rv.effective > next(x.effective for x in reviews if x.tag == tag)]
    missing_adds, stale = [], []
    for rv in later:   # 반영 시점 이후 리뷰: 편입 종목이 없어야 정상이 아니라, 반영돼야 할 변경
        for act, ctry, name in rv.rows:
            n, sc = P.best_match(probe, ctry, name)
            hit = n is not None and sc >= 0.95
            if act == "A" and not hit:
                missing_adds.append({"review": rv.tag, "country": ctry, "msci_name": name})
            if act == "D" and hit:
                stale.append({"review": rv.tag, "country": ctry, "msci_name": name, "file_name": n.anchor_name,
                              "isin": n.isin, "score": round(sc, 3)})
    return {"reflected": tag, "latest": reviews[-1].tag, "detection": det,
            "missing_adds": pd.DataFrame(missing_adds), "stale": pd.DataFrame(stale)}


def value_checks(d: pd.DataFrame) -> pd.DataFrame:
    rules = [("pe", lambda s: (s > 300) | (s < 1), "P/E <1 또는 >300"),
             ("pb", lambda s: (s > 50) | (s < 0.05), "P/B <0.05 또는 >50"),
             ("dy", lambda s: s > 25, "배당수익률 >25%"),
             ("vol", lambda s: (s > 150) | (s <= 0), "변동성 ≤0 또는 >150%"),
             ("mom_12_1", lambda s: s.abs() > 500, "12-1M 수익률 |x|>500%"),
             ("mcap_usd_mn", lambda s: s < 300, "시총 < 3억달러")]
    out = []
    for col, f, label in rules:
        if col not in d:
            continue
        m = f(d[col]) & d[col].notna()
        for _, r in d[m].iterrows():
            out.append({"check": label, "code": r["code"], "name": r["name"], "country": r.get("country"),
                        "value": r[col], "px_usd": r.get("px_usd"), "eps_ntm": r.get("eps_ntm")})
    return pd.DataFrame(out)


def rebuild_pit(raw: pd.DataFrame) -> list[str]:
    """새 파일을 앵커로 ACWI 시점별 구성(index_monitor/data/out/acwi_*) 재생성. 중국 A주가 포함된 파일이면
    end_reason=unknown 노드가 줄어든다."""
    sys.path.insert(0, str(PIT_SRC))
    import msci_pit as P  # noqa: E402

    P.main(anchor=anchor_frame(raw)[["name", "ric", "isin"]])
    c = pd.read_csv(P.OUT / "acwi_pit_counts.csv")
    iv = pd.read_csv(P.OUT / "acwi_membership_intervals.csv")
    show = c.iloc[::8][["review", "members_after", "confirmed_after"]]
    return (["## 8. ACWI 시점별 구성 재생성 (이 파일을 앵커로)", "",
            f"- 구간 {len(iv):,}개 · 끝 미상(unknown) {int((iv['end_reason'] == 'unknown').sum())}개 · ISIN 없음 {int(iv['isin'].isna().sum())}개",
            "", "| 리뷰 | 상한 | 확정 |", "|---|---|---|"]
            + [f"| {r.review} | {r.members_after:,} | {r.confirmed_after:,} |" for r in show.itertuples()] + [""])


def run(xlsx: Path, prev: Path | None, build: bool, as_of: str, pit: bool = False) -> Path:
    OUT.mkdir(parents=True, exist_ok=True)
    raw = E.load_raw(str(xlsx))
    info = raw.attrs["col_info"]
    L = [f"# ACWI 원자료 점검 — {xlsx.name}", "",
         f"- 점검 시각: {dt.datetime.now():%Y-%m-%d %H:%M} · 시트 `{raw.attrs['sheet']}` · 종목 {raw.attrs['n_rows']:,}개"
         f" · 추정 연도 EPS {info['years'].get('eps')} / 매출 {info['years'].get('rev')}", ""]

    # 1. 요청식
    L += ["## 1. 요청식(헤더) 점검", "", "| 항목 | 상태 | 권장 |", "|---|---|---|"]
    for label, f, rec in RECOMMENDED:
        try:
            ok = bool(f(raw))
        except Exception:  # noqa: BLE001
            ok = False
        L.append(f"| {label} | {'반영' if ok else '미반영'} | {rec} |")
    L += ["", f"- 변동성 열 해석: `{raw.attrs['vol_kind']}` (헤더 `{info['header'].get('px_sd_1y', '')}`)"]
    if info["fallback"]:
        L.append(f"- **헤더로 못 찾아 고정 열을 쓴 필드**: {', '.join(info['fallback'])} → 열 위치 확인 필요")
    L += ["", "<details><summary>필드 ↔ 헤더 매핑</summary>", "", "| 필드 | 헤더 |", "|---|---|"]
    L += [f"| {k} | `{v}` |" for k, v in sorted(info["header"].items())]
    L += ["", "</details>", ""]

    # 2. 구조
    d0 = raw[raw["code"].notna()]
    dup = {c: int(d0[c].dropna().duplicated().sum()) for c in ("code", "ric", "isin")}
    L += ["## 2. 구조", "",
          f"- 비중 합계 {d0['wgt'].sum():.4f} · 비중 0/결측 {int((d0['wgt'].fillna(0) <= 0).sum())}개"
          f" · 섹터 결측 {int(d0['sector'].isna().sum() + (d0['sector'] == 'NULL').sum())}개",
          f"- 중복: 코드 {dup['code']} · RIC {dup['ric']} · ISIN {dup['isin']}", ""]

    # 3. 결측률
    fields = [f for f in ("price", "mv_local", "ret_1m", "ret_12m", "eps_ntm", "bps_ntm", "roe_ntm", "dps_ntm",
                          "ni_ntm", "sales_ntm", "dps_ntm_chg", "de", "px_sd_1y", "fcf_yield",
                          "eps_cy26", "eps_cy27", "rev_cy26", "rev_cy27", "sector", "country_src") if f in d0]
    miss = pd.DataFrame({"field": fields, "missing": [d0[f].isna().mean() for f in fields]})
    prev_raw = None
    if prev and prev.exists() and prev.resolve() != xlsx.resolve():
        prev_raw = E.load_raw(str(prev))
        p0 = prev_raw[prev_raw["code"].notna()]
        miss["prev_missing"] = [p0[f].isna().mean() if f in p0 else np.nan for f in fields]
    miss.to_csv(OUT / "missing_rates.csv", index=False, encoding="utf-8-sig")
    L += ["## 3. 결측률", "", "| 필드 | 결측 | 이전 파일 |", "|---|---|---|"]
    for r in miss.itertuples():
        pm = getattr(r, "prev_missing", np.nan)
        L.append(f"| {r.field} | {_pct(r.missing)} | {'' if pd.isna(pm) else _pct(pm)} |")
    L.append("")

    # 4. 값 상식 (엔진 변환 후)
    d, excluded = E.clean(raw)
    d = E.convert(d, raw.attrs["usd"])
    d.attrs["vol_kind"] = raw.attrs["vol_kind"]
    d = E.descriptors(d)
    vc = value_checks(d)
    vc.to_csv(OUT / "value_flags.csv", index=False, encoding="utf-8-sig")
    L += ["## 4. 값 상식 (USD 환산 후)", "",
          f"- 분석 대상 {len(d):,} · 제외 {len(excluded)} (사유: "
          + ", ".join(f"{k} {v}" for k, v in excluded['reason'].value_counts().items()) + ")",
          f"- 호가단위 보정 {int(d.get('px_unit_fixed', pd.Series(dtype=bool)).sum())}건 · 범위 이탈 {len(vc)}건 → `value_flags.csv`"]
    if len(vc):
        L += ["", "| 점검 | 건수 |", "|---|---|"] + [f"| {k} | {v} |" for k, v in vc["check"].value_counts().items()]
    L += ["", f"- 중앙값: P/E {d['pe'].median():.1f} · P/B {d['pb'].median():.2f} · 배당 {d['dy'].median():.2f}% · "
          f"변동성 {d['vol'].median():.1f} · 시총 {d['mcap_usd_mn'].median():,.0f}백만$", ""]

    # 5. MSCI 구성 대조
    mc = msci_check(raw)
    L += ["## 5. MSCI ACWI 구성 대조", ""]
    if "error" in mc:
        L.append(f"- 건너뜀: {mc['error']}")
    else:
        L += [f"- 이 목록은 **{mc['reflected']} 정기변경 반영 직후** 구성으로 판정 (수집된 최신 리뷰 {mc['latest']})",
              f"- 이후 리뷰의 편입 종목 중 파일에 없는 것 {len(mc['missing_adds'])}개, 편출됐는데 남아 있는 것 {len(mc['stale'])}개"]
        mc["detection"].to_csv(OUT / "msci_reflection.csv", index=False, encoding="utf-8-sig")
        mc["missing_adds"].to_csv(OUT / "msci_missing_adds.csv", index=False, encoding="utf-8-sig")
        mc["stale"].to_csv(OUT / "msci_stale_members.csv", index=False, encoding="utf-8-sig")
        if mc["reflected"] != mc["latest"]:
            L.append("- **최신 구성이 아님** → 편출 종목 제외·편입 종목 추가 후 다시 받거나, 분석 시 `msci_stale_members.csv` 를 제외")
    L.append("")

    # 6. 이전 파일 대비
    if prev_raw is not None:
        a = set(anchor_frame(raw)["isin"]) - {""}
        b = set(anchor_frame(prev_raw)["isin"]) - {""}
        add, rem = sorted(a - b), sorted(b - a)
        nm = raw.set_index("isin")["name"].to_dict()
        pnm = prev_raw.set_index("isin")["name"].to_dict()
        pd.DataFrame({"isin": add, "name": [nm.get(x) for x in add]}).to_csv(OUT / "diff_added.csv", index=False, encoding="utf-8-sig")
        pd.DataFrame({"isin": rem, "name": [pnm.get(x) for x in rem]}).to_csv(OUT / "diff_removed.csv", index=False, encoding="utf-8-sig")
        L += ["## 6. 이전 파일 대비", "", f"- 이전: `{prev.name}` · 추가 {len(add)} · 삭제 {len(rem)} (비중>0, ISIN 기준)",
              "- 추가 예: " + ", ".join(str(nm.get(x)) for x in add[:12]),
              "- 삭제 예: " + ", ".join(str(pnm.get(x)) for x in rem[:12]), ""]

    # 7. 빌드 비교
    if build:
        from . import build as B
        prev_csv = ROOT / "out" / "stocks.csv"
        old = pd.read_csv(prev_csv) if prev_csv.exists() else None
        B.build(xlsx, as_of)
        new = pd.read_csv(prev_csv)
        L += ["## 7. 팩터 빌드 결과", "", f"- 분석 대상 {len(new):,}"]
        if old is not None:
            m = old.merge(new, on="code", suffixes=("_o", "_n"))
            rho = m["composite_o"].rank().corr(m["composite_n"].rank())
            top_o = set(old.nsmallest(100, "rank")["code"])
            top_n = set(new.nsmallest(100, "rank")["code"])
            L += [f"- 이전 결과 대비 공통 {len(m):,}종목 순위상관 {rho:.2f} · 상위 100 유지 {len(top_o & top_n)}"]
        L.append("")

    if pit:
        L += rebuild_pit(raw)

    p = OUT / "intake_report.md"
    p.write_text("\n".join(L), encoding="utf-8")
    return p


def main():
    ap = argparse.ArgumentParser(description="새 ACWI 원자료 파일 점검")
    ap.add_argument("--xlsx", required=True)
    ap.add_argument("--prev", default=str(ROOT / "data" / "ACWI_raw.xlsx"), help="비교할 이전 파일")
    ap.add_argument("--build", action="store_true", help="점검 후 팩터 빌드까지 실행 (out/ 덮어씀)")
    ap.add_argument("--as-of", default=dt.date.today().isoformat())
    ap.add_argument("--pit", action="store_true", help="이 파일을 앵커로 ACWI 시점별 구성(편출입 이력) 재생성")
    a = ap.parse_args()
    p = run(Path(a.xlsx).expanduser(), Path(a.prev).expanduser() if a.prev else None, a.build, a.as_of, a.pit)
    print(p.read_text(encoding="utf-8"))


if __name__ == "__main__":
    main()
