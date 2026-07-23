"""NXT (Nextrade) market brief — /summary_nxt.

Composes live + daily + monthly Nextrade views into a web page and Telegram pack,
mirroring /summary_kor's generate → HTML → telegram_messages flow.
"""

from __future__ import annotations

import calendar
import html
import json
import os
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo
from typing import Any

import nxt_data as nxt

KST = ZoneInfo("Asia/Seoul")
PROJECT_DIR = Path(__file__).resolve().parent
DATA_DIR = PROJECT_DIR / "data"
SUMMARY_NXT_HTML_PATH = DATA_DIR / "summary_nxt.html"
SUMMARY_NXT_META_PATH = DATA_DIR / "summary_nxt_meta.json"

FOCUS_CODES = ["005930", "000660"]

# Official Nextrade session hours (KST) — marketOverview/content.do
NXT_SESSIONS = (
    ("프리마켓", "08:00", "08:50"),
    ("메인마켓", "09:00:30", "15:20"),
    ("애프터마켓", "15:40", "20:00"),
)


def _esc(text: Any) -> str:
    return html.escape(str(text or ""), quote=False)


def _fmt_krw(value: int | None) -> str:
    return nxt._fmt_krw(value)


def _fmt_shares(value: int | None) -> str:
    return nxt._fmt_shares(value)


def _fmt_pct(value: float | None) -> str:
    return nxt._fmt_pct(value)


def _fmt_price(value: int | None) -> str:
    return nxt._fmt_price(value)


def resolve_summary_nxt_public_url(public_url: str = "") -> str:
    explicit = os.environ.get("SUMMARY_NXT_PUBLIC_URL", "").strip()
    if explicit:
        return explicit.rstrip("/")
    from summary_builder import resolve_summary_public_url

    base = (public_url or resolve_summary_public_url()).rstrip("/")
    if base.endswith("/summary"):
        return base[: -len("/summary")] + "/summary_nxt"
    if base.endswith("/summary_nxt"):
        return base
    return f"{base}/summary_nxt" if base else ""


def _session_day(now: datetime | None = None) -> date:
    now = now or datetime.now(KST)
    d = now.date()
    # Before premaket, prefer prior weekday.
    if now.hour < 8:
        d = d - timedelta(days=1)
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d


def _month_start(d: date) -> date:
    return date(d.year, d.month, 1)


def build_nxt_brief(*, as_of: date | None = None) -> dict[str, Any]:
    """Collect multi-angle NXT snapshot used by HTML + Telegram."""
    generated_at = datetime.now(KST)
    session_day = as_of or _session_day(generated_at)
    month = _month_start(session_day)
    month_end = date(
        month.year, month.month, calendar.monthrange(month.year, month.month)[1]
    )

    # Live focus names (KRX vs NXT via Naver)
    focus_live: list[dict[str, Any]] = []
    naver_rows = nxt.fetch_naver_realtime_rows(FOCUS_CODES)
    for code in FOCUS_CODES:
        meta = nxt.resolve_nxt_code(code)
        row = naver_rows.get(code) or {}
        nxt_block = nxt._parse_nxt_block(row.get("nxtOverMarketPriceInfo"))
        focus_live.append(
            {
                "code": code,
                "display": str(row.get("nm") or meta["display"]),
                "krx_price": nxt._safe_int(row.get("nv")),
                "krx_change_pct": nxt._safe_float(row.get("cr")),
                "krx_volume": nxt._safe_int(row.get("aq")),
                "krx_value": nxt._safe_int(row.get("aa")),
                "market_status": row.get("ms"),
                "nxt": nxt_block,
            }
        )

    # Full-day universe ranking for session_day
    universe = nxt.fetch_nextrade_day_universe(session_day)
    ranked = sorted(
        universe,
        key=lambda r: nxt._safe_int(r.get("accTrval")) or 0,
        reverse=True,
    )
    top_value = ranked[:12]
    total_value = sum(nxt._safe_int(r.get("accTrval")) or 0 for r in universe)
    total_volume = sum(nxt._safe_int(r.get("accTdQty")) or 0 for r in universe)

    movers_up: list[dict[str, Any]] = []
    movers_dn: list[dict[str, Any]] = []
    usable: list[tuple[float, dict]] = []
    for r in universe:
        pct = nxt._safe_float(r.get("upDownRate"))
        if pct is None:
            base = nxt._safe_int(r.get("basePrc"))
            cur = nxt._safe_int(r.get("curPrc"))
            if base and cur:
                pct = (cur - base) / base * 100.0
        if pct is None:
            continue
        if (nxt._safe_int(r.get("accTrval")) or 0) < 1_000_000_000:
            continue
        usable.append((pct, r))
    if usable:
        usable.sort(key=lambda x: x[0], reverse=True)
        for pct, r in usable[:6]:
            movers_up.append(_row_lite(r, pct))
        for pct, r in reversed(usable[-6:]):
            movers_dn.append(_row_lite(r, pct))

    # Month market daily + focus month sums
    market_days = nxt.fetch_market_daily(month, min(session_day, month_end))
    month_main = sum(nxt._safe_int(r.get("mainAccTrval")) or 0 for r in market_days)
    month_total = sum(nxt._safe_int(r.get("totalAccTrval")) or 0 for r in market_days)
    shares = [
        nxt._safe_float(r.get("mktShr"))
        for r in market_days
        if r.get("mktShr") is not None
    ]
    avg_share = sum(shares) / len(shares) if shares else None
    today_mkt = None
    day_key = session_day.strftime("%Y%m%d")
    for r in market_days:
        if str(r.get("aggDd")) == day_key:
            today_mkt = r
            break

    focus_month = [
        nxt.build_stock_month(code, month.year, month.month)
        for code in FOCUS_CODES
    ]

    # Session-day focus from official NXT (not Naver) for matching TOP tables
    focus_official: list[dict[str, Any]] = []
    for code in FOCUS_CODES:
        row = nxt.fetch_nextrade_day(code, session_day)
        meta = nxt.resolve_nxt_code(code)
        if not row:
            focus_official.append(
                {
                    "code": code,
                    "display": meta["display"],
                    "missing": True,
                }
            )
            continue
        focus_official.append(
            {
                "code": code,
                "display": str(row.get("isuAbwdNm") or meta["display"]),
                "price": nxt._safe_int(row.get("curPrc")),
                "change": nxt._safe_int(row.get("contrastPrc")),
                "change_pct": nxt._safe_float(row.get("upDownRate")),
                "volume": nxt._safe_int(row.get("accTdQty")),
                "value": nxt._safe_int(row.get("accTrval")),
                "open": nxt._safe_int(row.get("oppr")),
                "high": nxt._safe_int(row.get("hgpr")),
                "low": nxt._safe_int(row.get("lwpr")),
                "missing": False,
            }
        )

    return {
        "kind": "summary_nxt",
        "generated_at": generated_at.isoformat(),
        "generated_at_display": generated_at.strftime("%Y-%m-%d %H:%M:%S KST"),
        "session_day": session_day.isoformat(),
        "month_label": f"{month.year}-{month.month:02d}",
        "sessions": [
            {"name": n, "start": s, "end": e} for n, s, e in NXT_SESSIONS
        ],
        "market": {
            "stock_count": len(universe),
            "total_value": total_value or None,
            "total_volume": total_volume or None,
            "today": {
                "main_value": nxt._safe_int((today_mkt or {}).get("mainAccTrval")),
                "pre_value": nxt._safe_int((today_mkt or {}).get("preAccTrval")),
                "aft_value": nxt._safe_int((today_mkt or {}).get("aftAccTrval")),
                "total_value": nxt._safe_int((today_mkt or {}).get("totalAccTrval")),
                "mkt_share": nxt._safe_float((today_mkt or {}).get("mktShr")),
                "isu_cnt": nxt._safe_int((today_mkt or {}).get("totalIsuCnt")),
            },
            "month": {
                "days": len(market_days),
                "main_value": month_main or None,
                "total_value": month_total or None,
                "avg_share": avg_share,
                "daily": [
                    {
                        "date": str(r.get("aggDd")),
                        "main_value": nxt._safe_int(r.get("mainAccTrval")),
                        "total_value": nxt._safe_int(r.get("totalAccTrval")),
                        "mkt_share": nxt._safe_float(r.get("mktShr")),
                    }
                    for r in market_days
                ],
            },
        },
        "top_value": [_row_lite(r) for r in top_value],
        "movers_up": movers_up,
        "movers_dn": movers_dn,
        "focus_live": focus_live,
        "focus_official": focus_official,
        "focus_month": focus_month,
        "source": "nextrade.co.kr + Naver realtime",
    }


def _row_lite(row: dict[str, Any], pct: float | None = None) -> dict[str, Any]:
    code = str(row.get("isuSrdCd") or "").lstrip("A")
    if pct is None:
        pct = nxt._safe_float(row.get("upDownRate"))
        if pct is None:
            base = nxt._safe_int(row.get("basePrc"))
            cur = nxt._safe_int(row.get("curPrc"))
            if base and cur:
                pct = (cur - base) / base * 100.0
    return {
        "code": code,
        "display": row.get("isuAbwdNm") or code,
        "market": row.get("mktNm"),
        "price": nxt._safe_int(row.get("curPrc")),
        "change_pct": pct,
        "volume": nxt._safe_int(row.get("accTdQty")),
        "value": nxt._safe_int(row.get("accTrval")),
    }


def render_summary_nxt_telegram(summary: dict) -> list[dict]:
    day = summary.get("session_day", "")
    month = summary.get("month_label", "")
    mkt = summary.get("market") or {}
    today = mkt.get("today") or {}
    month_blk = mkt.get("month") or {}

    msgs: list[dict] = []
    header = [
        "<b>📡 SavvyETF NXT Brief</b>",
        f"<i>{_esc(summary.get('generated_at_display'))}</i>",
        f"세션일 <code>{_esc(day)}</code> · 월 {_esc(month)}",
        "",
        "<b>세션(KST)</b> 프리 08:00–08:50 · 메인 09:00:30–15:20 · 애프터 15:40–20:00",
        "",
        "<b>시장 요약</b>",
        f"종목 {mkt.get('stock_count') or 0} · "
        f"대금 {_fmt_krw(mkt.get('total_value'))} · "
        f"량 {_fmt_shares(mkt.get('total_volume'))}",
    ]
    if today.get("main_value") is not None:
        header.append(
            f"일별 정규 {_fmt_krw(today.get('main_value'))} · "
            f"전후장포함 {_fmt_krw(today.get('total_value'))} · "
            f"점유율 "
            + (
                f"{today['mkt_share']:.2f}%"
                if today.get("mkt_share") is not None
                else "—"
            )
        )
    header.append(
        f"당월 정규합 {_fmt_krw(month_blk.get('main_value'))} "
        f"({month_blk.get('days') or 0}일) · "
        f"평균점유 "
        + (
            f"{month_blk['avg_share']:.2f}%"
            if month_blk.get("avg_share") is not None
            else "—"
        )
    )
    msgs.append({"text": "\n".join(header), "parse_mode": "HTML"})

    # Focus live
    focus_lines = ["<b>🔎 포커스 (KRX vs NXT 실시간)</b>"]
    for item in summary.get("focus_live") or []:
        nb = item.get("nxt") or {}
        focus_lines.append(
            f"<b>{_esc(item.get('display'))}</b> (<code>{item['code']}</code>)"
        )
        focus_lines.append(
            f"KRX {_fmt_price(item.get('krx_price'))} {_fmt_pct(item.get('krx_change_pct'))} "
            f"· 대금 {_fmt_krw(item.get('krx_value'))}"
        )
        if nb.get("available"):
            ratio = ""
            if item.get("krx_volume") and nb.get("volume"):
                ratio = f" · NXT/KRX {100.0 * nb['volume'] / item['krx_volume']:.0f}%"
            focus_lines.append(
                f"NXT {_fmt_price(nb.get('price'))} {_fmt_pct(nb.get('change_pct'))} "
                f"· 대금 {_fmt_krw(nb.get('value'))}{ratio}"
            )
        else:
            focus_lines.append("NXT —")
    msgs.append({"text": "\n".join(focus_lines), "parse_mode": "HTML"})

    # TOP value
    top_lines = [f"<b>🏆 NXT 거래대금 TOP — {_esc(day)}</b>"]
    for i, row in enumerate((summary.get("top_value") or [])[:10], 1):
        top_lines.append(
            f"{i}. <b>{_esc(row.get('display'))}</b> "
            f"(<code>{_esc(row.get('code'))}</code>) "
            f"{_fmt_pct(row.get('change_pct'))} · {_fmt_krw(row.get('value'))}"
        )
    msgs.append({"text": "\n".join(top_lines), "parse_mode": "HTML"})

    # Movers
    mv = ["<b>▲ 상승 TOP</b>"]
    for row in (summary.get("movers_up") or [])[:5]:
        mv.append(
            f"  {_esc(row.get('display'))} {_fmt_pct(row.get('change_pct'))} "
            f"· {_fmt_krw(row.get('value'))}"
        )
    mv.append("")
    mv.append("<b>▼ 하락 TOP</b>")
    for row in (summary.get("movers_dn") or [])[:5]:
        mv.append(
            f"  {_esc(row.get('display'))} {_fmt_pct(row.get('change_pct'))} "
            f"· {_fmt_krw(row.get('value'))}"
        )
    msgs.append({"text": "\n".join(mv), "parse_mode": "HTML"})

    # Month focus
    mlines = [f"<b>📅 {_esc(month)} 포커스 누적 (NXT)</b>"]
    for item in summary.get("focus_month") or []:
        mlines.append(
            f"<b>{_esc(item.get('display'))}</b> "
            f"{item.get('session_days') or 0}일 · "
            f"{_fmt_shares(item.get('nxt_volume'))}주 · "
            f"{_fmt_krw(item.get('nxt_value'))}"
        )
        daily = item.get("daily") or []
        if daily:
            peak = max(daily, key=lambda d: d["value"])
            mlines.append(
                f"  최대일 {peak['date'][5:]} {_fmt_krw(peak['value'])}"
            )
    mlines.append("")
    mlines.append(
        "<i>세부: /nxt dailyvol · /nxt daily · /nxt stock · /nxt help</i>"
    )
    msgs.append({"text": "\n".join(mlines), "parse_mode": "HTML"})
    return msgs


def render_summary_nxt_html(summary: dict, public_url: str = "") -> str:
    nxt_url = resolve_summary_nxt_public_url(public_url)
    base_url = nxt_url.rstrip("/").removesuffix("/summary_nxt")
    day = summary.get("session_day", "")
    month = summary.get("month_label", "")
    mkt = summary.get("market") or {}
    today = mkt.get("today") or {}
    month_blk = mkt.get("month") or {}
    title = f"SavvyETF NXT Brief — {summary.get('generated_at_display', '')}"

    def pct_class(v: float | None) -> str:
        if v is None:
            return ""
        return "pos" if v >= 0 else "neg"

    # Focus live cards
    focus_cards = []
    for item in summary.get("focus_live") or []:
        nb = item.get("nxt") or {}
        ratio = "—"
        if item.get("krx_volume") and nb.get("volume"):
            ratio = f"{100.0 * nb['volume'] / item['krx_volume']:.1f}%"
        focus_cards.append(
            f"""
            <article class="focus-card">
              <h3>{_esc(item.get('display'))} <code>{_esc(item['code'])}</code></h3>
              <div class="two-col">
                <div>
                  <div class="label">KRX</div>
                  <div class="price">{_esc(_fmt_price(item.get('krx_price')))}</div>
                  <div class="{pct_class(item.get('krx_change_pct'))}">{_esc(_fmt_pct(item.get('krx_change_pct')))}</div>
                  <div class="meta">대금 {_esc(_fmt_krw(item.get('krx_value')))}</div>
                </div>
                <div>
                  <div class="label">NXT</div>
                  <div class="price">{_esc(_fmt_price(nb.get('price') if nb.get('available') else None))}</div>
                  <div class="{pct_class(nb.get('change_pct'))}">{_esc(_fmt_pct(nb.get('change_pct') if nb.get('available') else None))}</div>
                  <div class="meta">대금 {_esc(_fmt_krw(nb.get('value') if nb.get('available') else None))} · 비율 {ratio}</div>
                </div>
              </div>
            </article>
            """
        )

    top_rows = "".join(
        f"<tr><td>{i}</td><td><strong>{_esc(r.get('display'))}</strong> "
        f"<span class='code'>{_esc(r.get('code'))}</span></td>"
        f"<td>{_esc(r.get('market'))}</td>"
        f"<td class='num'>{_esc(_fmt_price(r.get('price')))}</td>"
        f"<td class='num {pct_class(r.get('change_pct'))}'>{_esc(_fmt_pct(r.get('change_pct')))}</td>"
        f"<td class='num'>{_esc(_fmt_krw(r.get('value')))}</td>"
        f"<td class='num'>{_esc(_fmt_shares(r.get('volume')))}</td></tr>"
        for i, r in enumerate(summary.get("top_value") or [], 1)
    )

    def mover_list(rows: list, cls: str) -> str:
        items = "".join(
            f"<li><strong>{_esc(r.get('display'))}</strong> "
            f"<span class='{cls}'>{_esc(_fmt_pct(r.get('change_pct')))}</span> "
            f"<span class='meta'>{_esc(_fmt_krw(r.get('value')))}</span></li>"
            for r in rows
        )
        return f"<ul class='mover-list'>{items or '<li class=meta>없음</li>'}</ul>"

    month_focus = "".join(
        f"""
        <div class="month-card">
          <h4>{_esc(item.get('display'))}</h4>
          <p class="big">{_esc(_fmt_krw(item.get('nxt_value')))}</p>
          <p class="meta">{item.get('session_days') or 0}일 · {_esc(_fmt_shares(item.get('nxt_volume')))}주</p>
        </div>
        """
        for item in summary.get("focus_month") or []
    )

    daily = month_blk.get("daily") or []
    chart_bars = ""
    if daily:
        vals = [d.get("main_value") or 0 for d in daily]
        peak = max(vals) or 1
        for d in daily:
            h = max(4, int(40 * (d.get("main_value") or 0) / peak))
            dd = str(d.get("date") or "")
            label = f"{dd[4:6]}-{dd[6:8]}" if len(dd) == 8 else dd
            chart_bars += (
                f"<div class='bar' title='{label} {_esc(_fmt_krw(d.get('main_value')))}'>"
                f"<span style='height:{h}px'></span>"
                f"<em>{_esc(label[-2:])}</em></div>"
            )

    share_txt = (
        f"{today['mkt_share']:.2f}%"
        if today.get("mkt_share") is not None
        else "—"
    )
    avg_share_txt = (
        f"{month_blk['avg_share']:.2f}%"
        if month_blk.get("avg_share") is not None
        else "—"
    )

    css_link = (
        f'<link rel="stylesheet" href="{_esc(base_url)}/css/styles.css" />'
        if base_url
        else ""
    )
    fonts = (
        '<link rel="preconnect" href="https://fonts.googleapis.com" />'
        '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />'
        '<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700'
        '&family=IBM+Plex+Serif:wght@500;600&display=swap" rel="stylesheet" />'
    )

    return f"""<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{_esc(title)}</title>
  {fonts}
  {css_link}
  <style>
    :root {{
      --nx-bg0: #0b1214;
      --nx-bg1: #102028;
      --nx-panel: #14262e;
      --nx-line: #243940;
      --nx-text: #e7f2f0;
      --nx-mute: #8aa3a0;
      --nx-accent: #2ec4b6;
      --nx-accent-2: #f4a261;
      --nx-neg: #e76f51;
      --nx-pos: #2a9d8f;
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0; color: var(--nx-text);
      font-family: "IBM Plex Sans", system-ui, sans-serif;
      background:
        radial-gradient(1200px 500px at 10% -10%, rgba(46,196,182,.18), transparent 60%),
        radial-gradient(900px 400px at 100% 0%, rgba(244,162,97,.10), transparent 55%),
        linear-gradient(180deg, var(--nx-bg0), var(--nx-bg1) 40%, #0d171b);
      min-height: 100vh;
    }}
    .wrap {{ max-width: none; width: 100%; margin: 0 auto; padding: 18px 12px 40px; box-sizing: border-box; }}
    .brand {{
      font-weight: 700; letter-spacing: .02em; display: flex; gap: 10px; align-items: center;
      margin-bottom: 1.25rem;
    }}
    .brand i {{
      width: 10px; height: 10px; border-radius: 2px; background: var(--nx-accent);
      box-shadow: 0 0 0 4px rgba(46,196,182,.15);
    }}
    .hero {{
      position: relative; overflow: hidden;
      border: 1px solid var(--nx-line); border-radius: 18px;
      padding: 1.6rem 1.4rem 1.4rem;
      background:
        linear-gradient(135deg, rgba(46,196,182,.12), transparent 42%),
        var(--nx-panel);
      margin-bottom: 1.5rem;
    }}
    .hero h1 {{
      font-family: "IBM Plex Serif", Georgia, serif;
      font-size: clamp(1.7rem, 3vw, 2.35rem);
      margin: 0 0 .45rem; font-weight: 600;
    }}
    .hero .lead {{ color: var(--nx-mute); margin: 0 0 1rem; max-width: 46rem; line-height: 1.5; }}
    .pills {{ display: flex; flex-wrap: wrap; gap: 8px; }}
    .pill {{
      font-size: .78rem; padding: 5px 10px; border-radius: 999px;
      border: 1px solid var(--nx-line); color: var(--nx-mute); background: rgba(0,0,0,.18);
    }}
    .pill strong {{ color: var(--nx-accent); font-weight: 600; }}
    .stats {{
      display: grid; gap: 12px;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      margin-top: 1.25rem;
    }}
    .stat {{
      padding: 12px 14px; border-radius: 12px; border: 1px solid var(--nx-line);
      background: rgba(0,0,0,.2);
    }}
    .stat .k {{ font-size: .72rem; color: var(--nx-mute); text-transform: uppercase; letter-spacing: .04em; }}
    .stat .v {{ font-size: 1.15rem; font-weight: 600; margin-top: 4px; font-variant-numeric: tabular-nums; }}
    section.block {{
      margin: 1.25rem 0; padding: 1.25rem;
      border: 1px solid var(--nx-line); border-radius: 16px; background: rgba(20,38,46,.85);
    }}
    section.block h2 {{
      margin: 0 0 1rem; font-size: 1.15rem; font-family: "IBM Plex Serif", Georgia, serif;
      display: flex; align-items: baseline; gap: 10px;
    }}
    section.block h2 span {{ font-size: .8rem; color: var(--nx-mute); font-family: "IBM Plex Sans", sans-serif; }}
    .focus-grid {{ display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }}
    .focus-card {{
      padding: 14px; border-radius: 12px; border: 1px solid var(--nx-line);
      background: rgba(0,0,0,.2);
    }}
    .focus-card h3 {{ margin: 0 0 10px; font-size: 1rem; }}
    .focus-card code {{ font-size: .8rem; color: var(--nx-accent); }}
    .two-col {{ display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }}
    .label {{ font-size: .7rem; color: var(--nx-mute); letter-spacing: .05em; }}
    .price {{ font-size: 1.2rem; font-weight: 600; font-variant-numeric: tabular-nums; }}
    .meta {{ color: var(--nx-mute); font-size: .85rem; }}
    .pos {{ color: var(--nx-pos); }}
    .neg {{ color: var(--nx-neg); }}
    table {{ width: 100%; border-collapse: collapse; font-size: .9rem; }}
    th, td {{ padding: 8px 6px; border-bottom: 1px solid var(--nx-line); text-align: left; }}
    th {{ color: var(--nx-mute); font-weight: 500; font-size: .75rem; text-transform: uppercase; }}
    td.num, th.num {{ text-align: right; font-variant-numeric: tabular-nums; }}
    .code {{ color: var(--nx-mute); font-size: .8rem; margin-left: 4px; }}
    .movers {{ display: grid; gap: 14px; grid-template-columns: 1fr 1fr; }}
    @media (max-width: 700px) {{ .movers, .two-col {{ grid-template-columns: 1fr; }} }}
    .mover-list {{ margin: 0; padding-left: 18px; }}
    .mover-list li {{ margin: 8px 0; }}
    .month-grid {{ display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); }}
    .month-card {{
      padding: 14px; border-radius: 12px; border: 1px solid var(--nx-line);
      background: linear-gradient(160deg, rgba(46,196,182,.08), transparent 55%), rgba(0,0,0,.18);
    }}
    .month-card h4 {{ margin: 0 0 6px; }}
    .month-card .big {{ font-size: 1.35rem; font-weight: 700; margin: 0; color: var(--nx-accent); }}
    .bars {{
      display: flex; align-items: flex-end; gap: 4px; height: 64px; margin-top: 12px;
      padding-top: 8px; border-top: 1px dashed var(--nx-line);
    }}
    .bar {{ flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 4px; }}
    .bar span {{
      width: 100%; max-width: 14px; border-radius: 3px 3px 0 0;
      background: linear-gradient(180deg, var(--nx-accent), #1a7a72);
    }}
    .bar em {{ font-style: normal; font-size: .62rem; color: var(--nx-mute); }}
    footer {{
      margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid var(--nx-line);
      color: var(--nx-mute); font-size: .82rem;
    }}
    a {{ color: var(--nx-accent); }}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="brand"><i></i> SavvyETF · NXT</div>
    <section class="hero">
      <h1>Nextrade Brief</h1>
      <p class="lead">
        넥스트레이드(NXT) 정규·전후장 흐름을 한눈에.
        세션일 {_esc(day)} · {_esc(summary.get('generated_at_display'))}
      </p>
      <div class="pills">
        <span class="pill"><strong>프리</strong> 08:00–08:50</span>
        <span class="pill"><strong>메인</strong> 09:00:30–15:20</span>
        <span class="pill"><strong>애프터</strong> 15:40–20:00</span>
        <span class="pill">월 {_esc(month)}</span>
      </div>
      <div class="stats">
        <div class="stat"><div class="k">당일 종목</div><div class="v">{mkt.get('stock_count') or 0}</div></div>
        <div class="stat"><div class="k">당일 대금</div><div class="v">{_esc(_fmt_krw(mkt.get('total_value')))}</div></div>
        <div class="stat"><div class="k">정규 대금</div><div class="v">{_esc(_fmt_krw(today.get('main_value')))}</div></div>
        <div class="stat"><div class="k">거래량 점유율</div><div class="v">{_esc(share_txt)}</div></div>
        <div class="stat"><div class="k">당월 정규합</div><div class="v">{_esc(_fmt_krw(month_blk.get('main_value')))}</div></div>
        <div class="stat"><div class="k">당월 평균점유</div><div class="v">{_esc(avg_share_txt)}</div></div>
      </div>
      <p class="meta" style="margin:.9rem 0 0">
        Live: <a href="{_esc(nxt_url)}">{_esc(nxt_url or '/summary_nxt')}</a>
        · Korea: <a href="{_esc((base_url + '/summary_kor') if base_url else '/summary_kor')}">/summary_kor</a>
      </p>
    </section>

    <section class="block">
      <h2>포커스 <span>삼성전자 · SK하이닉스 — KRX vs NXT</span></h2>
      <div class="focus-grid">{''.join(focus_cards)}</div>
    </section>

    <section class="block">
      <h2>거래대금 TOP <span>{_esc(day)} · NXT 정규시장</span></h2>
      <table>
        <thead>
          <tr><th>#</th><th>종목</th><th>시장</th><th class="num">현재가</th>
              <th class="num">등락</th><th class="num">대금</th><th class="num">거래량</th></tr>
        </thead>
        <tbody>{top_rows}</tbody>
      </table>
    </section>

    <section class="block">
      <h2>등락 <span>거래대금 10억↑</span></h2>
      <div class="movers">
        <div>
          <h3 style="margin:0 0 .5rem;color:var(--nx-pos)">▲ 상승</h3>
          {mover_list(summary.get('movers_up') or [], 'pos')}
        </div>
        <div>
          <h3 style="margin:0 0 .5rem;color:var(--nx-neg)">▼ 하락</h3>
          {mover_list(summary.get('movers_dn') or [], 'neg')}
        </div>
      </div>
    </section>

    <section class="block">
      <h2>월간 누적 <span>{_esc(month)} · 포커스 종목 NXT 대금</span></h2>
      <div class="month-grid">{month_focus}</div>
      <div class="bars" aria-label="daily main trading value">{chart_bars}</div>
      <p class="meta">막대 = 당월 일별 NXT 정규시장 대금</p>
    </section>

    <footer>
      출처: {_esc(summary.get('source'))} · 투자 권유 아님 ·
      세부 명령 /nxt help · Generated {_esc(summary.get('generated_at_display'))}
    </footer>
  </div>
</body>
</html>
"""


def save_summary_nxt(summary: dict, html_content: str) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    SUMMARY_NXT_HTML_PATH.write_text(html_content, encoding="utf-8")
    SUMMARY_NXT_META_PATH.write_text(
        json.dumps(
            {
                "generated_at": summary.get("generated_at"),
                "generated_at_display": summary.get("generated_at_display"),
                "session_day": summary.get("session_day"),
                "month_label": summary.get("month_label"),
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )


def load_summary_nxt_html() -> str | None:
    if not SUMMARY_NXT_HTML_PATH.is_file():
        return None
    return SUMMARY_NXT_HTML_PATH.read_text(encoding="utf-8")


def generate_summary_nxt(public_url: str = "", *, as_of: date | None = None) -> dict:
    summary = build_nxt_brief(as_of=as_of)
    nxt_web = resolve_summary_nxt_public_url(public_url)
    try:
        html_content = render_summary_nxt_html(summary, public_url=public_url or nxt_web)
        save_summary_nxt(summary, html_content)
        summary["html"] = html_content
    except Exception as exc:
        summary["html_error"] = str(exc)
        print(f"NXT HTML export failed: {exc}")
        stub = (
            f"<html><body><h1>NXT Brief</h1>"
            f"<p>{_esc(summary.get('generated_at_display'))}</p>"
            f"<p>HTML render failed: {_esc(exc)}</p></body></html>"
        )
        try:
            save_summary_nxt(summary, stub)
            summary["html"] = stub
        except Exception:
            pass

    messages = render_summary_nxt_telegram(summary)
    if nxt_web:
        messages.append(
            {
                "text": f"📡 NXT brief (web): {nxt_web}",
            }
        )
    summary["telegram_messages"] = messages

    try:
        from web_publish import publish_brief

        publish_brief(
            "kr",
            "summary_nxt",
            title="국내 시황 /summary_nxt",
            generated_at=summary.get("generated_at_display")
            or summary.get("generated_at"),
            html=summary.get("html"),
            meta={},
        )
    except Exception as pub_exc:
        print(f"web_publish summary_nxt skipped: {pub_exc}")

    return summary
