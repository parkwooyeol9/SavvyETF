"""Repo root and import path for collectors that live in numbered folders.

`data/`, `.env`, and `web/` stay at the repository root. Moving a module
into `01_봇` or `03_ETF` must not make it look for `data/` beside itself.
"""
from __future__ import annotations

import sys
from pathlib import Path


def repo_root() -> Path:
    here = Path(__file__).resolve()
    for folder in here.parents:
        if (folder / "requirements.txt").is_file() and (folder / "data").is_dir():
            return folder
    raise RuntimeError(f"SavvyETF repo root not found from {here}")


PROJECT_DIR = repo_root()


def _numbered_dirs() -> list[Path]:
    found: list[Path] = []
    for folder in PROJECT_DIR.iterdir():
        name = folder.name
        if not folder.is_dir() or len(name) < 4:
            continue
        if not (name[:2].isdigit() and name[2] == "_"):
            continue
        if not any(folder.glob("*.py")):
            continue
        found.append(folder)
    return sorted(found, key=lambda folder: folder.name)


for _dir in _numbered_dirs():
    _entry = str(_dir)
    if _entry not in sys.path:
        sys.path.append(_entry)

_root_entry = str(PROJECT_DIR)
if _root_entry not in sys.path:
    sys.path.append(_root_entry)
