"""data/seed/seed_changes.csv + data/raw/msci/*_parsed.csv → data/out/{index_changes.csv, index_monitor.db, data.json}

실행(프로젝트 루트에서): python src/build_dataset.py
"""
import json
import sqlite3
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data/out"
OUT.mkdir(parents=True, exist_ok=True)
KO_NAME = {  # MSCI 원문 표기 → 한글명/코드 (security_map 시드)
    "LG INNOTEK CO": ("LG이노텍", "011070"),
    "HLB": ("HLB", "028300"),
    "LG DISPLAY CO": ("LG디스플레이", "034220"),
    "POSCO INTERNATIONAL": ("포스코인터내셔널", "047050"),
    "SAMSUNG EPIS HOLDINGS CO": ("삼성에피스홀딩스", "0126Z0"),
}

seed = pd.read_csv(ROOT / "data/seed/seed_changes.csv", dtype=str).fillna("")

# MSCI 리뷰는 data/raw/msci/reviews.csv 에 한 줄씩 등록한다 (파싱 결과 파일 + 날짜 메타)
frames = []
for rv in pd.read_csv(ROOT / "data/raw/msci/reviews.csv", dtype=str).itertuples():
    m = pd.read_csv(ROOT / "data/raw/msci" / rv.parsed_file, dtype=str)
    m["index_id"] = "MSCI_" + m["country_index"].str.replace("MSCI ", "").str.upper().str.replace(" ", "_")
    m["review"], m["announce_date"], m["effective_date"] = rv.review, rv.announce_date, rv.effective_date
    m["source_url"] = rv.source_url
    frames.append(m)
msci = pd.concat(frames, ignore_index=True)
msci["event_type"] = "regular"
msci["security_name"] = msci["security_name_raw"].map(lambda n: KO_NAME.get(n, (n, ""))[0])
msci["code"] = msci["security_name_raw"].map(lambda n: KO_NAME.get(n, ("", ""))[1])
msci["note"] = msci.apply(lambda r: r.security_name_raw if r.security_name_raw in KO_NAME else "", axis=1)
msci["source_tier"] = "official_pdf"
msci = msci[seed.columns]

allrows = pd.concat([seed, msci], ignore_index=True)
allrows = allrows.sort_values(["effective_date", "index_id", "action"], ascending=[False, True, True])
allrows.to_csv(OUT / "index_changes.csv", index=False, encoding="utf-8-sig")

# SQLite 적재 (schema.sql 사용)
db = OUT / "index_monitor.db"
db.unlink(missing_ok=True)
con = sqlite3.connect(db)
con.executescript((ROOT / "sql/schema.sql").read_text(encoding="utf-8"))
ev = allrows.assign(event_id=allrows.index_id + ":" + allrows.review)
con.executemany(
    "INSERT OR IGNORE INTO review_event(event_id,index_id,review_label,event_type,announce_date,effective_date,source_url,source_tier) VALUES (?,?,?,?,?,?,?,?)",
    ev[["event_id", "index_id", "review", "event_type", "announce_date", "effective_date", "source_url", "source_tier"]].replace("", None).values.tolist(),
)
con.executemany(
    "INSERT OR IGNORE INTO constituent_change(event_id,action,security_name_raw,security_id,note) VALUES (?,?,?,?,?)",
    ev[["event_id", "action", "security_name", "code", "note"]].replace("", None).values.tolist(),
)
con.commit()
n_ev = con.execute("select count(*) from review_event").fetchone()[0]
n_ch = con.execute("select count(*) from constituent_change").fetchone()[0]
con.close()

(OUT / "data.json").write_text(json.dumps(allrows.to_dict("records"), ensure_ascii=False), encoding="utf-8")
print(f"rows={len(allrows)} events={n_ev} changes={n_ch}")
print(allrows.groupby("index_id").size().sort_values(ascending=False).head(12).to_string())
