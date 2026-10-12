"""SavvyETF bot launcher.

Collectors live in numbered folders (`01_봇`, `02_시황`, …). This file stays
at the repository root so `python bot.py` and the Render, Fly, and Railway
start commands keep working.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parent
_IMPL = _ROOT / "01_봇" / "bot.py"


def _install_paths() -> None:
    dirs = [
        folder
        for folder in _ROOT.iterdir()
        if folder.is_dir()
        and len(folder.name) > 3
        and folder.name[:2].isdigit()
        and folder.name[2] == "_"
        and any(folder.glob("*.py"))
    ]
    for folder in sorted(dirs, key=lambda item: item.name):
        entry = str(folder)
        if entry not in sys.path:
            sys.path.append(entry)
    root_entry = str(_ROOT)
    if root_entry not in sys.path:
        sys.path.append(root_entry)


def _load_impl():
    spec = importlib.util.spec_from_file_location("savvyetf_bot", _IMPL)
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot load {_IMPL}")
    module = importlib.util.module_from_spec(spec)
    sys.modules["savvyetf_bot"] = module
    spec.loader.exec_module(module)
    return module


_install_paths()

if __name__ == "__main__":
    import runpy

    runpy.run_path(str(_IMPL), run_name="__main__")
else:
    _impl = _load_impl()
    globals().update(
        {
            key: value
            for key, value in vars(_impl).items()
            if key
            not in {
                "__name__",
                "__file__",
                "__package__",
                "__loader__",
                "__spec__",
                "__cached__",
            }
        }
    )
