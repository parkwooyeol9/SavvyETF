"""ACWI 분석기 결과 → SavvyETF 웹앱(포트폴리오 › ACWI, 관리자 전용)용 봉인 파일.

    python -m Claude_DB.factor.export_webapp            # out/webapp_export/ 에만 쓴다 (크기 점검)
    python -m Claude_DB.factor.export_webapp --upload   # R2 private/acwi/latest/ 로 업로드

입력은 analyzer 가 만든 web/analyzer_data.js. 6.8MB 를 한 번에 내려주지 않도록 나눈다.
  summary.bin        종목 표·브레드스·이벤트·미반영 변경·리뷰 + 주간/월간 축·벤치마크
  series/NN.bin      종목별 주간 RI(3년)·월간 RI(10년, rim)·EPS/BPS/DPS/매출/PER, 코드 문자 합 % 32 묶음
                     (webapp/src/lib/acwiAnalyzer.ts 의 seriesBucket 과 같은 규칙)
  backtest.bin       10년 팩터 백테스트 결과 (web/backtest_data.js, factor/backtest.py) — 있을 때만
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from .. import sealed_r2

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "web" / "analyzer_data.js"
BT_SRC = ROOT / "web" / "backtest_data.js"
OUT = ROOT / "out" / "webapp_export"
LOCAL = ROOT / "out" / "sealed_local"      # 버킷과 같은 경로 구조 → 웹앱 SEALED_DATA_LOCAL_DIR 로 로컬 미리보기 (scripts/local_preview.sh)
PREFIX = "private/acwi/latest"
N_BUCKETS = 32
PER_STOCK = ("ri", "rim", "eps", "bps", "dps", "sal", "pe")       # 없는 키는 건너뜀 (구버전 파일)


def series_bucket(code: str) -> int:
    return sum(ord(ch) for ch in code) % N_BUCKETS


def load(src: Path = SRC) -> dict:
    text = src.read_text(encoding="utf-8")
    return json.loads(text[text.index("=") + 1:].rstrip().rstrip(";"))


def split(web: dict) -> dict[str, object]:
    s = web["series"]
    summary = {k: v for k, v in web.items() if k != "series"}
    summary["series"] = {"weeks": s["weeks"], "months": s["months"], "bench": s["bench"]}
    if "bench_m" in s:
        summary["series"]["bench_m"] = s["bench_m"]
    buckets: list[dict] = [{} for _ in range(N_BUCKETS)]
    for k in PER_STOCK:
        for code, arr in s.get(k, {}).items():
            buckets[series_bucket(code)].setdefault(code, {})[k] = arr
    files: dict[str, object] = {f"{PREFIX}/summary.bin": summary}
    files.update({f"{PREFIX}/series/{i:02d}.bin": b for i, b in enumerate(buckets)})
    return files


def main():
    ap = argparse.ArgumentParser(description="ACWI 분석기 → 웹앱 봉인 파일")
    ap.add_argument("--src", default=str(SRC))
    ap.add_argument("--upload", action="store_true")
    a = ap.parse_args()
    files = split(load(Path(a.src)))
    if BT_SRC.exists():
        files[f"{PREFIX}/backtest.bin"] = load(BT_SRC)
    blobs = {k: sealed_r2.seal(v) for k, v in files.items()}
    OUT.mkdir(parents=True, exist_ok=True)
    for k, b in blobs.items():
        p = OUT / k.removeprefix(PREFIX + "/")
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(b)
        q = LOCAL / k                                    # private/acwi/latest/... 그대로
        q.parent.mkdir(parents=True, exist_ok=True)
        q.write_bytes(b)
    raw = {k: len(json.dumps(v, ensure_ascii=False, separators=(",", ":")).encode()) for k, v in files.items()}
    series_raw = [v for k, v in raw.items() if "/series/" in k]
    if f"{PREFIX}/backtest.bin" in raw:
        print(f"backtest {raw[PREFIX + '/backtest.bin'] / 1e6:.2f}MB (봉인 {len(blobs[PREFIX + '/backtest.bin']) / 1e6:.2f}MB)")
    print(f"summary {raw[PREFIX + '/summary.bin'] / 1e6:.2f}MB (봉인 {len(blobs[PREFIX + '/summary.bin']) / 1e6:.2f}MB) · "
          f"series {len(series_raw)}개 최대 {max(series_raw) / 1e3:.0f}KB → {OUT}")
    print(f"로컬 미리보기용 → {LOCAL} (webapp 을 SEALED_DATA_LOCAL_DIR={LOCAL} 로 실행)")
    assert sealed_r2.open_sealed(blobs[PREFIX + "/summary.bin"])["meta"]["as_of"] == files[PREFIX + "/summary.bin"]["meta"]["as_of"]
    if a.upload:
        sealed_r2.upload(blobs)
        print(f"업로드 완료: {len(blobs)}개 → R2 {PREFIX}/")


if __name__ == "__main__":
    main()
