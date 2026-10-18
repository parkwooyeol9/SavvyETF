"""ETF Flow 주간 업데이트 — 요청 양식(정리 / Raw Data) 엑셀 작성.

요청 양식의 섹션 제목·비고(K열)·행 순서를 그대로 두고, Top 10/20 처럼 행이 여러 개
필요한 곳만 행을 늘렸다. 각 섹션 오른쪽(M열~)에 셀 범위를 참조하는 네이티브 차트를 둔다.
색: ChartFormat 팔레트(425288 · B2B2B2 · CC9900).
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from openpyxl import Workbook
from openpyxl.chart import BarChart, Reference
from openpyxl.chart.label import DataLabelList
from openpyxl.chart.shapes import GraphicalProperties
from openpyxl.drawing.line import LineProperties
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

NAVY, GRAY, GOLD, LIGHT = "425288", "B2B2B2", "CC9900", "D9DEEB"
WEEK_COLORS = ["D9D9D9", "B2B2B2", "8C9AC2", NAVY]  # 오래된 주 → 이번주
FONT = "맑은 고딕"

F_BASE = Font(name=FONT, size=10)
F_BOLD = Font(name=FONT, size=10, bold=True)
F_TITLE = Font(name=FONT, size=12, bold=True, color=NAVY)
F_HEAD = Font(name=FONT, size=10, bold=True, color="FFFFFF")
F_NOTE = Font(name=FONT, size=9, color="7F7F7F")
F_ORG = Font(name=FONT, size=14, bold=True)
FILL_HEAD = PatternFill("solid", fgColor=NAVY)
FILL_SUB = PatternFill("solid", fgColor=LIGHT)
THIN = Side(style="thin", color="BFBFBF")
B_ALL = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
CENTER = Alignment(horizontal="center", vertical="center", wrap_text=True)
LEFT = Alignment(horizontal="left", vertical="center")
RIGHT = Alignment(horizontal="right", vertical="center")

FMT_B = '#,##0.00;[Blue]-#,##0.00;0.00'
FMT_PCT = '0.00"%";[Blue]-0.00"%"'
FMT_EOK = '#,##0;[Blue]-#,##0;0'


def _cell(ws, row: int, col: int, value: Any, *, font=F_BASE, fmt: str | None = None,
          align=None, fill=None, border=True):
    c = ws.cell(row=row, column=col, value=value)
    c.font = font
    if fmt:
        c.number_format = fmt
    if align is not None:
        c.alignment = align
    if fill is not None:
        c.fill = fill
    if border:
        c.border = B_ALL
    return c


def _header(ws, row: int, col: int, labels: list[str]) -> None:
    for i, lab in enumerate(labels):
        _cell(ws, row, col + i, lab, font=F_HEAD, fill=FILL_HEAD, align=CENTER)


def _title(ws, row: int, text: str, notes: list[str]) -> None:
    ws.cell(row=row, column=1, value=text).font = F_TITLE
    for i, n in enumerate(notes):
        ws.cell(row=row + i, column=11, value=n).font = F_NOTE


def _bar(title: str, *, horizontal=False, y_fmt="#,##0.0", colors: list[str] | None = None,
         width=17.0, height=7.5, labels=False, gap=60) -> BarChart:
    ch = BarChart()
    ch.type = "bar" if horizontal else "col"
    ch.grouping = "clustered"
    ch.title = title
    ch.style = 2
    # 데이터 라벨이 있으면 하단 범례와 겹치므로 여유 높이 + 범례를 오른쪽으로
    ch.width, ch.height = width, (height + 1.0 if labels else height)
    ch.gapWidth = gap
    ch.y_axis.numFmt = y_fmt
    ch.y_axis.majorGridlines.spPr = GraphicalProperties(ln=LineProperties(solidFill="E7E6E6"))
    ch.y_axis.delete = False
    ch.x_axis.delete = False
    ch.x_axis.tickLblPos = "low"
    ch.legend.position = "r" if labels else "b"
    ch._colors = colors or [NAVY, GRAY, GOLD]
    ch._labels = labels
    ch._horizontal = horizontal
    return ch


def _finish(ch: BarChart) -> BarChart:
    for i, s in enumerate(ch.series):
        color = ch._colors[i % len(ch._colors)]
        s.graphicalProperties.solidFill = color
        s.graphicalProperties.line.solidFill = color
        if ch._labels:
            s.dLbls = DataLabelList()
            s.dLbls.showVal = True
            s.dLbls.showCatName = False
            s.dLbls.showSerName = False
            s.dLbls.numFmt = ch.y_axis.numFmt
            # 막대 바깥쪽 — 하단 범례·축과 겹침 완화
            s.dLbls.dLblPos = "outEnd"
    # 시리즈 1개면 범례 불필요(이미 None 인 차트는 유지)
    if len(ch.series) <= 1 and ch.legend is not None:
        ch.legend = None
    return ch


def write_workbook(payload: dict[str, Any], path: Path) -> Path:
    wb = Workbook()
    ws = wb.active
    ws.title = "정리"
    ws.sheet_view.showGridLines = False
    us, kr, ev = payload["us"], payload["kr"], payload["events"]
    w = us["weeks"]

    widths = {"A": 22, "B": 12, "C": 34, "D": 13, "E": 13, "F": 12, "G": 12, "H": 30, "I": 4, "J": 1.6,
              "K": 34, "L": 2}
    for k, v in widths.items():
        ws.column_dimensions[k].width = v

    ws["A2"] = "미래에셋자산운용"
    ws["A2"].font = F_ORG
    ws["C2"] = (f"ETF Flow Weekly · 작성 {payload['generated_at_display']} · "
                f"미국 이번주 {w[0]['label']} (지난주 {w[1]['label']}) · 국내 {kr['week']['label']}")
    ws["C2"].font = F_NOTE

    # ── 1. 자산군별 주간 순유입 ───────────────────────────────────────────────
    r = 4
    _title(ws, r, "1. 자산군별 주간 순유입", ["미국 상장 ETF 기준", "자산군별 정의는 증권사 재량",
                                         "자산군 = ETF CHECK 대분류(가상자산>원자재>채권·단기자금>주식·리츠)",
                                         "전체 = 미국 상장 ETF 전체(기타·멀티에셋 포함)"])
    ws.cell(row=r + 1, column=1, value="단위 $B").font = F_NOTE
    a = us["asset"]
    _header(ws, r + 2, 1, ["구분", *a["labels"], "기간"])
    for i, (lab, vals, wk) in enumerate([("이번주", a["this"], w[0]), ("지난주", a["last"], w[1])]):
        rr = r + 3 + i
        _cell(ws, rr, 1, lab, font=F_BOLD, fill=FILL_SUB, align=CENTER)
        for j, v in enumerate(vals):
            _cell(ws, rr, 2 + j, round(v, 4), fmt=FMT_B, align=RIGHT)
        _cell(ws, rr, 2 + len(vals), wk["label"], font=F_NOTE, align=CENTER)
    ch = _bar("자산군별 주간 순유입 ($B)", labels=True, height=7.0)
    data = Reference(ws, min_col=1, max_col=1 + len(a["labels"]), min_row=r + 3, max_row=r + 4)
    ch.add_data(data, from_rows=True, titles_from_data=True)
    ch.set_categories(Reference(ws, min_col=2, max_col=1 + len(a["labels"]), min_row=r + 2))
    ws.add_chart(_finish(ch), f"M{r}")

    # ── 2. 테마별 주간 순유입 (4주) ───────────────────────────────────────────
    r = 20
    _title(ws, r, "2. 테마별 주간 순유입 (4주 씩)", ["미국 상장 ETF 기준", "테마내 ETF 정의는 증권사 재량",
                                               "레버리지·인버스 제외, ETF CHECK 소분류 조합",
                                               "대표 ETF = 테마 내 AUM 상위"])
    weeks_old_new = [x["label"] for x in w[::-1]]
    _header(ws, r + 1, 1, ["단위 $B", *weeks_old_new, "4주 합계", "대표 ETF"])
    ws.merge_cells(start_row=r + 1, start_column=7, end_row=r + 1, end_column=8)
    for i, t in enumerate(us["themes"]):
        rr = r + 2 + i
        _cell(ws, rr, 1, t["name"], font=F_BOLD, fill=FILL_SUB, align=LEFT)
        for j, v in enumerate(t["weekly"]):
            _cell(ws, rr, 2 + j, round(v, 4), fmt=FMT_B, align=RIGHT)
        _cell(ws, rr, 2 + len(t["weekly"]), round(t["total"], 4), fmt=FMT_B, align=RIGHT, font=F_BOLD)
        _cell(ws, rr, 7, ", ".join(t["top"][:4]), font=F_NOTE, align=LEFT)
        _cell(ws, rr, 8, None)
        ws.merge_cells(start_row=rr, start_column=7, end_row=rr, end_column=8)
    n_t = len(us["themes"])
    ch = _bar("테마별 주간 순유입 4주 ($B)", colors=WEEK_COLORS, height=9.0, gap=80)
    ch.add_data(Reference(ws, min_col=2, max_col=1 + len(weeks_old_new), min_row=r + 1, max_row=r + 1 + n_t),
                titles_from_data=True)
    ch.set_categories(Reference(ws, min_col=1, min_row=r + 2, max_row=r + 1 + n_t))
    ws.add_chart(_finish(ch), f"M{r}")

    # ── 3. 미국 상장 ETF 주간 유출입 Top 10 ────────────────────────────────────
    r = 39
    _title(ws, r, "3. 해외ETF 주간 유출입 Top 10 (미국 상장 ETF 기준)",
           ["미국 상장 ETF", "유입 10개, 유출 10개", "국내 유사 ETF는 있는 경우.. TIGER면 좀 더 선호",
            f"주간 = {w[0]['label']} · 4주 누적 = {w[-1]['label'].split('~')[0]}~{w[0]['label'].split('~')[1]}",
            "AUM대비 = 주간순유입 / 최근 AUM"])
    _header(ws, r + 1, 1, ["구분", "티커", "ETF", "자산군", "주간순유입($B)", "AUM대비", "4주 누적($B)",
                           "국내 유사 ETF"])
    for blk, (lab, rows) in enumerate([("유입", us["top_in"]), ("유출", us["top_out"])]):
        for i, x in enumerate(rows):
            rr = r + 2 + blk * 10 + i
            _cell(ws, rr, 1, lab if i == 0 else None, font=F_BOLD, fill=FILL_SUB, align=CENTER)
            _cell(ws, rr, 2, x["ticker"], font=F_BOLD, align=CENTER)
            _cell(ws, rr, 3, x["name"], align=LEFT)
            _cell(ws, rr, 4, x["asset_class"], align=CENTER)
            _cell(ws, rr, 5, round(x["flow_w"], 4), fmt=FMT_B, align=RIGHT)
            _cell(ws, rr, 6, None if x["flow_aum_pct"] is None else round(x["flow_aum_pct"], 3),
                  fmt=FMT_PCT, align=RIGHT)
            _cell(ws, rr, 7, round(x["flow_4w"], 4), fmt=FMT_B, align=RIGHT)
            _cell(ws, rr, 8, x["kr_similar"] or "-", align=LEFT)
        ws.merge_cells(start_row=r + 2 + blk * 10, start_column=1, end_row=r + 11 + blk * 10, end_column=1)
    ch = _bar("주간 유출입 Top 10 ($B)", horizontal=True, colors=[NAVY], height=11.0, gap=40)
    ch.add_data(Reference(ws, min_col=5, min_row=r + 1, max_row=r + 21), titles_from_data=True)
    ch.set_categories(Reference(ws, min_col=2, min_row=r + 2, max_row=r + 21))
    ch.x_axis.scaling.orientation = "maxMin"
    ch.legend = None
    s = _finish(ch).series[0]
    s.invertIfNegative = False
    ws.add_chart(ch, f"M{r}")

    # ── 4. 국내 상장 해외 ETF 투자자별 수급 ───────────────────────────────────
    r = 62
    _title(ws, r, "4. 국내 상장 해외 ETF 투자자별 수급 (단위 억원)",
           ["국내 상장 해외 ETF 기준", f"기간 {kr['week']['label']} ({kr['week'].get('days', 5)}거래일, 미국 이번주와 같은 구간)",
            "금액 = 일별 투자자 순매수 수량 × 종가 (추정)", "기관 = 금융투자·연기금 등 합계"])
    _header(ws, r + 1, 1, ["구분", *[g for g in kr["groups"]], "합계"])
    labels = [("개인", "indiv"), ("기관", "inst"), ("외국인", "foreign")]
    for i, (lab, key) in enumerate(labels):
        rr = r + 2 + i
        _cell(ws, rr, 1, lab, font=F_BOLD, fill=FILL_SUB, align=CENTER)
        vals = [kr["groups"][g][key] for g in kr["groups"]]
        for j, v in enumerate(vals):
            _cell(ws, rr, 2 + j, round(v, 1), fmt=FMT_EOK, align=RIGHT)
        _cell(ws, rr, 2 + len(vals), round(sum(vals), 1), fmt=FMT_EOK, align=RIGHT, font=F_BOLD)
    ch = _bar("국내 상장 해외 ETF 투자자별 순매수 (억원)", y_fmt="#,##0", height=7.0)
    ch.add_data(Reference(ws, min_col=1, max_col=5, min_row=r + 2, max_row=r + 4), from_rows=True,
                titles_from_data=True)
    ch.set_categories(Reference(ws, min_col=2, max_col=5, min_row=r + 1))
    ws.add_chart(_finish(ch), f"M{r}")

    # ── 5. 개인 순매수/순매도 Top 20 ─────────────────────────────────────────
    r = 79
    _title(ws, r, "5. 국내 상장 ETF 개인 순매수 유출입 Top 20  (단위 억원)",
           ["국내 상장 해외 ETF 기준", "개인순매수 상위 20종목", "개인순매도 상위 20종목",
            f"기간 {kr['week']['label']} · 금액 = 순매수 수량 × 종가(추정)"])
    _header(ws, r + 1, 1, ["구분", "ETF명", "순매수매도금액", "분류", "순자산(억원)"])
    ws.merge_cells(start_row=r + 1, start_column=2, end_row=r + 1, end_column=2)
    for blk, (lab, rows) in enumerate([("개인순매수", kr["indiv_buy"]), ("개인순매도", kr["indiv_sell"])]):
        for i, x in enumerate(rows):
            rr = r + 2 + blk * 20 + i
            _cell(ws, rr, 1, lab if i == 0 else None, font=F_BOLD, fill=FILL_SUB, align=CENTER)
            _cell(ws, rr, 2, x["name"], align=LEFT)
            _cell(ws, rr, 3, round(x["indiv"], 1), fmt=FMT_EOK, align=RIGHT)
            _cell(ws, rr, 4, x["group"], font=F_NOTE, align=CENTER)
            _cell(ws, rr, 5, round(x["aum_eok"]), fmt=FMT_EOK, align=RIGHT, font=F_NOTE)
        ws.merge_cells(start_row=r + 2 + blk * 20, start_column=1, end_row=r + 21 + blk * 20, end_column=1)
    for blk, (ttl, color) in enumerate([("개인 순매수 Top 20 (억원)", NAVY), ("개인 순매도 Top 20 (억원)", GRAY)]):
        ch = _bar(ttl, horizontal=True, colors=[color], y_fmt="#,##0", height=10.0, gap=40)
        ch.add_data(Reference(ws, min_col=3, min_row=r + 2 + blk * 20, max_row=r + 21 + blk * 20))
        ch.set_categories(Reference(ws, min_col=2, min_row=r + 2 + blk * 20, max_row=r + 21 + blk * 20))
        ch.x_axis.scaling.orientation = "maxMin"
        ch.legend = None
        _finish(ch).series[0].invertIfNegative = False
        ws.add_chart(ch, f"M{r + blk * 20}")

    # ── 6. 차주 주요 이벤트 ──────────────────────────────────────────────────
    r = 122
    s_, e_ = ev["start"], ev["end"]
    _title(ws, r, "6. 차주 주요 이벤트", ["주요 매크로, 기업 이벤트 ", "4~5가지", "매크로 = TradingView 고중요도",
                                       "기업 = Nasdaq 실적캘린더 시총 상위"])
    ws.cell(row=r + 1, column=1, value=f"기간 {s_[5:].replace('-', '/')} ~ {e_[5:].replace('-', '/')}").font = F_NOTE
    _header(ws, r + 2, 1, ["일자", "구분", "이벤트", "비고"])
    ws.merge_cells(start_row=r + 2, start_column=4, end_row=r + 2, end_column=8)
    for i, p in enumerate(ev["picks"]):
        rr = r + 3 + i
        _cell(ws, rr, 1, p["day"], font=F_BOLD, fill=FILL_SUB, align=CENTER)
        _cell(ws, rr, 2, p["category"], align=CENTER)
        _cell(ws, rr, 3, p["event"], align=LEFT)
        _cell(ws, rr, 4, p["detail"], font=F_NOTE, align=LEFT)
        for cc in range(5, 9):
            _cell(ws, rr, cc, None)
        ws.merge_cells(start_row=rr, start_column=4, end_row=rr, end_column=8)

    srow = r + 4 + len(ev["picks"])
    ws.cell(row=srow, column=1, value="출처 · 방법").font = F_BOLD
    for i, t in enumerate([*payload["sources"], *payload["method"]]):
        ws.cell(row=srow + 1 + i, column=1, value=f"· {t}").font = F_NOTE

    _raw_sheet(wb, payload)
    path.parent.mkdir(parents=True, exist_ok=True)
    wb.save(path)
    return path


def _raw_sheet(wb: Workbook, payload: dict[str, Any]) -> None:
    ws = wb.create_sheet("Raw Data")
    ws.freeze_panes = "A4"
    us, kr, ev = payload["us"], payload["kr"], payload["events"]
    wl = [x["label"] for x in us["weeks"]]

    # 미국 (A~L)
    ws["A1"] = f"[미국 상장 ETF] 주간 순유입 전체 ({us['universe_count']:,}개, 단위 $B, 이번주 순유입 내림차순)"
    ws["A1"].font = F_BOLD
    ws["A2"] = "출처: ETF CHECK(코스콤) 글로벌 ETF 일별 순유입 · AUM(최근일) · 분류"
    ws["A2"].font = F_NOTE
    heads = ["티커", "ETF", "자산군", "테마", "레버리지/인버스", "AUM($B)",
             *[f"{'이번주' if i == 0 else f'W-{i}'} {lab}" for i, lab in enumerate(wl)], "4주 누적", "AUM대비(%)", "주간값 산출"]
    _header(ws, 3, 1, heads)
    for i, x in enumerate(payload["raw_us"]):
        rr = 4 + i
        vals = [x["ticker"], x["name"], x["asset_class"], x["themes"], "Y" if x["leveraged"] else "",
                round(x["aum_b"], 4), *[round(v, 5) for v in x["weekly_b"]], round(x["flow_4w_b"], 5),
                round(x["weekly_b"][0] / x["aum_b"] * 100, 3) if x["aum_b"] > 0 else None,
                "구간추정" if x.get("estimated") else "일별합"]
        for j, v in enumerate(vals):
            c = ws.cell(row=rr, column=1 + j, value=v)
            c.font = F_BASE
            if j == 5 or 6 <= j < 6 + len(wl) + 1:
                c.number_format = FMT_B if j >= 6 else '#,##0.00'
            elif j == len(vals) - 2:
                c.number_format = FMT_PCT
    for col, wd in zip("ABCDEFGHIJKLM", [9, 40, 10, 22, 8, 10, 13, 13, 13, 13, 11, 10, 10]):
        ws.column_dimensions[col].width = wd
    ws.auto_filter.ref = f"A3:{get_column_letter(len(heads))}{3 + len(payload['raw_us'])}"

    # 국내 (O~U)
    c0 = 15
    ws.cell(row=1, column=c0, value=f"[국내 상장 해외 ETF] 투자자별 순매수 ({kr['universe_count']}개, 단위 억원, "
                                    f"{kr['week']['label']})").font = F_BOLD
    ws.cell(row=2, column=c0, value="출처: 네이버 금융 — 일별 투자자 순매수 수량 × 종가 합계(추정)").font = F_NOTE
    _header(ws, 3, c0, ["코드", "ETF명", "분류", "순자산(억원)", "개인", "기관", "외국인"])
    for i, x in enumerate(sorted(kr["rows"], key=lambda x: -x["indiv"])):
        rr = 4 + i
        for j, v in enumerate([x["code"], x["name"], x["group"], round(x["aum_eok"]),
                               round(x["indiv"], 2), round(x["inst"], 2), round(x["foreign"], 2)]):
            c = ws.cell(row=rr, column=c0 + j, value=v)
            c.font = F_BASE
            if j >= 3:
                c.number_format = FMT_EOK if j == 3 else '#,##0.0;[Blue]-#,##0.0'
    for k, wd in enumerate([9, 40, 13, 11, 10, 10, 10]):
        ws.column_dimensions[get_column_letter(c0 + k)].width = wd

    # 테마 구성 · 이벤트 (W~)
    c1 = c0 + 8
    ws.cell(row=1, column=c1, value="[테마별 주간 순유입] 단위 $B").font = F_BOLD
    _header(ws, 3, c1, ["테마", *[x["label"] for x in us["weeks"][::-1]], "4주 합계", "ETF 수", "AUM 상위"])
    for i, t in enumerate(us["themes"]):
        for j, v in enumerate([t["name"], *[round(x, 4) for x in t["weekly"]], round(t["total"], 4),
                               t["count"], ", ".join(t["top"])]):
            c = ws.cell(row=4 + i, column=c1 + j, value=v)
            c.font = F_BASE
            if 1 <= j <= 5:
                c.number_format = FMT_B
    er = 4 + len(us["themes"]) + 2
    ws.cell(row=er, column=c1, value=f"[차주 경제지표] {ev['start']} ~ {ev['end']} (KST)").font = F_BOLD
    _header(ws, er + 1, c1, ["일자", "시각", "국가", "지표", "예상", "이전"])
    for i, m in enumerate(sorted(ev["macro"], key=lambda m: (m["date"], m["time_kst"]))):
        for j, v in enumerate([m["date"], m["time_kst"], m["country"], m["label"], m["forecast"], m["previous"]]):
            ws.cell(row=er + 2 + i, column=c1 + j, value=v).font = F_BASE
    er2 = er + 3 + len(ev["macro"])
    ws.cell(row=er2, column=c1, value="[차주 실적발표] 시가총액 상위").font = F_BOLD
    _header(ws, er2 + 1, c1, ["일자", "티커", "기업", "시총($B)", "시점"])
    for i, x in enumerate(ev["earnings"]):
        for j, v in enumerate([x["date"], x["symbol"], x["name"], round(x["cap"] / 1e9, 1),
                               {"time-pre-market": "장전", "time-after-hours": "장후"}.get(x["time"], "")]):
            ws.cell(row=er2 + 2 + i, column=c1 + j, value=v).font = F_BASE
    for k, wd in enumerate([20, 11, 11, 11, 11, 10, 8, 30]):
        ws.column_dimensions[get_column_letter(c1 + k)].width = max(wd, ws.column_dimensions[get_column_letter(c1 + k)].width or 0)
