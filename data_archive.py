"""One-shot R2 archive pass for datasets that used to delete old objects.

Usage:
  python data_archive.py
"""

from __future__ import annotations

from r2_data import archive_etf_snapshots_r2, r2_configured


def main() -> int:
    if not r2_configured():
        print("R2 is not configured (.env R2_*). Nothing to archive.")
        return 1
    moved = archive_etf_snapshots_r2()
    print(
        "etf_db snapshots: "
        f"archived={moved.get('archived', 0)} "
        f"deleted_from_hot={moved.get('deleted', 0)} "
        f"failed={moved.get('failed', 0)}"
    )
    print("NLP headlines archive on the next daily nlp_history save (per-name).")
    print("Brief history archive on the next slot publish (hot keep=5).")
    return 0 if not moved.get("failed") else 2


if __name__ == "__main__":
    raise SystemExit(main())
