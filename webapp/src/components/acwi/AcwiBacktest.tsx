"use client";

import { useMemo, useState } from "react";

import {
  fmt,
  heatStyle,
  isNum,
  type AcwiBacktest as Bt,
  type BtMode,
  type BtPerf,
  type BtRegionResult,
  type BtSignalResult,
} from "@/lib/acwiAnalyzer";

import AcwiChart from "./AcwiChart";
import AcwiTable, { type Col } from "./AcwiTable";
import { Card, Kpi, Legend, Sg } from "./parts";

/**
 * 10년 팩터 백테스트 (Claude_DB/factor/backtest.py).
 * 월간 리밸런싱 · 5분위 동일가중 · 현지통화 총수익. 유니버스는 MSCI 편출입 이력(PIT)으로 그 달 구성종목만.
 * 거래비용은 화면에서 근사 차감: Q1 = 2 × 회전율 × 비용, 롱숏 = 4 × 회전율 × 비용 (Q5 회전율 ≈ Q1 가정).
 */

const MODES: [BtMode, string, string][] = [
  ["pit", "편출입 반영 (PIT)", "그 달 ACWI 구성종목만 — 편입 전·편출 후 제외"],
  ["pit_large", "PIT 대형·중형", "PIT 중 지역별 시총 상위 50% — 편출 누락(생존 편향)이 적은 비교군"],
  ["static", "현재 구성 고정", "지금 종목을 과거에도 그대로 — 편입 look-ahead 포함 (비교용)"],
];
const COSTS = [0, 20, 50];
const Q_COLORS = ["var(--aa-pos)", "color-mix(in srgb, var(--aa-pos) 55%, var(--muted))", "var(--muted)", "color-mix(in srgb, var(--aa-neg) 55%, var(--muted))", "var(--aa-neg)"];

type Series = (number | null)[];

/** 월간 수익률(소수) → 성과 지표 (backtest.py stats 와 같은 정의, 연환산 %). */
export function perf(r: Series, bench?: Series): BtPerf {
  const idx = r.map((_, i) => i).filter((i) => isNum(r[i]));
  if (idx.length < 12) return {};
  const rr = idx.map((i) => r[i] as number);
  let lvl = 1;
  let peak = 1;
  let mdd = 0;
  for (const x of rr) {
    lvl *= 1 + x;
    peak = Math.max(peak, lvl);
    mdd = Math.min(mdd, lvl / peak - 1);
  }
  const yrs = rr.length / 12;
  const mean = rr.reduce((a, b) => a + b, 0) / rr.length;
  const sd = Math.sqrt(rr.reduce((a, b) => a + (b - mean) ** 2, 0) / (rr.length - 1));
  const out: BtPerf = {
    cagr: (lvl ** (1 / yrs) - 1) * 100,
    vol: sd * Math.sqrt(12) * 100,
    mdd: mdd * 100,
    hit: (rr.filter((x) => x > 0).length / rr.length) * 100,
    months: rr.length,
  };
  out.sharpe = out.vol ? (out.cagr as number) / out.vol : undefined;
  if (bench) {
    const ex = idx.filter((i) => isNum(bench[i])).map((i) => (r[i] as number) - (bench[i] as number));
    if (ex.length >= 12) {
      const em = ex.reduce((a, b) => a + b, 0) / ex.length;
      const es = Math.sqrt(ex.reduce((a, b) => a + (b - em) ** 2, 0) / (ex.length - 1));
      out.excess = em * 12 * 100;
      out.te = es * Math.sqrt(12) * 100;
      out.ir = out.te ? out.excess / out.te : undefined;
      out.hit_vs_bench = (ex.filter((x) => x > 0).length / ex.length) * 100;
    }
  }
  return out;
}

const cum = (r: Series) => {
  let lvl = 1;
  return r.map((v) => {
    if (isNum(v)) lvl *= 1 + v;
    return lvl;
  });
};

function netOf(r: Series, to: Series, legs: number, bp: number): Series {
  if (!bp) return r;
  return r.map((v, i) => (isNum(v) ? v - legs * (isNum(to[i]) ? (to[i] as number) : 0) * (bp / 1e4) : null));
}

function rolling(a: Series, n: number): Series {
  return a.map((_, i) => {
    if (i < n - 1) return null;
    const w = a.slice(i - n + 1, i + 1).filter(isNum) as number[];
    return w.length >= n * 0.75 ? w.reduce((x, y) => x + y, 0) / w.length : null;
  });
}

type CmpRow = { key: string; label: string; kind: string } & Record<string, number | string | undefined>;

export default function AcwiBacktest({ B }: { B: Bt }) {
  const [mode, setMode] = useState<BtMode>("pit");
  const [region, setRegion] = useState("전체");
  const [sig, setSig] = useState("composite");
  const [cost, setCost] = useState(20);
  const [chart, setChart] = useState<"q" | "ls" | "q1">("q");

  const R: BtRegionResult | undefined = B.results[mode]?.[region];
  const S: BtSignalResult | undefined = R?.sig[sig];
  const label = (k: string) => B.signals.find((x) => x.key === k)?.label ?? k;
  const dates = B.dates;

  const view = useMemo(() => {
    if (!R || !S) return null;
    const q1n = netOf(S.q[0], S.to, 2, cost);
    const lsn = netOf(S.ls, S.to, 4, cost);
    return {
      q1n,
      lsn,
      pq: S.q.map((q, i) => perf(i === 0 ? q1n : q, R.bench_ew)),
      pls: perf(lsn),
      pb: perf(R.bench_ew),
      pcw: perf(R.bench_cw),
      cumQ: S.q.map((q, i) => cum(i === 0 ? q1n : q)),
      cumB: cum(R.bench_ew),
      cumLs: cum(lsn),
      relQ1: cum(q1n.map((v, i) => (isNum(v) && isNum(R.bench_ew[i]) ? v - (R.bench_ew[i] as number) : null))),
      ic12: rolling(S.ic, 12),
    };
  }, [R, S, cost]);

  const cmpRows: CmpRow[] = useMemo(() => {
    if (!R) return [];
    return B.signals
      .filter((x) => R.sig[x.key])
      .map((x) => {
        const r = R.sig[x.key];
        const q1 = perf(netOf(r.q[0], r.to, 2, cost), R.bench_ew);
        const ls = perf(netOf(r.ls, r.to, 4, cost));
        return {
          key: x.key, label: x.label, kind: x.kind,
          q1: q1.cagr, ex: q1.excess, ir: q1.ir, ls: ls.cagr, sh: ls.sharpe, mdd: ls.mdd,
          ic: r.ic_stats?.ic_mean, ict: r.ic_stats?.ic_t, to: isNum(r.to_mean) ? r.to_mean * 100 : undefined, mono: r.spread_mono * 100,
        };
      });
  }, [B.signals, R, cost]);

  const yearly = useMemo(() => {
    if (!R || !S || !view) return [];
    const by = new Map<string, number[]>();
    dates.forEach((d, i) => {
      const y = d.slice(0, 4);
      if (!by.has(y)) by.set(y, []);
      by.get(y)!.push(i);
    });
    const comp = (a: Series, ix: number[]) => {
      const v = ix.map((i) => a[i]).filter(isNum) as number[];
      return v.length ? (v.reduce((p, x) => p * (1 + x), 1) - 1) * 100 : undefined;
    };
    return [...by.entries()].map(([y, ix]) => {
      const q1 = comp(view.q1n, ix);
      const b = comp(R.bench_ew, ix);
      return { y, m: ix.length, q1, b, ex: isNum(q1) && isNum(b) ? q1 - b : undefined, ls: comp(view.lsn, ix), q5: comp(S.q[4], ix) };
    });
  }, [R, S, view, dates]);

  const modeCmp = useMemo(
    () =>
      MODES.map(([m, l]) => {
        const r = B.results[m]?.[region]?.sig[sig];
        const b = B.results[m]?.[region];
        if (!r || !b) return { m, l };
        const ls = perf(netOf(r.ls, r.to, 4, cost));
        const q1 = perf(netOf(r.q[0], r.to, 2, cost), b.bench_ew);
        return { m, l, ls: ls.cagr, sh: ls.sharpe, ex: q1.excess, ict: r.ic_stats?.ic_t, n: b.n.length ? b.n[0] : undefined, n2: b.n.length ? b.n[b.n.length - 1] : undefined };
      }),
    [B.results, region, sig, cost],
  );

  const cmpCols: Col<CmpRow>[] = [
    { k: "label", h: "신호", f: (r) => <>{r.label}{r.kind === "descriptor" ? <small className="meta-soft"> 디스크립터</small> : r.kind === "preset" ? <small className="meta-soft"> 조합</small> : null}</> },
    { k: "q1", h: "Q1 연수익", n: true, f: (r) => fmt(r.q1, 1, "%") },
    { k: "ex", h: "Q1 초과", n: true, t: "Q1 − 유니버스 동일가중 (연환산)", f: (r) => <Sg v={r.ex} />, heat: (r) => heatStyle(r.ex, -6, 6) },
    { k: "ir", h: "IR", n: true, f: (r) => fmt(r.ir, 2), heat: (r) => heatStyle(r.ir, -1, 1) },
    { k: "ls", h: "롱숏 연수익", n: true, t: "Q1 − Q5", f: (r) => <Sg v={r.ls} />, heat: (r) => heatStyle(r.ls, -10, 10) },
    { k: "sh", h: "롱숏 샤프", n: true, f: (r) => fmt(r.sh, 2) },
    { k: "mdd", h: "롱숏 MDD", n: true, f: (r) => fmt(r.mdd, 0, "%") },
    { k: "ic", h: "IC 평균", n: true, t: "월별 스피어만 순위상관 평균", f: (r) => fmt(r.ic, 3) },
    { k: "ict", h: "IC t값", n: true, t: "|t|>2 면 통계적으로 의미 있는 수준", f: (r) => fmt(r.ict, 2), heat: (r) => heatStyle(r.ict, -3, 3) },
    { k: "to", h: "Q1 회전율/월", n: true, f: (r) => fmt(r.to, 0, "%") },
    { k: "mono", h: "단조성", n: true, t: "Q1>Q2>…>Q5 순서가 맞는 비율", f: (r) => fmt(r.mono, 0, "%") },
  ];
  type YRow = (typeof yearly)[number];
  const yCols: Col<YRow>[] = [
    { k: "y", h: "연도", f: (r) => `${r.y}${r.m < 12 ? ` (${r.m}개월)` : ""}` },
    { k: "q1", h: "Q1", n: true, f: (r) => <Sg v={r.q1} /> },
    { k: "b", h: "유니버스(EW)", n: true, f: (r) => <Sg v={r.b} /> },
    { k: "ex", h: "초과", n: true, f: (r) => <Sg v={r.ex} suf="%p" />, heat: (r) => heatStyle(r.ex, -10, 10) },
    { k: "q5", h: "Q5", n: true, f: (r) => <Sg v={r.q5} /> },
    { k: "ls", h: "롱숏", n: true, f: (r) => <Sg v={r.ls} />, heat: (r) => heatStyle(r.ls, -15, 15) },
  ];

  if (!R || !S || !view) return <p className="aa-empty">이 조합의 결과가 없습니다.</p>;
  const P1 = view.pq[0];
  const dx = (v: string | number) => String(v).slice(2, 7);

  return (
    <div className="aa-view">
      <section className="aa-card">
        <div className="aa-bt-ctl">
          <div className="aa-field">
            유니버스
            <div className="aa-seg">
              {MODES.map(([m, l, t]) => (
                <button key={m} type="button" title={t} className={`chip${mode === m ? " active" : ""}`} aria-pressed={mode === m} onClick={() => setMode(m)}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          <div className="aa-field">
            지역
            <div className="aa-seg">
              {B.meta.regions.map((r) => (
                <button key={r} type="button" className={`chip${region === r ? " active" : ""}`} aria-pressed={region === r} onClick={() => setRegion(r)}>
                  {r}
                </button>
              ))}
            </div>
          </div>
          <label className="aa-field">
            신호
            <select className="im-select" value={sig} onChange={(e) => setSig(e.target.value)}>
              {(["preset", "factor", "descriptor"] as const).map((kind) => (
                <optgroup key={kind} label={kind === "preset" ? "조합" : kind === "factor" ? "팩터" : "디스크립터"}>
                  {B.signals
                    .filter((x) => x.kind === kind)
                    .map((x) => (
                      <option key={x.key} value={x.key}>
                        {x.label}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </label>
          <div className="aa-field">
            거래비용 (편도)
            <div className="aa-seg">
              {COSTS.map((c) => (
                <button key={c} type="button" className={`chip${cost === c ? " active" : ""}`} aria-pressed={cost === c} onClick={() => setCost(c)}>
                  {c}bp
                </button>
              ))}
            </div>
          </div>
        </div>
        <p className="aa-sub aa-mt">
          {B.meta.start} ~ {B.meta.end} · {B.meta.n_months}개월 · {B.meta.rebalance} · 5분위 동일가중 · {B.meta.currency}
          {B.meta.lag_months ? ` · 신호 ${B.meta.lag_months}개월 지연` : ""} · 종목 수 {R.n[0] ?? "–"} → {R.n[R.n.length - 1] ?? "–"}
        </p>
        <div className="aa-kpis">
          <Kpi label={`${label(sig)} Q1 연수익`} value={fmt(P1.cagr, 1, "%")} sub={<>유니버스 {fmt(view.pb.cagr, 1, "%")} · 시총가중 {fmt(view.pcw.cagr, 1, "%")}</>} />
          <Kpi label="Q1 초과수익 (연)" value={<Sg v={P1.excess} suf="%p" />} sub={`IR ${fmt(P1.ir, 2)} · 승률 ${fmt(P1.hit_vs_bench, 0, "%")}`} />
          <Kpi label="롱숏 (Q1−Q5) 연수익" value={<Sg v={view.pls.cagr} />} sub={`샤프 ${fmt(view.pls.sharpe, 2)} · MDD ${fmt(view.pls.mdd, 0, "%")}`} />
          <Kpi label="IC 평균 · t값" value={`${fmt(S.ic_stats?.ic_mean, 3)} · ${fmt(S.ic_stats?.ic_t, 2)}`} sub={`ICIR ${fmt(S.ic_stats?.icir, 2)} · IC>0 ${fmt(S.ic_stats?.ic_hit, 0, "%")}`} />
          <Kpi label="Q1 회전율 (월)" value={fmt(isNum(S.to_mean) ? S.to_mean * 100 : null, 0, "%")} sub={`${cost}bp 차감 반영`} />
          <Kpi label="Q1 변동성 · MDD" value={`${fmt(P1.vol, 0, "%")} · ${fmt(P1.mdd, 0, "%")}`} sub={`유니버스 ${fmt(view.pb.vol, 0, "%")} · ${fmt(view.pb.mdd, 0, "%")}`} />
        </div>
      </section>

      <div className="aa-grid aa-g2">
        <Card title="누적 성과" sub="1에서 시작. Q1 은 거래비용 차감 후">
          <div className="aa-seg">
            {(
              [
                ["q", "5분위"],
                ["q1", "Q1 − 유니버스"],
                ["ls", "롱숏"],
              ] as const
            ).map(([k, l]) => (
              <button key={k} type="button" className={`chip${chart === k ? " active" : ""}`} aria-pressed={chart === k} onClick={() => setChart(k)}>
                {l}
              </button>
            ))}
          </div>
          {chart === "q" ? (
            <>
              <AcwiChart
                x={dates}
                series={[
                  ...view.cumQ.map((y, i) => ({ y, color: Q_COLORS[i], name: `Q${i + 1}`, w: i === 0 || i === 4 ? 1.8 : 1.1 })),
                  { y: view.cumB, color: "var(--text)", name: "유니버스", dash: "4 3", w: 1.2 },
                ]}
                h={260}
                yfmt={(v) => fmt(v, 2)}
                xfmt={dx}
              />
              <Legend items={[["var(--aa-pos)", "Q1 (점수 상위)"], ["var(--muted)", "Q3"], ["var(--aa-neg)", "Q5 (하위)"], ["var(--text)", "유니버스 동일가중", true]]} />
            </>
          ) : chart === "q1" ? (
            <AcwiChart x={dates} series={[{ y: view.relQ1, color: "var(--accent)", name: "누적 초과" }]} h={260} yfmt={(v) => fmt(v, 2)} xfmt={dx} refs={[{ y: 1, label: "" }]} />
          ) : (
            <AcwiChart x={dates} series={[{ y: view.cumLs, color: "var(--accent)", name: "롱숏" }]} h={260} yfmt={(v) => fmt(v, 2)} xfmt={dx} refs={[{ y: 1, label: "" }]} />
          )}
        </Card>
        <Card title="분위별 연환산 수익률 · IC 추이" sub="막대 = 분위 연수익 (Q1 비용 차감), 선 = 12개월 이동평균 IC">
          <div className="aa-bars">
            {view.pq.map((p, i) => {
              const all = view.pq.map((x) => x.cagr ?? 0);
              const mx = Math.max(...all.map(Math.abs), 1);
              const v = p.cagr ?? 0;
              return (
                <div key={i} className="aa-bar">
                  <span>Q{i + 1}</span>
                  <div className="aa-track">
                    <div className="aa-fill" style={{ [v >= 0 ? "left" : "right"]: "50%", width: `${(Math.abs(v) / mx) * 50}%`, background: Q_COLORS[i] }} />
                  </div>
                  <span className="aa-mono">{fmt(p.cagr, 1, "%")}</span>
                </div>
              );
            })}
          </div>
          <h4 className="aa-h4">12개월 이동평균 IC</h4>
          <AcwiChart x={dates} series={[{ y: view.ic12, color: "var(--warn)", name: "IC 12M" }]} h={150} yfmt={(v) => fmt(v, 3)} xfmt={dx} zeroLine />
        </Card>
      </div>

      <Card title="신호 비교" sub={`${MODES.find((m) => m[0] === mode)?.[1]} · ${region} · 거래비용 ${cost}bp. 행을 누르면 위 차트가 바뀝니다`}>
        <div className="aa-scroll aa-short">
          <AcwiTable cols={cmpCols} rows={cmpRows} sort="ls" rowKey={(r) => r.key} onRow={(r) => setSig(r.key)} className="aa-tbl" limit={40} />
        </div>
      </Card>

      <div className="aa-grid aa-g2">
        <Card title="유니버스 정의에 따른 차이 (look-ahead 점검)" sub={`같은 신호(${label(sig)})·지역에서 유니버스만 바꿈`}>
          <table className="aa-tbl aa-mini">
            <thead>
              <tr>
                <th>유니버스</th>
                <th className="n">롱숏 연수익</th>
                <th className="n">샤프</th>
                <th className="n">Q1 초과</th>
                <th className="n">IC t</th>
                <th className="n">종목 수(시작→끝)</th>
              </tr>
            </thead>
            <tbody>
              {modeCmp.map((r) => (
                <tr key={r.m}>
                  <td>{r.l}</td>
                  <td className="n"><Sg v={r.ls} /></td>
                  <td className="n">{fmt(r.sh, 2)}</td>
                  <td className="n"><Sg v={r.ex} suf="%p" /></td>
                  <td className="n">{fmt(r.ict, 2)}</td>
                  <td className="n">{r.n ?? "–"} → {r.n2 ?? "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="aa-note aa-mt">
            &lsquo;현재 구성 고정&rsquo;은 지금 ACWI 종목을 10년 전에도 들고 있었다고 가정해 <b>나중에 커서 편입될 종목</b>을 미리 담습니다. 특히 사이즈 팩터가 크게 부풀려집니다.
            PIT 도 2026-02 이전에 편출된 종목은 파일에 없어 생존 편향이 남으므로, 소형주 영향이 적은 &lsquo;PIT 대형·중형&rsquo;과 함께 보세요.
          </p>
        </Card>
        <Card title="연도별 수익률" sub={`${label(sig)} · Q1 은 비용 차감 후`}>
          <div className="aa-scroll aa-short">
            <AcwiTable cols={yCols} rows={yearly} sort={null} rowKey={(r) => r.y} className="aa-tbl" limit={20} />
          </div>
        </Card>
      </div>

      <div className="aa-grid aa-g2">
        <Card title="팩터 롱숏 수익률 상관" sub="PIT · 전체 · 비용 전">
          <div className="aa-scroll aa-short">
            <table className="aa-tbl aa-mini">
              <thead>
                <tr>
                  <th />
                  {B.factor_corr.labels.map((l) => (
                    <th key={l} className="n">{l}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {B.factor_corr.m.map((row, i) => (
                  <tr key={i}>
                    <td>{B.factor_corr.labels[i]}</td>
                    {row.map((v, j) => (
                      <td key={j} className="n" style={i === j ? undefined : heatStyle(v, -0.8, 0.8)}>
                        {fmt(v, 2)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title="유니버스 커버리지" sub="파일 종목 중 그 달 ACWI 구성(PIT) vs 재구성한 실제 구성종목 수(확정)">
          <AcwiChart
            x={B.coverage.map((c) => c.date)}
            series={[
              { y: B.coverage.map((c) => c.members_confirmed), color: "var(--muted)", name: "실제 구성(확정)", dash: "4 3" },
              { y: B.coverage.map((c) => c.n_static), color: "var(--aa-neg)", name: "현재 구성 고정" },
              { y: B.coverage.map((c) => c.n_pit), color: "var(--accent)", name: "PIT" },
              { y: B.coverage.map((c) => c.n_pit_large), color: "var(--aa-c3)", name: "PIT 대형·중형" },
            ]}
            h={200}
            yfmt={(v) => fmt(v, 0)}
            xfmt={dx}
          />
          <Legend items={[["var(--accent)", "PIT"], ["var(--aa-c3)", "PIT 대형·중형"], ["var(--aa-neg)", "현재 구성 고정"], ["var(--muted)", "실제 구성(확정)", true]]} />
        </Card>
      </div>

      <Card title="방법" sub={`빌드 ${B.meta.built_at.replace("T", " ")} · 원자료 ${B.meta.source}`}>
        <ul className="aa-note">
          <li>
            <b>신호</b>: 매월 1일 값으로 계산 → 1/99% 윈저 → 섹터×지역 중립 Z(±3) → 팩터 = 디스크립터 Z 평균 → 다시 중립 Z. 종합 = 팩터 동일가중.
          </li>
          <li>
            <b>디스크립터</b>: 가치 E/P·B/P · 사이즈 −ln 시총 · 배당 배당수익률·DPS 12M 변화 · 성장 EPS·매출 NTM 12M 변화 · 모멘텀 12-1M(국가 상대)·EPS 3M 리비전 · 퀄리티 ROE(EPS/BPS)·−변동성 24M. FCF·D/E 는 과거 시계열이 없어 제외.
          </li>
          <li>
            <b>과거 주가·밸류 복원</b>: 총수익지수에서 배당을 되돌려 주가 상대값을 만들고(파일의 12M 주가변화와 94% 종목이 ±2%p 이내 일치), 지금 USD 주가·추정치로 수준을 맞춤. 추정치 통화와 주가 통화가 다르면 환율 변동만큼 오차.
          </li>
          <li>
            <b>수익률</b>: 다음 달 1일까지 현지통화 총수익. USD 투자자 성과와 다르며, 지역 간 비교 시 통화 효과 주의.
          </li>
          <li>
            <b>한계</b>: 2026-02 이전 편출 종목이 없어 생존 편향 잔존 · 섹터는 현재 분류 · 시총은 주식 수 불변 가정 · 비용은 회전율 기반 근사.
          </li>
        </ul>
      </Card>
    </div>
  );
}
