"""Korea-exposure US ETF basket (/etf_kor15).

Tracks 15 US-listed ETFs via ETF CHECK (etfcheck.co.kr):
  name, ticker, AUM ($B), ADV (M shares), Top3 weights,
  plus Samsung Electronics / SK Hynix weights when outside Top3.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from dart_data import _esc
from etfcheck_client import (
    BASE_URL,
    EtfCheckClient,
    fetch_global_etf_item_info,
    fetch_global_etf_mast,
    fetch_global_etf_pdf_detail,
)

KST = ZoneInfo("Asia/Seoul")

KOR15_TICKERS: tuple[str, ...] = (
    "IEMG",
    "VEA",
    "EWY",
    "VXUS",
    "DRAM",
    "EMXC",
    "EEM",
    "SCHF",
    "VEU",
    "FNDF",
    "IXUS",
    "AIA",
    "VPL",
    "VT",
    "FLKR",
)

# Prefer issuer tickers; fall back to name tokens.
_SAMSUNG = {"codes": {"005930"}, "name_tokens": ("samsung electronics",)}
_HYNIX = {"codes": {"000660"}, "name_tokens": ("sk hynix", "skhynix")}

_CMD_ALIASES = {
    "/etf_kor15",
    "/etfkor15",
    "/etf_kor_15",
    "/kor15",
}


def is_etf_kor15_command(command: str) -> bool:
    parts = command.strip().split()
    if not parts:
        return False
    head = parts[0].lower().split("@", 1)[0]
    return head in _CMD_ALIASES


def _safe_float(value: Any) -> float | None:
    try:
        if value is None or value == "":
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _mast_by_symbol(client: EtfCheckClient) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for row in fetch_global_etf_mast(client):
        if not isinstance(row, dict):
            continue
        sym = str(row.get("SYMBOL") or "").strip().upper()
        if sym and sym not in out:
            out[sym] = row
        simple = str(row.get("SIMPLE_CODE") or "").strip().upper()
        if simple and simple not in out:
            out[simple] = row
    return out


def _resolve_mast_row(
    symbol: str,
    mast: dict[str, dict[str, Any]],
) -> tuple[str, dict[str, Any] | None, str | None]:
    """Return (resolved_symbol, mast_row, alias_note)."""
    symbol = symbol.upper()
    row = mast.get(symbol)
    if row:
        return symbol, row, None
    return symbol, None, None


def _call_with_retry(fn, *, attempts: int = 3, label: str = "etfcheck"):
    import time

    last_exc: Exception | None = None
    for i in range(max(1, attempts)):
        try:
            return fn()
        except Exception as exc:  # noqa: BLE001 — retry then surface
            last_exc = exc
            if i + 1 >= attempts:
                break
            time.sleep(0.45 * (i + 1))
            print(f"{label} retry {i + 1}/{attempts}: {exc}")
    assert last_exc is not None
    raise last_exc


def _normalize_holding(row: dict[str, Any]) -> dict[str, Any] | None:
    ticker = str(row.get("HLDTICKER") or row.get("TICKER") or "").strip().upper()
    name = str(row.get("HLDNAME") or row.get("F16004") or row.get("F16002") or "").strip()
    weight = _safe_float(row.get("HLDWGHT") if row.get("HLDWGHT") is not None else row.get("WEIGHT"))
    if not name and not ticker:
        return None
    return {
        "code": ticker or name,
        "name": name or ticker,
        "weight_pct": weight,
    }


def _match_special(
    holdings: list[dict[str, Any]],
    *,
    codes: set[str],
    name_tokens: tuple[str, ...],
) -> dict[str, Any] | None:
    for row in holdings:
        code = str(row.get("code") or "").upper()
        if code in codes:
            return row
    for row in holdings:
        name = str(row.get("name") or "").lower().replace(" ", "")
        for token in name_tokens:
            if token.replace(" ", "") in name:
                # Avoid Samsung Electro-Mechanics etc. when looking for Electronics
                if "electronics" in token and "electro-mechanics" in name:
                    continue
                if "electronics" in token and "electromechanics" in name:
                    continue
                return row
    return None


def _pick_display_holdings(
    holdings: list[dict[str, Any]],
) -> dict[str, Any]:
    ranked = sorted(
        [h for h in holdings if isinstance(h.get("weight_pct"), (int, float))],
        key=lambda h: float(h["weight_pct"]),
        reverse=True,
    )
    top3 = ranked[:3]
    top_codes = {str(h.get("code") or "").upper() for h in top3}

    samsung = _match_special(ranked, codes=_SAMSUNG["codes"], name_tokens=_SAMSUNG["name_tokens"])
    hynix = _match_special(ranked, codes=_HYNIX["codes"], name_tokens=_HYNIX["name_tokens"])

    extras: list[dict[str, Any]] = []
    for label, row in (("삼성전자", samsung), ("SK하이닉스", hynix)):
        if not row:
            extras.append(
                {
                    "label": label,
                    "code": "005930" if label == "삼성전자" else "000660",
                    "name": label,
                    "weight_pct": None,
                    "in_top3": False,
                    "missing": True,
                }
            )
            continue
        code = str(row.get("code") or "").upper()
        in_top3 = code in top_codes or any(
            str(t.get("name") or "").lower() == str(row.get("name") or "").lower() for t in top3
        )
        extras.append(
            {
                "label": label,
                "code": row.get("code"),
                "name": row.get("name") or label,
                "weight_pct": row.get("weight_pct"),
                "in_top3": in_top3,
                "missing": False,
            }
        )

    return {"top3": top3, "specials": extras}


def _enrich_exposure_fields(row: dict[str, Any]) -> dict[str, Any]:
    """Attach flat samsung/hynix weight & notional (AUM × weight) fields for charts."""
    aum = row.get("aum_usd_bn")
    samsung_w = None
    hynix_w = None
    for sp in row.get("specials") or []:
        if not isinstance(sp, dict) or sp.get("missing"):
            continue
        w = sp.get("weight_pct")
        if not isinstance(w, (int, float)):
            continue
        label = sp.get("label")
        if label == "삼성전자":
            samsung_w = float(w)
        elif label == "SK하이닉스":
            hynix_w = float(w)
        if isinstance(aum, (int, float)):
            sp["value_usd_bn"] = round(float(aum) * float(w) / 100.0, 4)

    row["samsung_weight_pct"] = samsung_w
    row["hynix_weight_pct"] = hynix_w
    if isinstance(aum, (int, float)) and samsung_w is not None:
        row["samsung_value_usd_bn"] = round(float(aum) * samsung_w / 100.0, 4)
    else:
        row["samsung_value_usd_bn"] = None
    if isinstance(aum, (int, float)) and hynix_w is not None:
        row["hynix_value_usd_bn"] = round(float(aum) * hynix_w / 100.0, 4)
    else:
        row["hynix_value_usd_bn"] = None
    return row


def _empty_row(symbol: str, *, error: str, **extra: Any) -> dict[str, Any]:
    row = {
        "symbol": symbol,
        "ok": False,
        "error": error,
        "name": extra.get("name") or symbol,
        "resolved_symbol": extra.get("resolved_symbol"),
        "alias_note": extra.get("alias_note"),
        "mstar_id": extra.get("mstar_id"),
        "aum_usd_bn": extra.get("aum_usd_bn"),
        "adv_m_shares": extra.get("adv_m_shares"),
        "top3": [],
        "specials": [],
        "samsung_weight_pct": None,
        "hynix_weight_pct": None,
        "samsung_value_usd_bn": None,
        "hynix_value_usd_bn": None,
    }
    return row


def _build_etf_row(
    client: EtfCheckClient,
    symbol: str,
    mast: dict[str, dict[str, Any]],
    *,
    pdf_limit: int = 500,
) -> dict[str, Any]:
    display_symbol = symbol.upper()
    resolved, base, alias_note = _resolve_mast_row(display_symbol, mast)
    if not base:
        return _empty_row(
            display_symbol,
            error="etfcheck mast에 없음 (티커 확인 필요)",
        )

    mstar_id = str(base.get("MSTARID") or "").strip()
    info = (
        _call_with_retry(
            lambda: fetch_global_etf_item_info(client, mstar_id),
            label=f"item:{resolved}",
        )
        or {}
    )
    name = str(info.get("FUNDNAME") or base.get("FUNDNAME") or resolved).strip()

    aum = _safe_float(info.get("CLSNETASSETS"))
    aum_bn = round(aum / 1e9, 2) if aum is not None else None

    adv = _safe_float(info.get("AVG_VOL_60D"))
    if adv is None:
        adv = _safe_float(info.get("AVG_VOL_3M"))
    adv_m = round(adv / 1e6, 2) if adv is not None else None

    try:
        raw_pdf = _call_with_retry(
            lambda: fetch_global_etf_pdf_detail(client, mstar_id, limit=pdf_limit),
            label=f"pdf:{resolved}",
        )
    except Exception as exc:
        return _empty_row(
            display_symbol,
            error=f"PDF 조회 실패: {exc}",
            name=name,
            resolved_symbol=resolved,
            alias_note=alias_note,
            mstar_id=mstar_id,
            aum_usd_bn=aum_bn,
            adv_m_shares=adv_m,
        )

    holdings = []
    for row in raw_pdf:
        if isinstance(row, dict):
            norm = _normalize_holding(row)
            if norm:
                holdings.append(norm)

    if not holdings:
        # Retry once with a larger limit — some broad ETFs truncate early.
        try:
            raw_pdf = _call_with_retry(
                lambda: fetch_global_etf_pdf_detail(
                    client, mstar_id, limit=max(pdf_limit, 800)
                ),
                attempts=2,
                label=f"pdf-wide:{resolved}",
            )
            for row in raw_pdf:
                if isinstance(row, dict):
                    norm = _normalize_holding(row)
                    if norm:
                        holdings.append(norm)
        except Exception as exc:
            print(f"pdf-wide {resolved} skipped: {exc}")

    if not holdings:
        return _empty_row(
            display_symbol,
            error="구성종목 PDF 비어 있음",
            name=name,
            resolved_symbol=resolved,
            alias_note=alias_note,
            mstar_id=mstar_id,
            aum_usd_bn=aum_bn,
            adv_m_shares=adv_m,
        )

    picked = _pick_display_holdings(holdings)
    out = {
        "symbol": display_symbol,
        "resolved_symbol": resolved,
        "alias_note": alias_note,
        "ok": True,
        "error": None,
        "name": name,
        "mstar_id": mstar_id,
        "aum_usd_bn": aum_bn,
        "adv_m_shares": adv_m,
        "holdings_fetched": len(holdings),
        "top3": picked["top3"],
        "specials": picked["specials"],
        "trade_date": str(info.get("TRADEDATE") or base.get("TRADEDATE") or "") or None,
    }
    return _enrich_exposure_fields(out)


def build_etf_kor15_brief(*, pdf_limit: int = 500) -> dict[str, Any]:
    from concurrent.futures import ThreadPoolExecutor, as_completed

    generated_at = datetime.now(KST)
    client = EtfCheckClient()
    client.warmup()
    mast = _call_with_retry(lambda: _mast_by_symbol(client), label="mast")

    rows_by_symbol: dict[str, dict[str, Any]] = {}

    def _one(symbol: str) -> dict[str, Any]:
        # Per-thread client — requests.Session is not fully thread-safe.
        local = EtfCheckClient()
        try:
            return _build_etf_row(local, symbol, mast, pdf_limit=pdf_limit)
        except Exception as exc:  # noqa: BLE001
            return _empty_row(symbol, error=str(exc))

    with ThreadPoolExecutor(max_workers=6) as pool:
        futs = {pool.submit(_one, sym): sym for sym in KOR15_TICKERS}
        for fut in as_completed(futs):
            sym = futs[fut]
            try:
                rows_by_symbol[sym] = fut.result()
            except Exception as exc:  # noqa: BLE001
                rows_by_symbol[sym] = _empty_row(sym, error=str(exc))

    rows = [rows_by_symbol[sym] for sym in KOR15_TICKERS]
    return {
        "generated_at": generated_at.isoformat(),
        "generated_at_display": generated_at.strftime("%Y-%m-%d %H:%M KST"),
        "source": BASE_URL,
        "tickers": list(KOR15_TICKERS),
        "rows": rows,
        "ok_count": sum(1 for r in rows if r.get("ok")),
    }


def etf_kor15_payload(*, pdf_limit: int = 500) -> dict[str, Any]:
    """JSON payload for the live ETF시황 KOR15 panel."""
    try:
        brief = build_etf_kor15_brief(pdf_limit=pdf_limit)
    except Exception as exc:
        return {
            "ok": False,
            "error": str(exc),
            "generated_at_display": datetime.now(KST).strftime("%Y-%m-%d %H:%M KST"),
            "source": BASE_URL,
            "rows": [],
        }
    return {
        "ok": True,
        "generated_at": brief.get("generated_at"),
        "generated_at_display": brief.get("generated_at_display"),
        "source": brief.get("source"),
        "tickers": brief.get("tickers"),
        "ok_count": brief.get("ok_count"),
        "rows": brief.get("rows") or [],
        "notes": [
            "편입액($B) = AUM($B) × 편입비(%) / 100",
            "삼성전자·SK하이닉스는 Top3 밖이어도 항상 표시",
        ],
    }


def _fmt_weight(value: Any) -> str:
    try:
        return f"{float(value):.2f}%"
    except (TypeError, ValueError):
        return "—"


def _fmt_top3_cell(top3: list[dict[str, Any]]) -> str:
    parts: list[str] = []
    for h in top3:
        name = str(h.get("name") or h.get("code") or "?")
        # shorten long names
        if len(name) > 18:
            name = name[:16] + "…"
        parts.append(f"{name} {_fmt_weight(h.get('weight_pct'))}")
    return " · ".join(parts) if parts else "—"


def _fmt_specials_cell(specials: list[dict[str, Any]]) -> str:
    bits: list[str] = []
    for s in specials:
        label = s.get("label") or s.get("name")
        if s.get("missing"):
            bits.append(f"{label} n/a")
            continue
        mark = "" if s.get("in_top3") else "★"
        bits.append(f"{mark}{label} {_fmt_weight(s.get('weight_pct'))}")
    return " · ".join(bits) if bits else "—"


def format_etf_kor15_telegram(brief: dict[str, Any]) -> str:
    lines = [
        "<b>🇰🇷 ETF KOR15 — 한국 노출 미국 ETF</b>",
        f"<i>{_esc(brief.get('generated_at_display', ''))}</i>",
        f'출처: <a href="{BASE_URL}">etfcheck.co.kr</a>',
        "<i>AUM=십억$, ADV=백만주(60D) · ★=Top3 밖 삼성전자/SK하이닉스</i>",
        "",
    ]
    for row in brief.get("rows") or []:
        sym = _esc(row.get("symbol"))
        alias = row.get("alias_note")
        alias_bit = f" <i>({_esc(alias)})</i>" if alias else ""
        if not row.get("ok"):
            lines.append(
                f"<code>{sym}</code> {_esc(row.get('name') or '')}{alias_bit}\n"
                f"    ⚠ {_esc(row.get('error') or '조회 실패')}"
            )
            continue
        aum = row.get("aum_usd_bn")
        adv = row.get("adv_m_shares")
        aum_s = f"{aum:.2f}" if isinstance(aum, (int, float)) else "—"
        adv_s = f"{adv:.2f}" if isinstance(adv, (int, float)) else "—"
        lines.append(
            f"<code>{sym}</code> {_esc(row.get('name') or '')}{alias_bit}\n"
            f"    AUM {aum_s} · ADV {adv_s}\n"
            f"    Top3 {_esc(_fmt_top3_cell(row.get('top3') or []))}\n"
            f"    {_esc(_fmt_specials_cell(row.get('specials') or []))}"
        )
    lines.extend(["", "<i>Not financial advice.</i>"])
    return "\n".join(lines).rstrip()


def plot_etf_kor15_chart(brief: dict[str, Any]):
    """Table + Samsung/Hynix weight bars."""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    from chart_buffers import figure_to_png_buffer
    from cjk_font import configure_matplotlib_cjk

    configure_matplotlib_cjk()
    palette = {
        "bg": "#0b1220",
        "panel": "#121b2d",
        "grid": "#243049",
        "text": "#e8edf7",
        "muted": "#93a4c3",
        "accent": "#60a5fa",
        "bar2": "#f472b6",
    }

    rows = brief.get("rows") or []
    fig = plt.figure(figsize=(16, 11), facecolor=palette["bg"])
    gs = fig.add_gridspec(2, 1, height_ratios=[2.4, 1.1], hspace=0.28)
    ax_table = fig.add_subplot(gs[0])
    ax_bar = fig.add_subplot(gs[1])
    ax_table.set_facecolor(palette["panel"])
    ax_bar.set_facecolor(palette["panel"])
    ax_table.axis("off")

    fig.suptitle(
        f"ETF KOR15 · {brief.get('generated_at_display', '')}",
        color=palette["text"],
        fontsize=13,
        y=0.98,
    )

    cell_text: list[list[str]] = []
    for row in rows:
        sym = str(row.get("symbol") or "")
        name = str(row.get("name") or "")
        if len(name) > 28:
            name = name[:26] + "…"
        if not row.get("ok"):
            cell_text.append(
                [
                    sym,
                    name,
                    "—",
                    "—",
                    str(row.get("error") or "fail")[:40],
                    "—",
                ]
            )
            continue
        aum = row.get("aum_usd_bn")
        adv = row.get("adv_m_shares")
        cell_text.append(
            [
                sym,
                name,
                f"{aum:.2f}" if isinstance(aum, (int, float)) else "—",
                f"{adv:.2f}" if isinstance(adv, (int, float)) else "—",
                _fmt_top3_cell(row.get("top3") or []),
                _fmt_specials_cell(row.get("specials") or []),
            ]
        )

    col_labels = ["Ticker", "ETF", "AUM($B)", "ADV(M)", "Top3 weights", "삼성전자 / SK하이닉스"]
    table = ax_table.table(
        cellText=cell_text,
        colLabels=col_labels,
        loc="center",
        cellLoc="left",
    )
    table.auto_set_font_size(False)
    table.set_fontsize(7.5)
    table.scale(1.0, 1.35)
    for (r, c), cell in table.get_celld().items():
        cell.set_edgecolor(palette["grid"])
        if r == 0:
            cell.set_facecolor("#1a2740")
            cell.set_text_props(color=palette["text"], weight="bold")
        else:
            cell.set_facecolor(palette["panel"])
            cell.set_text_props(color=palette["muted"] if c else palette["accent"])

    # Bar: Samsung / Hynix weights (prefer flat fields; fall back to specials)
    labels: list[str] = []
    samsung_w: list[float] = []
    hynix_w: list[float] = []
    for row in rows:
        labels.append(str(row.get("symbol") or ""))
        s_val = row.get("samsung_weight_pct")
        h_val = row.get("hynix_weight_pct")
        if not isinstance(s_val, (int, float)) or not isinstance(h_val, (int, float)):
            for sp in row.get("specials") or []:
                w = sp.get("weight_pct")
                if not isinstance(w, (int, float)):
                    continue
                if sp.get("label") == "삼성전자":
                    s_val = float(w)
                elif sp.get("label") == "SK하이닉스":
                    h_val = float(w)
        samsung_w.append(float(s_val) if isinstance(s_val, (int, float)) else 0.0)
        hynix_w.append(float(h_val) if isinstance(h_val, (int, float)) else 0.0)

    x = list(range(len(labels)))
    width = 0.38
    ax_bar.bar(
        [i - width / 2 for i in x],
        samsung_w,
        width=width,
        color=palette["accent"],
        label="삼성전자",
    )
    ax_bar.bar(
        [i + width / 2 for i in x],
        hynix_w,
        width=width,
        color=palette["bar2"],
        label="SK하이닉스",
    )
    ax_bar.set_xticks(x)
    ax_bar.set_xticklabels(labels, rotation=0, color=palette["muted"], fontsize=8)
    ax_bar.set_ylabel("Weight %", color=palette["muted"])
    ax_bar.set_title(
        "삼성전자 · SK하이닉스 편입비 (Top3 밖 포함)",
        color=palette["text"],
        fontsize=11,
    )
    ax_bar.tick_params(colors=palette["muted"], labelsize=8)
    ax_bar.legend(facecolor=palette["panel"], edgecolor=palette["grid"], labelcolor=palette["text"])
    for spine in ax_bar.spines.values():
        spine.set_color(palette["grid"])
    ax_bar.grid(True, axis="y", color=palette["grid"], alpha=0.35)
    ax_bar.set_xlim(-0.6, len(labels) - 0.4)

    fig.subplots_adjust(top=0.94, bottom=0.08, left=0.05, right=0.98, hspace=0.35)
    return figure_to_png_buffer(
        fig,
        dpi=140,
        facecolor=palette["bg"],
        bbox_inches="tight",
    )


def publish_etf_kor15_brief(brief: dict[str, Any] | None = None) -> bool:
    from web_publish import chart_to_image_payload, publish_brief, section_from_html

    brief = brief or build_etf_kor15_brief()
    text = format_etf_kor15_telegram(brief)
    images = []
    try:
        chart = plot_etf_kor15_chart(brief)
        images = [
            chart_to_image_payload(
                chart,
                id="etf_kor15",
                caption=f"ETF KOR15 · {brief.get('generated_at_display')}",
            )
        ]
    except Exception as exc:
        print(f"etf_kor15 chart skipped: {exc}")

    return publish_brief(
        "etf",
        "etf_kor15",
        title="ETF KOR15 — 한국 노출 미국 ETF",
        generated_at=brief.get("generated_at_display") or brief.get("generated_at"),
        sections=section_from_html(text, heading="KOR15"),
        images=images,
        meta={
            "tickers": brief.get("tickers"),
            "ok_count": brief.get("ok_count"),
            "source": brief.get("source"),
        },
    )


def run_etf_kor15(**kwargs: Any) -> dict[str, Any]:
    brief = build_etf_kor15_brief(**kwargs)
    text = format_etf_kor15_telegram(brief)
    messages: list[dict[str, Any]] = [{"text": text, "parse_mode": "HTML"}]
    try:
        chart = plot_etf_kor15_chart(brief)
        messages.append(
            {
                "photo": chart,
                "text": f"ETF KOR15 도표 · {brief.get('generated_at_display')}",
            }
        )
    except Exception as exc:
        print(f"etf_kor15 chart failed: {exc}")
    try:
        publish_etf_kor15_brief(brief)
    except Exception as pub_exc:
        print(f"web_publish etf_kor15 skipped: {pub_exc}")
    return {"brief": brief, "telegram_messages": messages}
