"""Isolated ETF CHECK capture entrypoint (exits to free Chromium RAM)."""

from __future__ import annotations

import sys
from pathlib import Path

from memory_debug import log_memory


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: etfcheck_worker.py <volume|inflow> <output.jpg>")

    mode = sys.argv[1].strip().lower()
    output = Path(sys.argv[2])
    if mode not in {"volume", "inflow"}:
        raise SystemExit(f"unknown mode: {mode}")

    from etfcheck_capture import capture_inflow_to_file, capture_volume_to_file

    log_memory(f"etfcheck worker start ({mode})")
    if mode == "volume":
        capture_volume_to_file(output)
    else:
        capture_inflow_to_file(output)
    log_memory(f"etfcheck worker done ({mode})")


if __name__ == "__main__":
    main()
