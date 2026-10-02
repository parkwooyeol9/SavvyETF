"use client";

import { useMemo, type ReactNode } from "react";

import {
  ddayFrom,
  fmt,
  heatStyle,
  isDeleted,
  isNum,
  type AcwiBreadthRow,
  type AcwiNumKey,
  type AcwiStock,
  type AcwiSummary,
} from "@/lib/acwiAnalyzer";

import AcwiChart from "./AcwiChart";
import AcwiTable, { type Col } from "./AcwiTable";
import { Card, Sg } from "./parts";

type H = (r: AcwiBreadthRow) => number | null;
const num = (k: string): H => (r) => (isNum(r[k]) ? (r[k] as number) : null);

function breadthCols(label: string): Col<AcwiBreadthRow>[] {
  const c = (k: string, h: string, d: number, suf: string, lo?: number, hi?: number, inv = false, t?: string): Col<AcwiBreadthRow> => ({
    k,
    h,
    n: true,
    t,
    f: (r) => fmt(num(k)(r), d, suf),
    heat: lo === undefined || hi === undefined ? undefined : (r) => heatStyle(num(k)(r), lo, hi, inv),
  });
  return [
    { k: "g", h: label, f: (r) => String(r.g) },
    { k: "n", h: "종목", n: true, f: (r) => String(r.n ?? "") },
    c("rev_breadth_3m", "리비전 3M", 0, "", -60, 60, false, "EPS NTM 3개월 상향 비율 − 하향 비율"),
    c("eps_rev_3m_med", "EPS Δ3M", 1, "%", -8, 8, false, "EPS NTM 3개월 변화율 중앙값"),
    c("above_ma200", "MA200↑", 0, "%", 0, 100, false, "200일선 위 종목 비율"),
    c("golden", "골든", 0, "%", 0, 100, false, "50일선 > 200일선 비율"),
    c("r_1m_med", "1M", 1, "%", -10, 10),
    c("r_3m_med", "3M", 1, "%", -15, 15),
    c("r_12m_med", "12M", 1, "%", -30, 30),
    c("rsi_med", "RSI", 0, "", 30, 70),
    c("pe_med", "PER", 1, ""),
    c("pe_pct_3y_med", "PER 3Y위치", 0, "", 0, 100, true, "3년 근사 PER 분포 내 현재 백분위(중앙값). 낮을수록 역사적 저평가"),
    c("dy_med", "배당", 2, "%"),
  ];
}

function BreadthTable({ rows, label, limit = 60 }: { rows: AcwiBreadthRow[]; label: string; limit?: number }) {
  const cols = useMemo(() => breadthCols(label), [label]);
  return (
    <div className="aa-scroll aa-short">
      <AcwiTable className="aa-tbl" cols={cols} rows={rows} sort="n" limit={limit} rowKey={(r) => String(r.g)} />
    </div>
  );
}

function IdeaList({ title, sub, rows, cells, onPick }: { title: string; sub: string; rows: AcwiStock[]; cells: ((s: AcwiStock) => ReactNode)[]; onPick: (c: string) => void }) {
  return (
    <Card title={title} sub={sub}>
      <table className="aa-tbl aa-mini">
        <tbody>
          {rows.length ? (
            rows.slice(0, 10).map((s) => (
              <tr key={s.c} className="aa-click" tabIndex={0} onClick={() => onPick(s.c)} onKeyDown={(e) => e.key === "Enter" && onPick(s.c)}>
                <td className="aa-name">
                  {s.n}
                  <small>
                    {s.c} · {s.ct}
                  </small>
                </td>
                {cells.map((c, i) => (
                  <td key={i} className="n">
                    {c(s)}
                  </td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td className="meta-soft">해당 없음</td>
            </tr>
          )}
        </tbody>
      </table>
    </Card>
  );
}

export default function AcwiMarket({ A, onPick }: { A: AcwiSummary; onPick: (code: string) => void }) {
  const M = A.meta;
  const lists = useMemo(() => {
    const all = A.stocks.filter((s) => !s.xr && !s.susp && !isDeleted(s));
    const by = (fn: (s: AcwiStock) => boolean, k: AcwiNumKey, desc = true) =>
      all.filter(fn).sort((a, b) => (desc ? (b[k] ?? 0) - (a[k] ?? 0) : (a[k] ?? 0) - (b[k] ?? 0)));
    const ok3 = (s: AcwiStock) => isNum(s.er3) && Math.abs(s.er3) <= 150;
    return {
      revTrend: by((s) => (s.ts ?? 0) >= 5 && ok3(s), "er3"),
      lowPe: by((s) => isNum(s.pep) && s.pep <= 20 && ok3(s) && (s.er3 ?? 0) > 0, "er3"),
      high52: by((s) => isNum(s.dd52) && s.dd52 > -3 && isNum(s.mom), "mom"),
      oversold: by((s) => isNum(s.rsi) && s.rsi < 30 && ok3(s) && (s.er3 ?? 0) > 0, "er3"),
      dividend: by((s) => (s.dy ?? 0) >= 3 && s.cuts === 0 && isNum(s.dg12) && s.dg12 <= 150, "dg12"),
      revDown: by((s) => ok3(s) && (s.w ?? 0) >= 0.0005, "er3", false),
    };
  }, [A.stocks]);

  return (
    <div className="aa-view">
      <div className="aa-grid aa-g2">
        <Card title="벤치마크 (유니버스 ACWI 비중가중, 현지통화 총수익)" sub="주간, 마지막 값 = 1,000. ACWI 공식 지수가 아닌 이 파일 종목·비중으로 만든 근사치">
          <AcwiChart
            x={A.series.weeks}
            series={[{ y: A.series.bench, color: "var(--accent)", name: "벤치마크" }]}
            yfmt={(v) => fmt(v, 0)}
            xfmt={(v) => String(v).slice(2, 7)}
          />
        </Card>
        <Card title="지역별 브레드스" sub="리비전 = EPS NTM 3개월 상향−하향 비율(%p). 열 제목을 누르면 정렬">
          <BreadthTable rows={A.breadth.region} label="지역" />
          <h3 className="aa-h aa-mt">MSCI 리뷰 일정</h3>
          <p className="aa-sub">MSCI 공지(ir_dates) 기준</p>
          <table className="aa-tbl aa-mini">
            <tbody>
              {(M.next_reviews ?? []).slice(0, 4).map((r) => (
                <tr key={r.review}>
                  <td>{r.review}</td>
                  <td className="n">발표 {r.announce}</td>
                  <td className="n">효력 {r.effective}</td>
                  <td className="n meta-soft">D-{ddayFrom(M.as_of, r.announce)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
      <Card title="섹터별 브레드스" sub="기술적(이동평균·RSI)과 이익 추정치 흐름을 한 표에서 비교">
        <BreadthTable rows={A.breadth.sector} label="섹터" />
      </Card>
      <Card title="국가별 브레드스" sub="종목 수 많은 순">
        <BreadthTable rows={A.breadth.country} label="국가" />
      </Card>
      <h3 className="aa-h aa-mt">
        아이디어 리스트 <span className="meta-soft">(편출 확정·거래정지 제외, 변화율 ±150% 초과 극단치 제외, 클릭하면 상세)</span>
      </h3>
      <div className="aa-lists">
        <IdeaList
          title="리비전 상향 + 추세 강세"
          sub="EPS 3M 리비전 상위 중 기술적 점수 ≥5"
          rows={lists.revTrend}
          onPick={onPick}
          cells={[(s) => <Sg v={s.er3} />, (s) => <span className="aa-badge aa-b-on">{s.ts}/6</span>]}
        />
        <IdeaList
          title="역사적 저PER + 리비전 상향"
          sub="근사 PER 3년 하위 20% & EPS 3M 리비전 > 0"
          rows={lists.lowPe}
          onPick={onPick}
          cells={[(s) => `PER ${fmt(s.pe, 1)}`, (s) => <Sg v={s.er3} />]}
        />
        <IdeaList
          title="52주 고점 근접 + 모멘텀"
          sub="고점 대비 −3% 이내, 12-1M 수익률 순"
          rows={lists.high52}
          onPick={onPick}
          cells={[(s) => <Sg v={s.mom} d={0} />, (s) => <Sg v={s.dd52} />]}
        />
        <IdeaList
          title="과매도 + 펀더멘털 양호"
          sub="RSI < 30 & EPS 3M 리비전 > 0, 리비전 순"
          rows={lists.oversold}
          onPick={onPick}
          cells={[(s) => `RSI ${fmt(s.rsi, 0)}`, (s) => <Sg v={s.er3} />]}
        />
        <IdeaList
          title="배당 안정 + 성장"
          sub="배당 ≥3%, 36개월 DPS 삭감 0회, DPS 12M 성장 순"
          rows={lists.dividend}
          onPick={onPick}
          cells={[(s) => fmt(s.dy, 1, "%"), (s) => <Sg v={s.dg12} />]}
        />
        <IdeaList
          title="리비전 하향 경고"
          sub="EPS 3M 리비전 하위 (대형주 비중 0.05% 이상)"
          rows={lists.revDown}
          onPick={onPick}
          cells={[(s) => <Sg v={s.er3} />, (s) => <Sg v={s.r3m} />]}
        />
      </div>
    </div>
  );
}
