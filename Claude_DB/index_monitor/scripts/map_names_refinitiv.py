"""MSCI 표기 종목명 → ISIN/RIC 매핑 보조 (Refinitiv Workspace 로컬 실행용, 미검증 템플릿).

    pip install refinitiv-data
    python scripts/map_names_refinitiv.py        # data/out/acwi_name_map_todo.csv → data/raw/msci/name_map.csv

동작
  - 국가별로 Refinitiv 검색(rd.discovery.search)을 돌려 상위 후보 3개를 붙인다.
  - 상장폐지 종목(인수·합병으로 사라진 과거 편출 종목)이 많으므로 검색 시 비활성 종목도 포함한다.
  - 결과는 자동 확정하지 않는다. name_map.csv 의 isin/ric 칸을 사람이 확인해 채운 행만
    src/msci_pit.py 가 반영한다(빈 칸은 무시).

Datastream 만 쓸 경우: Excel 애드인의 'Find Series' 로 같은 목록을 찾아 isin 칸을 채워도 된다.
"""
from __future__ import annotations

from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
TODO = ROOT / "data/out/acwi_name_map_todo.csv"
OUT = ROOT / "data/raw/msci/name_map.csv"

COUNTRY_ISO = {  # MSCI 국가명 → ISO2 (Refinitiv RCSIssuerCountryLeaf 대신 거래소 국가 필터에 사용)
    "USA": "US", "JAPAN": "JP", "CHINA": "CN", "HONG KONG": "HK", "KOREA": "KR", "TAIWAN": "TW", "INDIA": "IN",
    "UNITED KINGDOM": "GB", "CANADA": "CA", "AUSTRALIA": "AU", "FRANCE": "FR", "GERMANY": "DE", "SWITZERLAND": "CH",
    "NETHERLANDS": "NL", "SWEDEN": "SE", "DENMARK": "DK", "SPAIN": "ES", "ITALY": "IT", "BRAZIL": "BR",
    "SAUDI ARABIA": "SA", "SOUTH AFRICA": "ZA", "MEXICO": "MX", "THAILAND": "TH", "MALAYSIA": "MY",
    "INDONESIA": "ID", "PHILIPPINES": "PH", "SINGAPORE": "SG", "TURKEY": "TR", "POLAND": "PL", "ISRAEL": "IL",
    "UNITED ARAB EMIRATES": "AE", "QATAR": "QA", "KUWAIT": "KW", "CHILE": "CL", "BELGIUM": "BE", "NORWAY": "NO",
    "FINLAND": "FI", "AUSTRIA": "AT", "IRELAND": "IE", "PORTUGAL": "PT", "NEW ZEALAND": "NZ", "GREECE": "GR",
    "HUNGARY": "HU", "CZECH REPUBLIC": "CZ", "EGYPT": "EG", "COLOMBIA": "CO", "PERU": "PE", "RUSSIA": "RU",
}


def main() -> None:
    import refinitiv.data as rd  # Workspace 실행 중이어야 함

    rd.open_session()
    todo = pd.read_csv(TODO, dtype=str).fillna("")
    rows = []
    for r in todo.itertuples():
        name = r.msci_name.replace("(HK-C)", "").replace(" A ", " ").strip()
        iso = COUNTRY_ISO.get(r.country.split(",")[0], "")
        filt = f"ExchangeCountry eq '{iso}'" if iso else None
        try:
            df = rd.discovery.search(view=rd.discovery.Views.EQUITY_QUOTES, query=name, filter=filt, top=3,
                                     select="DTSubjectName,RIC,IssueISIN,ExchangeName,AssetState")
        except Exception as e:  # noqa: BLE001
            df, err = pd.DataFrame(), str(e)
        else:
            err = ""
        cands = "; ".join(f"{x.DTSubjectName}|{x.RIC}|{x.IssueISIN}|{x.AssetState}" for x in df.itertuples()) if len(df) else err
        rows.append({**r._asdict(), "candidates": cands})
    rd.close_session()
    out = pd.DataFrame(rows).drop(columns=["Index"])
    if OUT.exists():  # 이미 사람이 채운 값 보존
        old = pd.read_csv(OUT, dtype=str).fillna("")
        keep = old[old["isin"] != ""][["msci_name", "country", "isin", "ric", "note"]]
        out = out.drop(columns=["isin", "ric", "note"]).merge(keep, on=["msci_name", "country"], how="left")
    out.to_csv(OUT, index=False, encoding="utf-8-sig")
    print(f"{len(out)} rows → {OUT} (candidates 컬럼을 보고 isin/ric 를 확정하세요)")


if __name__ == "__main__":
    main()
