"""Safe in-memory PNG helpers for Telegram chart uploads."""

from __future__ import annotations

from io import BytesIO


def snapshot_png_buffer(buf: BytesIO) -> BytesIO:
    """Copy PNG bytes into a fresh buffer (survives closed/consumed sources)."""
    if getattr(buf, "closed", False):
        raise ValueError("I/O operation on closed file")
    try:
        data = buf.getvalue()
    except ValueError:
        # Already closed or unreadable
        raise
    if not data:
        raise ValueError("Empty chart buffer")
    out = BytesIO(data)
    out.seek(0)
    return out


def figure_to_png_buffer(fig, **savefig_kwargs) -> BytesIO:
    """Render a matplotlib figure to an independent PNG BytesIO."""
    import matplotlib.pyplot as plt

    kwargs = {"format": "png", **savefig_kwargs}
    raw = BytesIO()
    fig.savefig(raw, **kwargs)
    try:
        data = raw.getvalue()
    finally:
        try:
            raw.close()
        except Exception:
            pass
        plt.close(fig)
    out = BytesIO(data)
    out.seek(0)
    return out


def photo_to_upload_bytes(photo) -> bytes:
    """Normalize reply['photo'] into raw PNG bytes for Telegram upload."""
    if photo is None:
        raise ValueError("No photo payload")
    if isinstance(photo, (bytes, bytearray, memoryview)):
        data = bytes(photo)
        if not data:
            raise ValueError("Empty photo bytes")
        return data
    if getattr(photo, "closed", False):
        raise ValueError("I/O operation on closed file")
    getvalue = getattr(photo, "getvalue", None)
    if callable(getvalue):
        try:
            data = getvalue()
            if data:
                return bytes(data)
        except ValueError:
            raise
        except Exception:
            pass
    seek = getattr(photo, "seek", None)
    read = getattr(photo, "read", None)
    if callable(seek) and callable(read):
        seek(0)
        data = read()
        if data:
            return bytes(data)
    raise ValueError("Unsupported photo payload")
