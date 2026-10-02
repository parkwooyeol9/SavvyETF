"use client";

import { useEffect, useMemo, useState } from "react";

import {
  ACWI_FACTORS,
  fmt,
  fmtCap,
  isNum,
  sma,
  type AcwiSeries,
  type AcwiStock,
  type AcwiSummary,
} from "@/lib/acwiAnalyzer";

import AcwiChart from "./AcwiChart";
import AcwiTable, { type Col } from "./AcwiTable";
import { Card, Kpi, Legend, MsBadge, nameCol, Sg } from "./parts";

type Props = {
  A: AcwiSummary;
  code: string | null;
  onPick: (code: string) => void;
  loadSeries: (code: string) => Promise<AcwiSeries>;
};

function Picker({ A, onPick }: { A: AcwiSummary; onPick: (code: string) => void }) {
  const [q, setQ] = useState("");
  const [act, setAct] = useState(-1);
  const items = useMemo(() => {
    const v = q.trim().toLowerCase();
    if (!v) return [];
    return A.stocks
      .filter((s) => (s.n ?? "").toLowerCase().includes(v) || s.c.toLowerCase().includes(v))
      .sort((a, b) => (b.w ?? 0) - (a.w ?? 0))
      .slice(0, 12);
  }, [A.stocks, q]);
  const pick = (c: string) => {
    onPick(c);
    setQ("");
    setAct(-1);
  };
  return (
    <div className="aa-pick">
      <input
        type="search"
        value={q}
        placeholder="종목명·코드 입력 (예: Samsung, 005930, NVDA)"
        autoComplete="off"
        onChange={(e) => {
          setQ(e.target.value);
          setAct(-1);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setAct((a) => Math.min(items.length - 1, a + 1));
          else if (e.key === "ArrowUp") setAct((a) => Math.max(0, a - 1));
          else if (e.key === "Enter" && items.length) pick(items[Math.max(0, act)].c);
          else return;
          e.preventDefault();
        }}
      />
      {items.length ? (
        <div className="aa-sugg" role="listbox">
          {items.map((s, i) => (
            <button key={s.c} type="button" className={i === act ? "act" : undefined} onClick={() => pick(s.c)}>
              {s.n} <span className="meta-soft">
                {s.c} · {s.ct}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FactorBars({ s }: { s: AcwiStock }) {
  return (
    <div className="aa-bars">
      {ACWI_FACTORS.map(([k, l]) => {
        const v = s[k];
        const w = isNum(v) ? (Math.min(3, Math.abs(v)) / 3) * 50 : 0;
        return (
          <div key={k} className="aa-bar">
            <span>{l}</span>
            <div className="aa-track">
              {isNum(v) ? (
                <div
                  className="aa-fill"
                  style={{
                    [v >= 0 ? "left" : "right"]: "50%",
                    width: `${w}%`,
                    background: v >= 0 ? "var(--aa-pos)" : "var(--aa-neg)",
                  }}
                />
              ) : null}
            </div>
            <span className="aa-mono">{fmt(v, 2)}</span>
          </div>
        );
      })}
    </div>
  );
}

const indexed = (a: (number | null)[] | undefined) => {
  const b0 = (a ?? []).find((v) => isNum(v) && v > 0);
  return (a ?? []).map((v) => (isNum(v) && b0 ? (v / b0) * 100 : null));
};

const peerCols: Col<AcwiStock>[] = [
  nameCol<AcwiStock>(),
  { k: "pe", h: "PER", n: true, f: (x) => fmt(x.pe, 1) },
  { k: "er3", h: "EPS Δ3M", n: true, f: (x) => <Sg v={x.er3} /> },
  { k: "r3m", h: "3M", n: true, f: (x) => <Sg v={x.r3m} /> },
  { k: "ts", h: "추세", n: true, f: (x) => (isNum(x.ts) ? `${x.ts}/6` : "–") },
  { k: "rk", h: "순위", n: true, f: (x) => x.rk ?? "–" },
];

const CARS = ["car_pre", "car_ann", "car_run", "car_close", "car_post"] as const;

export default function AcwiDetail({ A, code, onPick, loadSeries }: Props) {
  const M = A.meta;
  const s = useMemo(() => (code ? A.stocks.find((x) => x.c === code) : undefined), [A.stocks, code]);
  const [ser, setSer] = useState<{ code: string; data?: AcwiSeries; error?: string } | null>(null);
  const [mode, setMode] = useState<"abs" | "rel">("abs");

  useEffect(() => {
    if (!code) return;
    let live = true;
    loadSeries(code).then(
      (data) => live && setSer({ code, data }),
      (e: unknown) => live && setSer({ code, error: e instanceof Error ? e.message : "시계열을 불러오지 못했습니다." }),
    );
    return () => {
      live = false;
    };
  }, [code, loadSeries]);

  const S = ser?.code === code ? ser.data : undefined;
  const ri = useMemo(() => S?.ri ?? [], [S]);
  const ma10 = useMemo(() => sma(ri, 10), [ri]);
  const ma40 = useMemo(() => sma(ri, 40), [ri]);
  const rel = useMemo(() => {
    const b = A.series.bench;
    return ri.map((v, i) => (isNum(v) && isNum(b[i]) ? (v / (b[i] as number)) * 1000 : null));
  }, [ri, A.series.bench]);
  const evs = useMemo(() => (code ? A.events.per.filter((e) => e.code === code) : []), [A.events.per, code]);
  const peers = useMemo(
    () =>
      s
        ? A.stocks
            .filter((x) => x.ind === s.ind && x.c !== s.c && !x.xr)
            .sort((a, b) => (b.cap ?? 0) - (a.cap ?? 0))
            .slice(0, 10)
        : [],
    [A.stocks, s],
  );

  if (!s) {
    return (
      <div className="aa-view">
        <Picker A={A} onPick={onPick} />
        <p className="empty">스크리너·리스트에서 종목을 누르거나 위에서 검색하세요.</p>
      </div>
    );
  }

  const xwin = isNum(s.xa)
    ? `${(s.xd ?? 0) > 0 ? "골든크로스" : "데드크로스"} ${s.xa}일 전`
    : s.gold === 1
      ? "MA50 > MA200"
      : s.gold === 0
        ? "MA50 < MA200"
        : "";
  const rangePos =
    isNum(s.dd52) && isNum(s.up52)
      ? (() => {
          const lo = 1 / (1 + s.up52 / 100);
          const hi = 1 / (1 + s.dd52 / 100);
          return Math.max(0, Math.min(100, ((1 - lo) / (hi - lo)) * 100));
        })()
      : null;
  const eps = S?.eps ?? [];
  const seriesNote = ser?.code === code && ser.error ? <p className="im-warn">{ser.error}</p> : null;

  return (
    <div className="aa-view">
      <Picker A={A} onPick={onPick} />
      {seriesNote}
      <section className="aa-card">
        <div className="aa-detail-head">
          <div>
            <div className="aa-eyebrow">
              {s.c} · {s.isin ?? ""} · {s.ct ?? ""} · {s.s ?? ""} / {s.ind ?? ""}
            </div>
            <h2 className="aa-title">{s.n}</h2>
            <div className="aa-badges">
              <MsBadge s={s} />
              {s.sr ? <span className="aa-badge">편입 {s.sr === "<coverage" ? "2013-08 이전" : `${s.sr} (${s.since ?? ""})`}</span> : null}
              {s.tr ? (
                <span className={`aa-badge${s.tr === "강세" ? " aa-b-on" : s.tr === "약세" ? " aa-b-del" : ""}`}>
                  추세 {s.tr} {s.ts}/6
                </span>
              ) : null}
              {isNum(s.wr) && s.wr <= 200 ? <span className="aa-badge aa-b-w">편출 관찰 {s.wr}위</span> : null}
              {s.flag ? <span className="aa-badge aa-b-w">{s.flag}</span> : null}
              {s.susp ? <span className="aa-badge aa-b-w">거래정지 의심</span> : null}
              {s.xr ? <span className="aa-badge aa-b-w">팩터 제외: {s.xr}</span> : null}
            </div>
          </div>
          <div className="aa-rank">
            <div className="aa-eyebrow">종합 순위</div>
            <div className="aa-rank-n">
              {s.rk ?? "–"}
              <span className="meta-soft"> / {A.quality.n_scored.toLocaleString()}</span>
            </div>
            <div className="meta-soft">
              섹터 내 {s.srk ?? "–"}위 · Z {fmt(s.z, 2)}
            </div>
          </div>
        </div>
        <div className="aa-kpis">
          <Kpi label="시가총액" value={fmtCap(s.cap)} sub={`ACWI 비중 ${fmt((s.w ?? 0) * 100, 3)}%`} />
          <Kpi label="주가(USD)" value={fmt(s.pxu, 2)} />
          <Kpi label="Fwd PER" value={fmt(s.pe, 1)} sub={`3Y 중앙 ${fmt(s.pem, 1)} · 위치 ${fmt(s.pep, 0)}`} />
          <Kpi label="Fwd PBR" value={fmt(s.pb, 2)} sub={`3Y 위치 ${fmt(s.pbp, 0)}`} />
          <Kpi label="배당수익률" value={fmt(s.dy, 2, "%")} sub={`3Y 위치 ${fmt(s.dyp, 0)} · 삭감 ${s.cuts ?? "–"}회`} />
          <Kpi label="Fwd ROE" value={fmt(s.roe, 1, "%")} />
          <Kpi
            label="EPS 리비전"
            value={<Sg v={s.er3} />}
            sub={
              <>
                1M <Sg v={s.er1} /> · 12M <Sg v={s.er12} d={0} />
              </>
            }
          />
          <Kpi
            label="EPS 성장 CY27"
            value={<Sg v={s.eg} d={0} />}
            sub={
              s.ef ? (
                s.ef
              ) : (
                <>
                  CY26 <Sg v={s.eg26} d={0} />
                </>
              )
            }
          />
          <Kpi
            label="수익률 3M / 12M"
            value={
              <>
                <Sg v={s.r3m} d={0} /> / <Sg v={s.r12m} d={0} />
              </>
            }
            sub={
              <>
                벤치 대비 <Sg v={s.rel3} d={0} suf="%p" /> / <Sg v={s.rel12} d={0} suf="%p" />
              </>
            }
          />
          <Kpi label="변동성 · 베타" value={`${fmt(s.vol, 0, "%")} · ${fmt(s.beta, 2)}`} sub={`MDD 1Y ${fmt(s.mdd, 0, "%")}`} />
        </div>
      </section>

      <div className="aa-grid aa-g2">
        <Card title="총수익지수 (주간, 3년)" sub="현지통화 · 배당 재투자 · 마지막 값 = 1,000 · 10주/40주 이동평균 ≈ 50일/200일선">
          <div className="aa-seg">
            {(
              [
                ["abs", "절대"],
                ["rel", "벤치마크 대비"],
              ] as const
            ).map(([m, l]) => (
              <button key={m} type="button" className={`chip${mode === m ? " active" : ""}`} aria-pressed={mode === m} onClick={() => setMode(m)}>
                {l}
              </button>
            ))}
          </div>
          {!S && !seriesNote ? <p className="aa-empty">시계열 불러오는 중…</p> : null}
          {S ? (
            mode === "rel" ? (
              <>
                <AcwiChart
                  x={A.series.weeks}
                  series={[{ y: rel, color: "var(--accent)", name: "상대" }]}
                  yfmt={(v) => fmt(v, 0)}
                  xfmt={(v) => String(v).slice(2, 7)}
                  refs={[{ y: 1000, label: "현재" }]}
                />
                <Legend items={[["var(--accent)", "종목 ÷ 벤치마크 (상승 = 아웃퍼폼)"]]} />
              </>
            ) : (
              <>
                <AcwiChart
                  x={A.series.weeks}
                  series={[
                    { y: ri, color: "var(--text)", name: "RI" },
                    { y: ma10, color: "var(--aa-pos)", name: "10주", w: 1.2 },
                    { y: ma40, color: "var(--aa-neg)", name: "40주", w: 1.2 },
                  ]}
                  yfmt={(v) => fmt(v, 0)}
                  xfmt={(v) => String(v).slice(2, 7)}
                />
                <Legend
                  items={[
                    ["var(--text)", "총수익지수"],
                    ["var(--aa-pos)", "10주 이평"],
                    ["var(--aa-neg)", "40주 이평"],
                  ]}
                />
              </>
            )
          ) : null}
        </Card>
        <Card title="기술적 지표" sub={`마지막 거래일 ${M.ri_last}`}>
          <div className="aa-kpis">
            <Kpi label="RSI(14)" value={fmt(s.rsi, 0)} sub={isNum(s.rsi) ? (s.rsi >= 70 ? "과매수" : s.rsi <= 30 ? "과매도" : "중립") : ""} />
            <Kpi label="MACD 히스토그램" value={fmt(s.mh, 2)} sub={s.mxd ? (s.mxd > 0 ? "시그널 상향 돌파" : "시그널 하향 돌파") : ""} />
            <Kpi label="볼린저 %B" value={fmt(s.bb, 0)} sub="0=하단, 100=상단" />
            <Kpi label="MA20 괴리" value={<Sg v={s.ma20} />} />
            <Kpi label="MA50 괴리" value={<Sg v={s.ma50} />} />
            <Kpi label="MA200 괴리" value={<Sg v={s.ma200} />} sub={xwin} />
            <Kpi
              label="1W / 1M"
              value={
                <>
                  <Sg v={s.r1w} /> / <Sg v={s.r1m} />
                </>
              }
            />
            <Kpi label="YTD" value={<Sg v={s.ytd} />} />
            <Kpi label="상관(주간)" value={fmt(s.corr, 2)} />
          </div>
          <h4 className="aa-h4">52주 범위</h4>
          <div className="aa-range">{rangePos !== null ? <i style={{ left: `calc(${rangePos}% - 1px)` }} /> : null}</div>
          <div className="aa-range-lab meta-soft">
            <span>
              저점 대비 <Sg v={s.up52} d={0} />
            </span>
            <span>
              고점 대비 <Sg v={s.dd52} />
            </span>
          </div>
          <h4 className="aa-h4">팩터 (섹터×지역 중립 Z)</h4>
          <FactorBars s={s} />
        </Card>
      </div>

      <div className="aa-grid aa-g3">
        <Card title="EPS NTM 추정치" sub="월간, 보고통화">
          {S ? (
            <AcwiChart
              x={A.series.months}
              series={[{ y: eps, color: "var(--accent)", name: "EPS" }]}
              h={180}
              yfmt={(v) => fmt(v, Math.abs(v) < 10 ? 2 : 0)}
              zeroLine={eps.some((v) => isNum(v) && v < 0)}
            />
          ) : null}
        </Card>
        <Card title="BPS · DPS NTM" sub="시작 = 100 지수화">
          {S ? (
            <AcwiChart
              x={A.series.months}
              series={[
                { y: indexed(S.bps), color: "var(--aa-c3)", name: "BPS" },
                { y: indexed(S.dps), color: "var(--aa-c4)", name: "DPS" },
              ]}
              h={180}
              yfmt={(v) => fmt(v, 0)}
            />
          ) : null}
          <Legend
            items={[
              ["var(--aa-c3)", "BPS"],
              ["var(--aa-c4)", "DPS"],
            ]}
          />
        </Card>
        <Card title="근사 Fwd PER 밴드" sub="현재 PER × (주가 상대변화 ÷ EPS 상대변화). 점선 = 3년 중앙값. 주가·추정치 통화가 다르면 환율 오차 포함">
          {S ? (
            <AcwiChart
              x={A.series.months}
              series={[{ y: S.pe ?? [], color: "var(--warn)", name: "PER" }]}
              h={180}
              yfmt={(v) => fmt(v, 1)}
              refs={[{ y: s.pem, label: `중앙 ${fmt(s.pem, 1)}` }]}
            />
          ) : null}
        </Card>
      </div>

      <div className="aa-grid aa-g2">
        <Card title="MSCI 편출입 이력" sub="2013-08~ 공개 리스트 재구성 결과 (ISIN 매칭)">
          <table className="aa-tbl aa-mini">
            <tbody>
              <tr>
                <td>현재 상태</td>
                <td>
                  <MsBadge s={s} /> {s.ee ? <span className="meta-soft">효력 {s.ee}</span> : null}
                </td>
              </tr>
              <tr>
                <td>편입</td>
                <td>
                  {s.sr === "<coverage" ? "2013-08 이전부터 (공개 이력 시작 전)" : s.sr ? `${s.sr} 리뷰 · ${s.since ?? ""} 효력` : "매칭 없음"}
                </td>
              </tr>
              <tr>
                <td>국가 내 크기 위치</td>
                <td>
                  {fmt(s.tail, 1)} <span className="meta-soft">(100=국가에서 가장 작음) · 편출 관찰 {isNum(s.wr) ? `${s.wr}위` : "–"}</span>
                </td>
              </tr>
            </tbody>
          </table>
          {evs.length ? (
            <>
              <h4 className="aa-h4">이벤트 초과수익 (시장조정, %)</h4>
              <div className="aa-scroll">
                <table className="aa-tbl aa-mini">
                  <thead>
                    <tr>
                      <th>리뷰</th>
                      <th>구분</th>
                      <th className="n">발표 전20일</th>
                      <th className="n">발표 2일</th>
                      <th className="n">~리밸런싱</th>
                      <th className="n">당일</th>
                      <th className="n">효력 후</th>
                    </tr>
                  </thead>
                  <tbody>
                    {evs.map((e) => (
                      <tr key={`${e.review}-${e.action}`}>
                        <td>{e.review}</td>
                        <td>{e.action === "ADD" ? "편입" : "편출"}</td>
                        {CARS.map((k) => (
                          <td key={k} className="n">
                            <Sg v={e[k]} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="meta-soft aa-mt">시계열 기간(2023-10~) 안의 편출입 이벤트 없음</p>
          )}
        </Card>
        <Card title="같은 산업 종목" sub={`${s.ind ?? ""} · 시총 상위 10`}>
          <div className="aa-scroll">
            <AcwiTable className="aa-tbl" cols={peerCols} rows={peers} limit={10} rowKey={(x) => x.c} onRow={(x) => onPick(x.c)} />
          </div>
        </Card>
      </div>
    </div>
  );
}
