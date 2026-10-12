"""Keep the data files shared by the bot and the webapp identical.

The bot reads ``data/``; the webapp (deployed from ``webapp/`` on Vercel) bundles
its own copy under ``webapp/src/data/``. ``data/`` is the source of truth.

    python scripts/sync_shared_data.py          # copy data/ -> webapp/src/data/
    python scripts/sync_shared_data.py --check  # exit 1 if any pair differs (CI)
"""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# (source of truth, webapp copy)
PAIRS = [
    ("data/nlp_history_seed.json", "webapp/src/data/nlpHistorySeed.json"),
    ("data/universes/kospi200.json", "webapp/src/data/kospi200Universe.json"),
    ("data/universes/kosdaq100.json", "webapp/src/data/kosdaq100Universe.json"),
    ("data/universes/nlp_history.json", "webapp/src/data/nlpHistoryUniverse.json"),
]


def main() -> int:
    check = "--check" in sys.argv[1:]
    drift = []
    for src_rel, dst_rel in PAIRS:
        src, dst = ROOT / src_rel, ROOT / dst_rel
        if not src.is_file():
            print(f"missing source: {src_rel}")
            drift.append(src_rel)
            continue
        same = dst.is_file() and src.read_bytes() == dst.read_bytes()
        if same:
            continue
        if check:
            print(f"out of sync: {src_rel} != {dst_rel}")
            drift.append(dst_rel)
        else:
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(src, dst)
            print(f"synced {src_rel} -> {dst_rel}")
    if check and drift:
        print("Run: python scripts/sync_shared_data.py")
        return 1
    if check:
        print(f"shared data in sync ({len(PAIRS)} pairs)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
