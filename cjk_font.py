"""Shared CJK (Korean) font resolution for PDF + matplotlib charts."""

from __future__ import annotations

from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parent
_CANDIDATE_PATHS = (
    PROJECT_DIR / "assets" / "fonts" / "NanumGothic.ttf",
    PROJECT_DIR / "data" / "fonts" / "NanumGothic.ttf",
    Path("/usr/share/fonts/truetype/nanum/NanumGothic.ttf"),
    Path("/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc"),
    Path("/System/Library/Fonts/AppleSDGothicNeo.ttc"),
)
_FONT_URL = (
    "https://raw.githubusercontent.com/google/fonts/main/ofl/nanumgothic/"
    "NanumGothic-Regular.ttf"
)
_RUNTIME_DOWNLOAD = PROJECT_DIR / "data" / "fonts" / "NanumGothic.ttf"

_resolved: Path | None = None
_resolved_tried = False
_mpl_configured = False


def resolve_cjk_font_path(*, allow_download: bool = True) -> Path | None:
    """Return a TTF/TTC path that can render Hangul, or None."""
    global _resolved, _resolved_tried
    if _resolved_tried:
        return _resolved
    _resolved_tried = True

    for path in _CANDIDATE_PATHS:
        if path.is_file() and path.stat().st_size >= 1000:
            _resolved = path
            return _resolved

    if not allow_download:
        _resolved = None
        return None

    try:
        import requests

        _RUNTIME_DOWNLOAD.parent.mkdir(parents=True, exist_ok=True)
        response = requests.get(_FONT_URL, timeout=60)
        response.raise_for_status()
        data = response.content
        if len(data) < 1000:
            raise RuntimeError(f"font download too small ({len(data)} bytes)")
        _RUNTIME_DOWNLOAD.write_bytes(data)
        _resolved = _RUNTIME_DOWNLOAD
        print(f"Downloaded CJK font ({len(data)} bytes) → {_RUNTIME_DOWNLOAD}")
        return _resolved
    except Exception as exc:
        print(f"CJK font resolve failed: {exc}")
        _resolved = None
        return None


def configure_matplotlib_cjk() -> bool:
    """Register NanumGothic (or fallback) for matplotlib Hangul rendering."""
    global _mpl_configured
    if _mpl_configured:
        return True

    path = resolve_cjk_font_path()
    if path is None:
        return False

    try:
        import matplotlib
        from matplotlib import font_manager

        font_manager.fontManager.addfont(str(path))
        prop = font_manager.FontProperties(fname=str(path))
        family = prop.get_name()
        matplotlib.rcParams["font.family"] = family
        matplotlib.rcParams["font.sans-serif"] = [family, "DejaVu Sans"]
        matplotlib.rcParams["axes.unicode_minus"] = False
        _mpl_configured = True
        print(f"matplotlib CJK font: {family} ({path})")
        return True
    except Exception as exc:
        print(f"matplotlib CJK font setup failed: {exc}")
        return False
