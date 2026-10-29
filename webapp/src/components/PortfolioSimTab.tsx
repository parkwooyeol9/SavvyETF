"use client";

/**
 * 포트폴리오 › MP — ETF 배분 시뮬레이터.
 * BM(MSCI ACWI·S&P500·나스닥100)을 ETF 바스켓으로 복제하고, 좋게 보는 국가·업종·테마 ETF를 더했을 때
 * 성과·변동성·추적오차가 어떻게 바뀌는지 브라우저에서 바로 계산한다.
 * 데이터: /portfolio-sim/data.json (SavvyDB/Portfolio/4_코드/build_html.py --webapp). 계산: lib/portfolioSim.ts
 */

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer,
  Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from "recharts";

import {
  BM_NAME, PERIODS, PRESETS, active, bmExposure, defaultMethod, f, finalWeights, fitScale, frontier, makeEngine,
  pc, portExposure, riskContrib, run, screen, seriesFor, stressRows, tiltTotal, weightedTER, yearly,
  type BmId, type Ccy, type Engine, type Rebal, type ScreenRow, type SimData, type SimState,
} from "@/lib/portfolioSim";

// ChartFormat 색 순서(파랑 → 회색 → 노랑)를 어두운 배경에서 보이도록 밝힌 값
const C = { blue: "#7b8fd4", gray: "#9aa4b2", yellow: "#e0b23a", grid: "#2b3648", ink: "#e8eef5" };
const AX = { fontSize: 11, fill: "#c3cfdc" };
const tooltipStyle = { background: "#141d2b", border: "1px solid #2b3648", borderRadius: 8, color: "#e8eef5", fontSize: 12 };
const SCEN_KEY = "savvyetf:psim:scen:v1";
const BMS: BmId[] = ["acwi", "spx", "ndx"];

type Scen = { name: string; bm: BmId; method: string; core: Record<string, number>; tilts: { t: string; w: number }[]; scale: number };

function loadScen(): Scen[] {
  try { return JSON.parse(window.localStorage.getItem(SCEN_KEY) || "[]"); } catch { return []; }
}
function saveScen(l: Scen[]): boolean {
  try { window.localStorage.setItem(SCEN_KEY, JSON.stringify(l)); return true; } catch { return false; }
}
function readHash(): Partial<SimState> | null {
  try {
    const h = window.location.hash;
    if (h.startsWith("#psim=")) return JSON.parse(decodeURIComponent(h.slice(6)));
  } catch { /* 깨진 링크는 무시 */ }
  return null;
}
/** 양수 파랑, 음수 노랑 */
function shade(v: number, max: number): string {
  const a = Math.min(1, Math.abs(v) / max) * 0.8;
  return v >= 0 ? `rgba(123,143,212,${a.toFixed(3)})` : `rgba(224,178,58,${a.toFixed(3)})`;
}
const tick = (v: number) => f(v, 0);

export default function PortfolioSimTab() {
  const [eng, setEng] = useState<Engine | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [st, setSt] = useState<SimState | null>(null);

  useEffect(() => {
    let dead = false;
    fetch("/portfolio-sim/data.json")
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d: SimData) => {
        if (dead) return;
        const e = makeEngine(d);
        const h = readHash();
        const bm = (h?.bm && d.core[h.bm] ? h.bm : "acwi") as BmId;
        const method = h?.method && d.core[bm][h.method] ? h.method : defaultMethod(d, bm);
        setEng(e);
        setSt({
          bm, method,
          core: h?.core ? { ...h.core } : { ...d.core[bm][method] },
          tilts: h?.tilts ?? PRESETS["아시아 테크"].map(([t, w]) => ({ t, w })),
          scale: h?.scale ?? 100, per: h?.per ?? "5Y", reb: (h?.reb ?? "Q") as Rebal, ccy: (h?.ccy ?? "USD") as Ccy,
        });
      })
      .catch((x) => !dead && setErr(String(x)));
    return () => { dead = true; };
  }, []);

  if (err) return <p className="empty err">시뮬레이터 데이터를 불러오지 못했습니다 ({err}).</p>;
  if (!eng || !st) return <p className="empty">ETF 가격·BM 구성 불러오는 중… (약 0.7MB)</p>;
  return <Sim eng={eng} st={st} setSt={setSt} />;
}

function Sim({ eng, st, setSt }: { eng: Engine; st: SimState; setSt: (s: SimState) => void }) {
  const d = eng.d;
  const set = (p: Partial<SimState>) => setSt({ ...st, ...p });
  const res = useMemo(() => run(eng, st), [eng, st]);
  const series = useMemo(() => seriesFor(eng, res), [eng, res]);
  const years = useMemo(() => yearly(eng, res), [eng, res]);
  const stress = useMemo(() => stressRows(eng, st, res.W), [eng, st, res]);
  const front = useMemo(() => frontier(eng, st, res), [eng, st, res]);
  const risk = useMemo(() => riskContrib(eng, res.W, res.bmT, res.win, st.ccy), [eng, res, st.ccy]);
  const expo = useMemo(() => {
    const p = portExposure(d, res.W), b = bmExposure(d, st.bm);
    return { c: active(p.country, b.country, 12), s: active(p.sector, b.sector, 13) };
  }, [d, res, st.bm]);

  const [pick, setPick] = useState(d.tilt[0][1]);
  const [teTarget, setTeTarget] = useState(3);
  const [fitMsg, setFitMsg] = useState("");
  const [scName, setScName] = useState("");
  const [scen, setScen] = useState<Scen[]>([]);
  const [note, setNote] = useState("");
  useEffect(() => setScen(loadScen()), []);

  // 공유 링크용 해시 (탭 쿼리는 그대로 두고 #psim= 만 바꿈)
  useEffect(() => {
    try {
      const u = new URL(window.location.href);
      u.hash = "psim=" + encodeURIComponent(JSON.stringify(st));
      window.history.replaceState(window.history.state, "", u.toString());
    } catch { /* noop */ }
  }, [st]);

  const kname = (t: string) => d.meta[t]?.k || (d.meta[t]?.n || t).replace(/^(iShares|SPDR|Invesco|VanEck|Global X|First Trust|ARK|Vanguard)\s*/, "").replace(/ ETF.*$/, "").slice(0, 26);
  const groups = [...new Set(d.tilt.map((r) => r[0]))];
  const T = tiltTotal(st);
  const { P, C: Cc, B, win, bmT } = res;
  const dates = d.dates;

  const switchBm = (bm: BmId) => { const method = defaultMethod(d, bm); set({ bm, method, core: { ...d.core[bm][method] } }); };
  const addTilt = (t: string, w = 5) => {
    const ex = st.tilts.find((x) => x.t === t);
    set({ tilts: ex ? st.tilts.map((x) => (x.t === t ? { ...x, w: x.w + w } : x)) : [...st.tilts, { t, w }] });
  };
  const setTilt = (i: number, w: number) => set({ tilts: st.tilts.map((x, j) => (j === i ? { ...x, w: Math.max(0, w) } : x)) });
  const doFit = () => {
    if (!st.tilts.length) return;
    const r = fitScale(eng, st, res, teTarget / 100);
    if (r.scale == null) { setFitMsg(`코어만으로 TE가 ${pc(r.te0, 2)}%라 목표 ${f(teTarget, 2)}%보다 큽니다. 코어를 단일 ETF로 바꾸거나 목표를 높이세요.`); return; }
    setFitMsg("");
    if (r.scale > 200) set({ tilts: st.tilts.map((x) => ({ ...x, w: Math.round(((x.w * r.scale!) / 100) * 2) / 2 })), scale: 100 });
    else set({ scale: r.scale });
  };
  const exportCSV = () => {
    let s = "﻿구분,ETF,이름,비중(%)\n";
    Object.entries(res.W).sort((a, b) => b[1] - a[1]).forEach(([t, w]) => {
      s += `${st.tilts.some((x) => x.t === t) ? "오버레이" : "코어"},${t},"${(d.meta[t]?.n || "").replace(/"/g, "")}",${w.toFixed(2)}\n`;
    });
    s += `\n지표 (${dates[win.s]}~${dates[win.e]}; ${st.ccy}),포트폴리오,코어,BM\n`;
    for (const k of ["cagr", "vol", "sharpe", "mdd", "beta", "te", "ex", "ir"] as const) s += `${k},${P[k]},${Cc[k]},${B[k]}\n`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([s], { type: "text/csv" }));
    a.download = `portfolio_${st.bm}_${dates[dates.length - 1]}.csv`;
    a.click();
  };

  const coreTot = Object.values(st.core).reduce((a, b) => a + b, 0);
  const coreRows = Object.entries(st.core).sort((a, b) => b[1] - a[1]);
  const riskIdx = risk.tickers.map((_, i) => i).filter((i) => risk.tickers[i] !== bmT || res.W[bmT]).sort((a, b) => risk.tc[b] - risk.tc[a]).slice(0, 14);
  const riskData = riskIdx.map((i) => ({ t: risk.tickers[i], te: risk.tc[i] * 100, vol: risk.vc[i] * 100 }));
  // 삽입 순서는 코어 ETF가 앞이라, 나중에 더한 오버레이가 16개 밖으로 밀린다. 비중 순으로 고르고 BM은 항상 남긴다.
  const corrPick = risk.tickers
    .map((t, i) => ({ t, i, w: t === bmT ? Number.POSITIVE_INFINITY : (res.W[t] || 0) }))
    .sort((a, b) => b.w - a.w)
    .slice(0, 16);

  const kpis: Array<[string, string, string, boolean?]> = [
    ["연환산 초과수익", `${pc(P.ex, 2)}%p`, `포트폴리오 ${pc(P.cagr)}% · BM ${pc(B.cagr)}%`, true],
    ["추적오차", `${pc(P.te, 2)}%`, `코어만 ${pc(Cc.te, 2)}%`],
    ["정보비율", f(P.ir, 2), `코어만 ${f(Cc.ir, 2)}`],
    ["변동성", `${pc(P.vol)}%`, `BM ${pc(B.vol)}%`],
    ["최대낙폭", `${pc(P.mdd)}%`, `BM ${pc(B.mdd)}%`],
    ["베타", f(P.beta, 2), `상관 ${f(P.corr, 2)}`],
    ["샤프", f(P.sharpe, 2), `BM ${f(B.sharpe, 2)}`],
    ["가중 보수", `${f(weightedTER(d, res.W), 3)}%`, `BM ETF ${f(d.meta[bmT]?.ter, 2)}% · 오버레이 ${f(T, 1)}%`],
  ];
  const metRows: Array<[string, keyof typeof P, boolean, number]> = [
    ["누적 수익률(%)", "cum", true, 1], ["연환산 수익률(%)", "cagr", true, 1], ["변동성(%)", "vol", true, 1], ["샤프", "sharpe", false, 2],
    ["최대낙폭(%)", "mdd", true, 1], ["칼마", "calmar", false, 2], ["베타", "beta", false, 2], ["상관계수", "corr", false, 2],
    ["추적오차(%)", "te", true, 2], ["초과수익(연, %p)", "ex", true, 2], ["정보비율", "ir", false, 2],
    ["상승 포착률(%)", "upc", true, 0], ["하락 포착률(%)", "dnc", true, 0],
  ];

  return (
    <div className="psim panel-stack">
      <div className="panel psim-bar">
        <div className="seg">
          {BMS.map((b) => <button key={b} type="button" className={st.bm === b ? "active" : ""} onClick={() => switchBm(b)}>{BM_NAME[b]}</button>)}
        </div>
        <div className="seg">
          {PERIODS.map(([p]) => <button key={p} type="button" className={st.per === p ? "active" : ""} onClick={() => set({ per: p })}>{p}</button>)}
        </div>
        <label className="psim-lab">리밸런싱
          <select value={st.reb} onChange={(e) => set({ reb: e.target.value as Rebal })}>
            <option value="M">매월</option><option value="Q">분기</option><option value="Y">매년</option><option value="N">안 함</option>
          </select>
        </label>
        <div className="seg">
          {(["USD", "KRW"] as Ccy[]).map((c) => <button key={c} type="button" className={st.ccy === c ? "active" : ""} onClick={() => set({ ccy: c })}>{c === "USD" ? "달러" : "원화"}</button>)}
        </div>
        <span className="muted psim-asof">가격 {d.px_asof} 종가 · BM 구성 {d.asof.acwi.slice(0, 10)}</span>
      </div>

      <BmSection d={d} bm={st.bm} />

      <h3 className="psim-h">포트폴리오 구성</h3>
      <div className="psim-grid psim-side">
        <div className="panel">
          <h4>① 코어: BM 복제</h4>
          <div className="psim-ctrl">
            <label className="psim-lab">복제 방식
              <select value={st.method} onChange={(e) => set({ method: e.target.value, core: { ...d.core[st.bm][e.target.value] } })}>
                {Object.keys(d.core[st.bm]).map((m) => <option key={m}>{m}</option>)}
              </select>
            </label>
            <button type="button" className="ghost-btn" onClick={() => set({ core: { ...d.core[st.bm][st.method] } })}>비중 초기화</button>
          </div>
          <div className="table-wrap psim-scroll">
            <table className="data-table psim-num">
              <thead><tr><th>ETF</th><th>이름</th><th>보수(%)</th><th>비중(%)</th></tr></thead>
              <tbody>
                {coreRows.map(([t, w]) => (
                  <tr key={t}>
                    <td><b>{t}</b></td><td className="l">{kname(t)}</td><td>{f(d.meta[t]?.ter, 2)}</td>
                    <td><input type="number" step={0.1} min={0} value={Number(w.toFixed(2))}
                      onChange={(e) => set({ core: { ...st.core, [t]: Math.max(0, +e.target.value || 0) } })} /></td>
                  </tr>
                ))}
                <tr><td className="l" colSpan={3}><b>합계</b></td><td><b>{f(coreTot, 1)}</b></td></tr>
              </tbody>
            </table>
          </div>
          <p className="psim-note">{Math.abs(coreTot - 100) > 0.05 ? `합계가 ${f(coreTot, 1)}%입니다. 계산은 100%로 비례 환산합니다.` : `${coreRows.length}개 ETF. 비중은 ${d.asof[st.bm]} BM 구성 기준.`}</p>
        </div>

        <div className="panel">
          <h4>② 오버레이: 좋게 보는 국가 · 업종 · 테마</h4>
          <div className="psim-ctrl">
            <select value={pick} onChange={(e) => setPick(e.target.value)}>
              {groups.map((g) => (
                <optgroup key={g} label={g}>
                  {d.tilt.filter((r) => r[0] === g).map((r) => <option key={r[1]} value={r[1]}>{r[1]} · {r[2]}</option>)}
                </optgroup>
              ))}
            </select>
            <button type="button" className="ghost-btn psim-primary" onClick={() => addTilt(pick)}>추가</button>
            <select value="" onChange={(e) => { const p = PRESETS[e.target.value]; if (p) set({ tilts: p.map(([t, w]) => ({ t, w })), scale: 100 }); }}>
              <option value="">예시 선택</option>
              {Object.keys(PRESETS).map((k) => <option key={k}>{k}</option>)}
            </select>
            <button type="button" className="ghost-btn" onClick={() => set({ tilts: [] })}>비우기</button>
          </div>
          <div className="psim-tilts">
            {st.tilts.length ? st.tilts.map((x, i) => (
              <div key={x.t} className="psim-tilt">
                <div><span className="psim-pill">{d.tilt.find((r) => r[1] === x.t)?.[0]}</span><b>{x.t}</b> {kname(x.t)}
                  <span className="muted"> 보수 {f(d.meta[x.t]?.ter, 2)}% · 상장 {d.px[x.t]?.start.slice(0, 7)}</span></div>
                <input type="range" min={0} max={30} step={0.5} value={x.w} onChange={(e) => setTilt(i, +e.target.value)} />
                <span><input type="number" min={0} max={50} step={0.5} value={x.w} onChange={(e) => setTilt(i, +e.target.value || 0)} />%</span>
                <button type="button" className="psim-x" title="삭제" onClick={() => set({ tilts: st.tilts.filter((_, j) => j !== i) })}>×</button>
              </div>
            )) : <p className="psim-note">추가한 오버레이가 없습니다. 목록에서 ETF를 고르거나 예시를 선택하세요.</p>}
          </div>
          <div className="psim-ctrl">
            <label className="psim-lab">오버레이 배율
              <input type="range" min={0} max={200} step={5} value={st.scale} onChange={(e) => set({ scale: +e.target.value })} />
              <span>{st.scale}%</span>
            </label>
            <label className="psim-lab">목표 TE <input type="number" step={0.5} min={0.5} value={teTarget} onChange={(e) => setTeTarget(+e.target.value || 3)} />%</label>
            <button type="button" className="ghost-btn" onClick={doFit}>배율 맞추기</button>
          </div>
          {fitMsg && <p className="empty warn psim-warn">{fitMsg}</p>}
          <p className="psim-note">오버레이 비중만큼 코어 ETF를 비례로 줄입니다. 레버리지·공매도는 쓰지 않습니다.</p>
          <div className="psim-ctrl psim-sep">
            <input type="text" placeholder="시나리오 이름" value={scName} onChange={(e) => setScName(e.target.value)} />
            <button type="button" className="ghost-btn" onClick={() => {
              const l = loadScen();
              l.push({ name: scName.trim() || `시나리오 ${l.length + 1}`, bm: st.bm, method: st.method, core: { ...st.core }, tilts: st.tilts.map((x) => ({ ...x })), scale: st.scale });
              setNote(saveScen(l) ? "저장했습니다. 이 브라우저에만 남습니다." : "이 브라우저에서는 저장할 수 없습니다. 공유 링크를 쓰세요.");
              setScen(l); setScName("");
            }}>저장</button>
            <button type="button" className="ghost-btn" onClick={() => navigator.clipboard?.writeText(window.location.href).then(() => setNote("공유 링크를 복사했습니다.")).catch(() => setNote("복사에 실패했습니다. 주소창 링크를 직접 복사하세요."))}>공유 링크 복사</button>
            <button type="button" className="ghost-btn" onClick={exportCSV}>비중·지표 CSV</button>
          </div>
          {note && <p className="psim-note">{note}</p>}
        </div>
      </div>

      <h3 className="psim-h">성과 · 위험</h3>
      <div className="psim-kpis">
        {kpis.map(([k, v, s, hl]) => (
          <div key={k} className={`psim-kpi${hl ? " hl" : ""}`}><div className="k">{k}</div><div className="v">{v}</div><div className="s">{s}</div></div>
        ))}
      </div>
      {win.lim && <p className="empty warn psim-warn">분석 구간이 {dates[win.s]}부터로 줄었습니다: {win.lim} 상장일({d.px[win.lim].start}) 이후 데이터만 있습니다.</p>}

      <div className="psim-grid psim-2">
        <ChartCard title="누적 수익률" unit="(%)">
          <LineChart data={series}>
            <CartesianGrid stroke={C.grid} vertical={false} />
            <XAxis dataKey="d" tick={AX} tickFormatter={(v) => String(v).slice(0, 7)} minTickGap={60} />
            <YAxis tick={AX} tickFormatter={tick} width={44} tickCount={6} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => f(v, 1)} />
            <Legend wrapperStyle={{ fontSize: 12 }} verticalAlign="top" align="left" />
            <Line dataKey="P" name="포트폴리오" stroke={C.blue} strokeWidth={2.25} dot={false} isAnimationActive={false} />
            <Line dataKey="C" name="코어(복제)" stroke={C.yellow} strokeWidth={1.25} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
            <Line dataKey="B" name={`BM ${bmT}`} stroke={C.gray} strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ChartCard>
        <ChartCard title="고점 대비 하락폭" unit="(%)">
          <LineChart data={series}>
            <CartesianGrid stroke={C.grid} vertical={false} />
            <XAxis dataKey="d" tick={AX} tickFormatter={(v) => String(v).slice(0, 7)} minTickGap={60} />
            <YAxis tick={AX} tickFormatter={tick} width={44} tickCount={6} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => f(v, 1)} />
            <Legend wrapperStyle={{ fontSize: 12 }} verticalAlign="top" align="left" />
            <Line dataKey="Pdd" name="포트폴리오" stroke={C.blue} strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line dataKey="Cdd" name="코어(복제)" stroke={C.yellow} strokeWidth={1.25} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
            <Line dataKey="Bdd" name={`BM ${bmT}`} stroke={C.gray} strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ChartCard>
        <ChartCard title="롤링 1년: BM 대비 초과수익 · 추적오차" unit="(%)">
          <LineChart data={series}>
            <CartesianGrid stroke={C.grid} vertical={false} />
            <XAxis dataKey="d" tick={AX} tickFormatter={(v) => String(v).slice(0, 7)} minTickGap={60} />
            <YAxis tick={AX} tickFormatter={tick} width={44} tickCount={6} />
            <ReferenceLine y={0} stroke={C.gray} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => f(v, 2)} />
            <Legend wrapperStyle={{ fontSize: 12 }} verticalAlign="top" align="left" />
            <Line dataKey="ex" name="롤링 1년 초과수익" stroke={C.blue} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} />
            <Line dataKey="te" name="롤링 1년 추적오차" stroke={C.gray} strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ChartCard>
        <div className="panel">
          <h4>성과 지표</h4>
          <div className="table-wrap">
            <table className="data-table psim-num">
              <thead><tr><th>{dates[win.s]} ~ {dates[win.e]} · {st.ccy === "KRW" ? "원화" : "달러"}</th><th>포트폴리오</th><th>코어(복제)</th><th>BM ({bmT})</th><th>차이</th></tr></thead>
              <tbody>
                {metRows.map(([lab, k, isP, dg]) => {
                  const g = (v: number | null) => (v == null ? "–" : isP ? pc(v, dg) : f(v, dg));
                  const rel = k === "te" || k === "ex" || k === "ir";
                  const noDiff = rel || k === "corr" || k === "beta";
                  return (
                    <tr key={k}><td className="l">{lab}</td><td><b>{g(P[k])}</b></td><td>{g(Cc[k])}</td><td>{rel ? "–" : g(B[k])}</td>
                      <td>{noDiff ? "" : g((P[k] ?? 0) - (B[k] ?? 0))}</td></tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <h3 className="psim-h">노출 · 위험 기여</h3>
      <div className="psim-grid psim-3">
        <HBar title="국가 액티브 비중 (look-through)" unit="(%p, 포트폴리오 − BM)" rows={expo.c} />
        <HBar title="업종 액티브 비중 (look-through)" unit="(%p, 포트폴리오 − BM)" rows={expo.s} />
        <ChartCard title="ETF별 위험 기여" unit="(%, 합계 100)" h={340}>
          <BarChart data={riskData} layout="vertical" margin={{ left: 4 }}>
            <CartesianGrid stroke={C.grid} horizontal={false} />
            <XAxis type="number" tick={AX} tickFormatter={tick} tickCount={6} />
            <YAxis type="category" dataKey="t" tick={AX} width={48} interval={0} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => f(v, 1)} />
            <Legend wrapperStyle={{ fontSize: 12 }} verticalAlign="top" align="left" />
            <Bar dataKey="te" name="TE 기여" fill={C.blue} isAnimationActive={false} />
            <Bar dataKey="vol" name="변동성 기여" fill={C.gray} isAnimationActive={false} />
          </BarChart>
        </ChartCard>
      </div>
      <div className="psim-grid psim-2">
        <ChartCard title="오버레이 배율별 추적오차 · 초과수익" unit="(초과수익, %p)" foot="0~200% 배율로 오버레이를 키웠을 때의 경로. 노란 점이 현재 배율.">
          <ScatterChart margin={{ bottom: 14 }}>
            <CartesianGrid stroke={C.grid} />
            <XAxis type="number" dataKey="x" name="TE" tick={AX} tickFormatter={(v) => f(v, 1)} tickCount={6}
              label={{ value: "(추적오차, %)", position: "insideBottomRight", offset: -8, fill: "#c3cfdc", fontSize: 11 }} />
            <YAxis type="number" dataKey="y" name="초과" tick={AX} tickFormatter={(v) => f(v, 1)} width={44} tickCount={6} />
            <ZAxis range={[30, 30]} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => f(v, 2)} />
            <Scatter data={front} name="배율 0→200%" fill={C.blue} line={{ stroke: C.blue }} isAnimationActive={false} />
            <Scatter data={[{ x: P.te * 100, y: P.ex * 100 }]} name="현재" fill={C.yellow} isAnimationActive={false}
              shape={(p: { cx?: number; cy?: number }) => <circle cx={p.cx} cy={p.cy} r={7} fill={C.yellow} />} />
          </ScatterChart>
        </ChartCard>
        <div className="panel">
          <h4>상관계수 (일간 수익률)</h4>
          <div className="table-wrap">
            <table className="data-table psim-heat">
              <thead><tr><th />{corrPick.map((row) => <th key={row.t}>{row.t}</th>)}</tr></thead>
              <tbody>
                {corrPick.map((row) => (
                  <tr key={row.t}><td className="l"><b>{row.t}</b></td>
                    {corrPick.map((col) => {
                      const v = risk.corr[row.i][col.i], sh = (v - 0.3) / 0.7;
                      const diag = row.i === col.i;
                      return <td key={col.t} style={{ background: diag ? undefined : shade(Math.max(-1, sh), 1) }}>{diag ? "" : f(v, 2)}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {risk.tickers.length > 16 && <p className="psim-note">BM과 비중 상위 종목만 표시 (최대 16개)</p>}
        </div>
      </div>

      <h3 className="psim-h">연도별 · 위기 구간</h3>
      <div className="psim-grid psim-2">
        <div className="panel">
          <h4>연도별 수익률</h4>
          <div className="psim-unit">(%)</div>
          <div style={{ height: 260 }}>
            <ResponsiveContainer>
              <BarChart data={years}>
                <CartesianGrid stroke={C.grid} vertical={false} />
                <XAxis dataKey="y" tick={AX} />
                <YAxis tick={AX} tickFormatter={tick} width={44} tickCount={6} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => f(v, 1)} />
                <Legend wrapperStyle={{ fontSize: 12 }} verticalAlign="top" align="left" />
                <ReferenceLine y={0} stroke={C.gray} />
                <Bar dataKey="P" name="포트폴리오" fill={C.blue} isAnimationActive={false} />
                <Bar dataKey="B" name={`BM ${bmT}`} fill={C.gray} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="table-wrap">
            <table className="data-table psim-num">
              <thead><tr><th>(%)</th>{years.map((y) => <th key={y.y}>{y.y}{y.partial ? "*" : ""}</th>)}</tr></thead>
              <tbody>
                <tr><td className="l">포트폴리오</td>{years.map((y) => <td key={y.y}>{f(y.P, 1)}</td>)}</tr>
                <tr><td className="l">BM</td>{years.map((y) => <td key={y.y}>{f(y.B, 1)}</td>)}</tr>
                <tr><td className="l"><b>초과</b></td>{years.map((y) => <td key={y.y}><b>{f(y.P - y.B, 1)}</b></td>)}</tr>
              </tbody>
            </table>
          </div>
          <p className="psim-note">* 일부 연도</p>
        </div>
        <div className="panel">
          <h4>위기 · 급락 구간 수익률</h4>
          <div className="table-wrap">
            <table className="data-table psim-num">
              <thead><tr><th>구간</th><th>기간</th><th>포트폴리오(%)</th><th>코어(%)</th><th>BM(%)</th><th>초과(%p)</th></tr></thead>
              <tbody>
                {stress.map((r) => r.na ? (
                  <tr key={r.name} className="psim-dim"><td className="l">{r.name}</td><td>{r.a} ~ {r.b}</td><td className="l" colSpan={4}>데이터 없음 (편입 ETF 상장 이전)</td></tr>
                ) : (
                  <tr key={r.name}><td className="l">{r.name}</td><td>{r.a} ~ {r.b}</td><td><b>{pc(r.p)}</b></td><td>{pc(r.c)}</td><td>{pc(r.bb)}</td><td><b>{pc(r.p - r.bb)}</b></td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="psim-note">구간 전체가 데이터 범위 안에 있을 때만 계산합니다(선택 기간과 무관).</p>
        </div>
      </div>

      <Screener eng={eng} st={st} res={res} kname={kname} groups={groups} onAdd={addTilt} />

      <h3 className="psim-h">저장한 시나리오 비교</h3>
      <div className="panel">
        {scen.length ? (
          <div className="table-wrap">
            <table className="data-table psim-num">
              <thead><tr><th>시나리오</th><th>BM</th><th>오버레이</th><th>연수익(%)</th><th>초과(%p)</th><th>TE(%)</th><th>IR</th><th>변동성(%)</th><th>최대낙폭(%)</th><th /></tr></thead>
              <tbody>
                {scen.map((sc, i) => {
                  const r = run(eng, { ...st, bm: sc.bm, method: sc.method, core: sc.core, tilts: sc.tilts, scale: sc.scale });
                  return (
                    <tr key={i}>
                      <td className="l"><b>{sc.name}</b></td><td>{BM_NAME[sc.bm]}</td>
                      <td className="l">{sc.tilts.map((x) => `${x.t} ${f((x.w * sc.scale) / 100, 1)}`).join(", ") || "–"}</td>
                      <td>{pc(r.P.cagr)}</td><td>{pc(r.P.ex, 2)}</td><td>{pc(r.P.te, 2)}</td><td>{f(r.P.ir, 2)}</td><td>{pc(r.P.vol)}</td><td>{pc(r.P.mdd)}</td>
                      <td>
                        <button type="button" className="ghost-btn" onClick={() => set({ bm: sc.bm, method: sc.method, core: { ...sc.core }, tilts: sc.tilts.map((x) => ({ ...x })), scale: sc.scale })}>불러오기</button>
                        <button type="button" className="psim-x" title="삭제" onClick={() => { const l = loadScen(); l.splice(i, 1); saveScen(l); setScen(l); }}>×</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <p className="psim-note">저장한 시나리오가 없습니다. 위에서 이름을 넣고 저장하세요. 현재 기간·통화·리밸런싱으로 다시 계산해 비교합니다.</p>}
      </div>

      <details className="panel psim-def">
        <summary>정의 · 데이터</summary>
        <p>BM 수익률: ACWI·IVV·QQQ ETF의 배당 재투자 수정주가(보수 차감 후). 코어: 복제 방식대로 ETF를 묶은 바스켓. 포트폴리오: 코어 + 오버레이.</p>
        <p>추적오차(TE): BM 대비 일간 초과수익의 표준편차 × √252. 정보비율(IR): 연환산 산술 초과수익 ÷ TE. 샤프: 무위험(BIL) 차감 연환산 수익 ÷ 변동성. 상승·하락 포착률: BM이 오른(내린) 달의 포트폴리오 평균 ÷ BM 평균. 위험 기여: w<sub>i</sub>(Σw)<sub>i</sub> ÷ σ², TE 기여는 BM을 −100%로 둔 액티브 비중 기준.</p>
        <p>look-through: iShares·SPDR 보유종목(2026-10-12)을 ACWI 종목 국가·업종에 매핑. 일부 테마 ETF는 Yahoo(Morningstar 업종, 상위 10종목 국가)로 근사. 나스닥100 업종은 구성 티커 + ACWI 유동시총에 수정시총 규칙(단일 24%, 4.5% 초과 합 48%)을 적용한 근사.</p>
        <p>코어 복제 비중은 현재(2026-10) BM 구성으로 고정해 과거에 적용합니다. 과거 BM 비중과 달라 코어와 BM 사이에 추적오차가 생깁니다. 국가 복제의 미국 몫은 IVV(대형주)라 ACWI의 미국 중형주는 빠집니다. 원화 환산은 달러 수익률에 원/달러 변화율을 곱한 환노출 기준입니다.</p>
      </details>
    </div>
  );
}

function ChartCard({ title, unit, h = 280, foot, children }: { title: string; unit: string; h?: number; foot?: string; children: React.ReactElement }) {
  return (
    <div className="panel">
      <h4>{title}</h4>
      <div className="psim-unit">{unit}</div>
      <div style={{ height: h }}><ResponsiveContainer>{children}</ResponsiveContainer></div>
      {foot && <p className="psim-note">{foot}</p>}
    </div>
  );
}

function HBar({ title, unit, rows }: { title: string; unit: string; rows: { k: string; a: number; p: number; b: number }[] }) {
  return (
    <ChartCard title={title} unit={unit} h={340}>
      <BarChart data={rows} layout="vertical" margin={{ left: 4 }}>
        <CartesianGrid stroke={C.grid} horizontal={false} />
        <XAxis type="number" tick={AX} tickFormatter={(v) => f(v, 1)} tickCount={6} />
        <YAxis type="category" dataKey="k" tick={AX} width={72} interval={0} />
        <ReferenceLine x={0} stroke={C.gray} />
        <Tooltip contentStyle={tooltipStyle}
          formatter={(_: number, __: string, it: { payload?: { a: number; p: number; b: number } }) => {
            const r = it.payload!;
            return [`${f(r.a, 2)}%p (포트 ${f(r.p, 1)}% / BM ${f(r.b, 1)}%)`, "액티브"];
          }} />
        <Bar dataKey="a" isAnimationActive={false}>
          {rows.map((r) => <Cell key={r.k} fill={r.a >= 0 ? C.blue : C.gray} />)}
        </Bar>
      </BarChart>
    </ChartCard>
  );
}

function BmSection({ d, bm }: { d: SimData; bm: BmId }) {
  const b = d.bm[bm], a = d.bm.acwi, sp = d.bm.spx, nd = d.bm.ndx;
  const ctyRows = useMemo(() => {
    if (bm !== "acwi") return b.top.slice(0, 15).map((x) => ({ k: x.ticker, v: x.w }));
    const rows = Object.entries(a.country || {}).slice(0, 15).map(([k, v]) => ({ k, v }));
    rows.push({ k: "기타", v: 100 - rows.reduce((s, x) => s + x.v, 0) });
    return rows;
  }, [bm, a, b]);
  const sk = [...d.sectors].sort((x, y) => (b.sector[y] || 0) - (b.sector[x] || 0));
  const secRows = sk.map((s) => ({ k: s, acwi: a.sector[s] || 0, spx: sp.sector[s] || 0, ndx: nd.sector[s] || 0 }));
  const ac = a.country || {};
  const effN = (o: Record<string, number>) => 1 / Object.values(o).reduce((s, v) => s + (v / 100) ** 2, 0);
  const top10 = (o: typeof a) => o.top.slice(0, 10).reduce((s, x) => s + x.w, 0);
  const cKeys = Object.keys(ac);
  const ins = [
    `ACWI는 미국이 ${f(ac["미국"])}%다. 상위 3개국(미국·${cKeys[1]}·${cKeys[2]}) 합이 ${f(Object.values(ac).slice(0, 3).reduce((x, y) => x + y, 0))}%이고, 국가 유효 개수는 ${f(effN(ac), 1)}개에 그친다.`,
    `업종은 세 BM 모두 IT가 1위다. ACWI ${f(a.sector.IT)}%, S&P500 ${f(sp.sector.IT)}%, 나스닥100 ${f(nd.sector.IT)}%다.`,
    `나스닥100은 IT·커뮤니케이션·경기소비재 합이 ${f((nd.sector.IT || 0) + (nd.sector["커뮤니케이션"] || 0) + (nd.sector["경기소비재"] || 0))}%다. 금융(${f(nd.sector["금융"] || 0)}%)·에너지(${f(nd.sector["에너지"] || 0)}%)는 사실상 없다.`,
    `상위 10종목 비중은 ACWI ${f(top10(a))}%, S&P500 ${f(top10(sp))}%, 나스닥100 ${f(top10(nd))}%다.`,
    `ACWI 비미국 ${f(100 - (ac["미국"] || 0))}% 가운데 일본(${f(ac["일본"])}%)·대만(${f(ac["대만"])}%)·한국(${f(ac["한국"])}%)이 아시아 축이다. 대만·한국은 IT 비중이 높아 국가 오버레이가 사실상 반도체 오버레이가 된다.`,
  ];
  const cs = a.country_sector || {};
  const csC = Object.keys(cs);
  const mx = Math.max(...csC.flatMap((c) => d.sectors.map((s) => cs[c][s] || 0)));
  return (
    <>
      <h3 className="psim-h">BM 구성 분석</h3>
      <div className="psim-grid psim-3">
        <ChartCard title={bm === "acwi" ? "ACWI 국가 비중 (상위 15개국)" : `${BM_NAME[bm]} 상위 15종목 비중`} unit="(%)" h={360}>
          <BarChart data={ctyRows} layout="vertical" margin={{ left: 4 }}>
            <CartesianGrid stroke={C.grid} horizontal={false} />
            <XAxis type="number" tick={AX} tickFormatter={tick} tickCount={6} />
            <YAxis type="category" dataKey="k" tick={AX} width={60} interval={0} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => f(v, 2)} />
            <Bar dataKey="v" name="비중" isAnimationActive={false}>
              {ctyRows.map((r, i) => <Cell key={r.k} fill={i === 0 ? C.blue : r.k === "기타" ? "#4a5568" : "#56669c"} />)}
            </Bar>
          </BarChart>
        </ChartCard>
        <ChartCard title="업종 비중: ACWI · S&P500 · 나스닥100" unit="(%)" h={360}>
          <BarChart data={secRows} layout="vertical" margin={{ left: 4 }}>
            <CartesianGrid stroke={C.grid} horizontal={false} />
            <XAxis type="number" tick={AX} tickFormatter={tick} tickCount={6} />
            <YAxis type="category" dataKey="k" tick={AX} width={72} interval={0} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => f(v, 1)} />
            <Legend wrapperStyle={{ fontSize: 12 }} verticalAlign="top" align="left" />
            <Bar dataKey="acwi" name="ACWI" fill={C.blue} isAnimationActive={false} />
            <Bar dataKey="spx" name="S&P500" fill={C.gray} isAnimationActive={false} />
            <Bar dataKey="ndx" name="나스닥100" fill={C.yellow} isAnimationActive={false} />
          </BarChart>
        </ChartCard>
        <div className="panel">
          <h4>핵심 관찰</h4>
          <ul className="psim-ins">{ins.map((x) => <li key={x}>{x}</li>)}</ul>
          <p className="psim-note">기준: ACWI {d.asof.acwi}, S&P500 {d.asof.spx}, 나스닥100 {d.asof.ndx}. 미편입: {(nd.missing || []).join(", ")}</p>
        </div>
      </div>
      <div className="psim-grid psim-2">
        <div className="panel">
          <h4>ACWI 국가 × 업종 <span className="muted">(ACWI 전체 대비 %, 상위 12개국)</span></h4>
          <div className="table-wrap">
            <table className="data-table psim-heat">
              <thead><tr><th>국가</th>{d.sectors.map((s) => <th key={s}>{s}</th>)}<th>합계</th></tr></thead>
              <tbody>
                {csC.map((c) => (
                  <tr key={c}><td className="l">{c}</td>
                    {d.sectors.map((s) => { const v = cs[c][s] || 0; return <td key={s} style={{ background: shade(v, mx / 2.5) }}>{v >= 0.05 ? f(v, 1) : ""}</td>; })}
                    <td><b>{f(ac[c], 1)}</b></td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="panel">
          <h4>{BM_NAME[bm]} 상위 10종목</h4>
          <div className="table-wrap">
            <table className="data-table psim-num">
              <thead><tr><th>종목</th><th>티커</th>{bm === "acwi" && <th>국가</th>}<th>업종</th><th>비중(%)</th></tr></thead>
              <tbody>
                {b.top.slice(0, 10).map((x) => (
                  <tr key={x.ticker}><td className="l">{x.name.slice(0, 30)}</td><td>{x.ticker}</td>{bm === "acwi" && <td>{x.country}</td>}<td>{x.sector}</td><td>{f(x.w, 2)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}

type SortKey = "dex" | "dte" | "dvol" | "dmdd" | "cagr" | "vol" | "mdd" | "corr" | "beta" | "ir";
function Screener({ eng, st, res, kname, groups, onAdd }: {
  eng: Engine; st: SimState; res: ReturnType<typeof run>; kname: (t: string) => string; groups: string[]; onAdd: (t: string, w: number) => void;
}) {
  const [w, setW] = useState(5);
  const [g, setG] = useState("");
  const [sort, setSort] = useState<{ k: SortKey; d: number }>({ k: "dex", d: -1 });
  // 후보 58개 × 시뮬레이션이라 입력보다 한 박자 늦게 계산
  const dst = useDeferredValue(st), dres = useDeferredValue(res);
  const rows = useMemo(() => screen(eng, dst, dres, w, g), [eng, dst, dres, w, g]);
  const sorted = [...rows].sort((a, b) => (a.na ? 1 : b.na ? -1 : sort.d * ((a[sort.k] ?? -1e9) - (b[sort.k] ?? -1e9))));
  const cols: Array<[SortKey, string, boolean]> = [
    ["cagr", "연수익(%)", true], ["vol", "변동성(%)", true], ["mdd", "최대낙폭(%)", true], ["corr", "BM 상관", false], ["beta", "BM 베타", false],
    ["dex", "Δ초과수익(%p)", true], ["dte", "ΔTE(%p)", true], ["dvol", "Δ변동성(%p)", true], ["dmdd", "Δ최대낙폭(%p)", true], ["ir", "추가 후 IR", false],
  ];
  return (
    <>
      <h3 className="psim-h">오버레이 후보 스크리너</h3>
      <div className="panel">
        <div className="psim-ctrl">
          <label className="psim-lab">추가 비중 <input type="number" min={1} max={30} step={1} value={w} onChange={(e) => setW(Math.max(0.5, +e.target.value || 5))} />%</label>
          <select value={g} onChange={(e) => setG(e.target.value)}>
            <option value="">전체 그룹</option>
            {groups.map((x) => <option key={x}>{x}</option>)}
          </select>
          <span className="psim-note">현재 포트폴리오에 후보 하나를 더했을 때 지표 변화. 열 머리로 정렬, ＋로 오버레이에 추가.</span>
        </div>
        <div className="table-wrap psim-scroll" style={{ maxHeight: 520 }}>
          <table className="data-table psim-num">
            <thead>
              <tr><th /><th>그룹</th><th>ETF</th>
                {cols.map(([k, n]) => (
                  <th key={k} className="psim-sort" onClick={() => setSort({ k, d: sort.k === k ? -sort.d : -1 })}>
                    {n}{sort.k === k ? (sort.d < 0 ? " ▼" : " ▲") : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((r: ScreenRow) => (
                <tr key={r.t} className={r.na ? "psim-dim" : ""}>
                  <td>{!r.na && <button type="button" className="psim-add" title="오버레이에 추가" onClick={() => onAdd(r.t, w)}>＋</button>}</td>
                  <td className="l">{r.grp}</td><td className="l"><b>{r.t}</b> {kname(r.t)}</td>
                  {r.na
                    ? <td className="l" colSpan={10}>상장 {eng.d.px[r.t]?.start} · 선택 구간보다 짧음</td>
                    : cols.map(([k, , isP]) => <td key={k}>{isP ? pc(r[k], 2) : f(r[k], 2)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
