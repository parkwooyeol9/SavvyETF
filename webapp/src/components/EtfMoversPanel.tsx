"use client";

import { useMemo, useState } from "react";

import {
  MARKET_LABEL,
  asOfDay,
  fmtAum,
  fmtPct,
  type EtfUniverseFile,
  type EtfUniverseMarket,
  type EtfUniverseRow,
} from "@/lib/etfUniverse";

/**
 * ETF·DB 첫 화면 — 상장 시장(권역) 안에서 크게 오르내렸거나 거래량이 붙은 ETF를 고른다.
 * 이미 받은 유니버스 파일(+ 20:10 종가·거래량 오버레이)만 쓰고, 탭을 열 때 외부 수집은 없다.
 */

type Period = "r1d" | "r1w" | "r1m" | "r3m";
type VolKey = "vr1" | "vr5";
type GroupDim = "reg" | "sec" | "st";

const PERIOD_LABEL: Record<Period, string> = { r1d: "1D", r1w: "1W", r1m: "1M", r3m: "3M" };
const VOL_LABEL: Record<VolKey, string> = { vr1: "당일", vr5: "5일 평균" };
const GROUP_LABEL: Record<GroupDim, string> = { reg: "투자지역", sec: "업종", st: "전략·테마" };
/** 당일 2배, 5일 평균 1.5배 이상이면 거래 급증으로 본다. */
const SURGE: Record<VolKey, number> = { vr1: 2, vr5: 1.5 };
const TOP_N = 10;
/** 일반(비레버리지) ETF가 이만큼 움직였다면 대개 Yahoo 일봉의 단위·액면 조정 오류다. 목록에서 뺀다. */
const OUTLIER: Record<Period, number> = { r1d: 30, r1w: 40, r1m: 60, r3m: 100 };

/** 순자산 하한: 한국 50억원, 그 밖 $20M. 소규모 상품의 우연한 급등락을 거른다. */
function minAum(unit: string): number {
  return unit === "억원" ? 50 : 20;
}

function signedClass(n?: number | null): string {
  if (n == null || n === 0) return "";
  return n > 0 ? "up" : "down";
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

type Props = {
  market: EtfUniverseMarket;
  file: EtfUniverseFile;
  rows: EtfUniverseRow[];
};

export default function EtfMoversPanel({ market, file, rows }: Props) {
  const unit = file.unit;
  const periods = useMemo(
    () => (["r1d", "r1w", "r1m", "r3m"] as Period[]).filter((p) => rows.some((r) => r[p] != null)),
    [rows],
  );
  const hasVol = rows.some((r) => r.vr1 != null || r.vr5 != null);
  const [periodPick, setPeriod] = useState<Period | null>(null);
  const period = periodPick && periods.includes(periodPick) ? periodPick : periods[0] ?? "r1m";
  const [volKey, setVolKey] = useState<VolKey>("vr1");
  const [ac, setAc] = useState<string>("전체");
  const [withLev, setWithLev] = useState(false);
  const [groupDim, setGroupDim] = useState<GroupDim>("reg");

  const acOptions = useMemo(() => {
    const count = new Map<string, number>();
    for (const r of rows) if (r.ac) count.set(r.ac, (count.get(r.ac) || 0) + 1);
    return ["전체", ...[...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => k)];
  }, [rows]);

  const pool = useMemo(() => {
    const floor = minAum(unit);
    return rows.filter(
      (r) =>
        (r.aum ?? 0) >= floor &&
        (withLev || !r.lev || r.lev === "일반") &&
        (ac === "전체" || r.ac === ac),
    );
  }, [rows, unit, withLev, ac]);

  const outliers = useMemo(
    () =>
      new Set(
        pool
          .filter(
            (r) =>
              (!r.lev || r.lev === "일반") &&
              // 단기자금(MMF)은 기준의 1/5: 하루 6% 이상 움직였다면 분배·단위 오류다.
              Math.abs(r[period] ?? 0) > OUTLIER[period] * (r.ac === "단기자금" ? 0.2 : 1),
          )
          .map((r) => r.t),
      ),
    [pool, period],
  );
  const priced = useMemo(
    () => pool.filter((r) => r[period] != null && !outliers.has(r.t)),
    [pool, period, outliers],
  );
  const gainers = useMemo(
    () => [...priced].sort((a, b) => b[period]! - a[period]!).slice(0, TOP_N),
    [priced, period],
  );
  const losers = useMemo(
    () => [...priced].sort((a, b) => a[period]! - b[period]!).slice(0, TOP_N),
    [priced, period],
  );
  const surges = useMemo(() => {
    if (hasVol) {
      return pool
        .filter((r) => !outliers.has(r.t) && r[volKey] != null && r[volKey]! >= SURGE[volKey])
        .sort((a, b) => b[volKey]! - a[volKey]!);
    }
    return [];
  }, [pool, volKey, hasVol, outliers]);
  /** 거래량 이력이 쌓이기 전: 스냅샷 회전율(일평균 거래대금 / 순자산). 두 단위가 같을 때만. */
  const turnover = useMemo(() => {
    if (hasVol || file.adv_unit !== unit) return [];
    return pool
      .filter((r) => r.adv != null && (r.aum ?? 0) > 0)
      .map((r) => ({ r, t: (100 * r.adv!) / r.aum! }))
      .sort((a, b) => b.t - a.t)
      .slice(0, TOP_N);
  }, [pool, hasVol, file.adv_unit, unit]);

  const up = priced.filter((r) => r[period]! > 0).length;
  const down = priced.filter((r) => r[period]! < 0).length;
  const med = median(priced.map((r) => r[period]!));
  const surgeSet = useMemo(() => new Set(surges.map((r) => r.t)), [surges]);

  const groups = useMemo(() => {
    const acc = new Map<string, { rows: EtfUniverseRow[]; w: number; sum: number; aum: number; surge: number }>();
    for (const r of pool) {
      if (outliers.has(r.t)) continue;
      const key = r[groupDim];
      if (!key || key === "시장 전체(분산)") continue;
      const g = acc.get(key) || { rows: [], w: 0, sum: 0, aum: 0, surge: 0 };
      g.rows.push(r);
      g.aum += r.aum ?? 0;
      if (surgeSet.has(r.t)) g.surge += 1;
      const v = r[period];
      if (v != null) {
        const w = Math.sqrt(r.aum ?? 0);
        g.sum += v * w;
        g.w += w;
      }
      acc.set(key, g);
    }
    return [...acc.entries()]
      .filter(([, g]) => g.w > 0 && g.rows.length >= 2)
      .map(([label, g]) => {
        const ret = g.sum / g.w;
        const best = [...g.rows]
          .filter((r) => r[period] != null)
          .sort((a, b) => Math.abs(b[period]!) - Math.abs(a[period]!))[0];
        return { label, ret, count: g.rows.length, aum: g.aum, surge: g.surge, best };
      })
      .sort((a, b) => b.ret - a.ret);
  }, [pool, groupDim, period, surgeSet, outliers]);
  const maxAbs = Math.max(1, ...groups.map((g) => Math.abs(g.ret)));

  const pLabel = PERIOD_LABEL[period];
  const retAsOf = file.returns_as_of || asOfDay(file.as_of);

  return (
    <div className="etfmv">
      <div className="etfmv-head">
        <div>
          <h3 className="etfdb-detail-title">
            {MARKET_LABEL[market]} 상장 · 등락·거래량 시그널
          </h3>
          <p className="meta-soft">
            순자산 {fmtAum(minAum(unit), unit)} 이상 {pool.length.toLocaleString("ko-KR")}종 · 수익률{" "}
            {file.returns_as_of ? `${file.returns_as_of} 종가` : `${asOfDay(file.as_of)} 스냅샷`} · 거래량{" "}
            {hasVol ? `${file.returns_as_of} 종가 기준(직전 20거래일 평균 대비)` : "이력 집계 전"}
            {outliers.size ? ` · ${PERIOD_LABEL[period]} ±${OUTLIER[period]}%(단기자금 ±${OUTLIER[period] / 5}%) 초과 ${outliers.size}종은 시세 오류 의심으로 제외` : ""}
          </p>
        </div>
        <div className="etfmv-controls">
          <div className="seg" role="tablist" aria-label="기간">
            {periods.map((p) => (
              <button key={p} type="button" className={p === period ? "active" : ""} onClick={() => setPeriod(p)}>
                {PERIOD_LABEL[p]}
              </button>
            ))}
          </div>
          {hasVol ? (
            <div className="seg" role="tablist" aria-label="거래량 기준">
              {(["vr1", "vr5"] as VolKey[]).map((k) => (
                <button key={k} type="button" className={k === volKey ? "active" : ""} onClick={() => setVolKey(k)}>
                  거래량 {VOL_LABEL[k]}
                </button>
              ))}
            </div>
          ) : null}
          <label className="etfmv-check">
            <input type="checkbox" checked={withLev} onChange={(e) => setWithLev(e.target.checked)} />
            레버리지·인버스 포함
          </label>
        </div>
      </div>

      <div className="chip-row etfmv-ac">
        {acOptions.map((a) => (
          <button key={a} type="button" className={`chip ${a === ac ? "active" : ""}`} onClick={() => setAc(a)}>
            {a}
          </button>
        ))}
      </div>

      <div className="etfdb-stats etfmv-stats">
        <div>
          <div className="etfdb-stat-k">{pLabel} 상승 / 하락</div>
          <div className="etfdb-stat-v">
            <span className="up">{up.toLocaleString("ko-KR")}</span> /{" "}
            <span className="down">{down.toLocaleString("ko-KR")}</span>
          </div>
        </div>
        <div>
          <div className="etfdb-stat-k">{pLabel} 중앙값</div>
          <div className={`etfdb-stat-v ${signedClass(med)}`}>{fmtPct(med, 2)}</div>
        </div>
        <div>
          <div className="etfdb-stat-k">거래 급증 ({VOL_LABEL[volKey]} {SURGE[volKey]}배↑)</div>
          <div className="etfdb-stat-v">{hasVol ? `${surges.length.toLocaleString("ko-KR")}종` : "—"}</div>
        </div>
        <div>
          <div className="etfdb-stat-k">기준일</div>
          <div className="etfdb-stat-v etfmv-asof">{retAsOf || "—"}</div>
        </div>
      </div>

      <div className="etfmv-cols">
        <MoverList title={`${pLabel} 상승 상위`} tone="up" rows={gainers} period={period} unit={unit} />
        <MoverList title={`${pLabel} 하락 상위`} tone="down" rows={losers} period={period} unit={unit} />
        {hasVol ? (
          <section className="etfmv-list">
            <h4>
              거래 급증 · {VOL_LABEL[volKey]}
              <span className="meta-soft"> 직전 20일 평균 대비</span>
            </h4>
            {surges.length ? (
              <ol>
                {surges.slice(0, TOP_N).map((r) => (
                  <li key={r.t}>
                    <EtfName r={r} />
                    <span className="etfmv-val">
                      <strong>×{r[volKey]!.toFixed(1)}</strong>
                      <span className={signedClass(r[period])}>{fmtPct(r[period])}</span>
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="empty">기준을 넘은 ETF가 없습니다.</p>
            )}
          </section>
        ) : (
          <section className="etfmv-list">
            <h4>
              회전율 상위
              <span className="meta-soft"> 일평균 거래대금 / 순자산 · 스냅샷</span>
            </h4>
            <p className="meta-soft etfmv-note">
              일별 거래량은 평일 20:10 작업이 쌓기 시작했습니다. 25거래일이 모이기 전까지는 스냅샷 회전율을 보여 줍니다.
            </p>
            {turnover.length ? (
              <ol>
                {turnover.map(({ r, t }) => (
                  <li key={r.t}>
                    <EtfName r={r} />
                    <span className="etfmv-val">
                      <strong>{t.toFixed(1)}%</strong>
                      <span className={signedClass(r[period])}>{fmtPct(r[period])}</span>
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="empty">이 시장은 거래대금 단위가 순자산과 달라 회전율을 계산하지 않습니다.</p>
            )}
          </section>
        )}
      </div>

      <section className="etfmv-groups">
        <div className="etfmv-head">
          <h4>
            {GROUP_LABEL[groupDim]}별 {pLabel} 등락
            <span className="meta-soft"> √순자산 가중 · 2종 이상</span>
          </h4>
          <div className="seg" role="tablist" aria-label="묶음">
            {(["reg", "sec", "st"] as GroupDim[]).map((d) => (
              <button key={d} type="button" className={d === groupDim ? "active" : ""} onClick={() => setGroupDim(d)}>
                {GROUP_LABEL[d]}
              </button>
            ))}
          </div>
        </div>
        <div className="etfdb-table-wrap">
          <table className="etfdb-table etfmv-table">
            <thead>
              <tr>
                <th>{GROUP_LABEL[groupDim]}</th>
                <th className="num">{pLabel}</th>
                <th className="etfmv-bar-col" aria-hidden />
                <th className="num">종목</th>
                <th className="num">순자산</th>
                {hasVol ? <th className="num">거래 급증</th> : null}
                <th>가장 크게 움직인 ETF</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.label}>
                  <td>{g.label}</td>
                  <td className={`num ${signedClass(g.ret)}`}>{fmtPct(g.ret)}</td>
                  <td className="etfmv-bar-col">
                    <span className={`etfmv-bar ${g.ret >= 0 ? "pos" : "neg"}`}>
                      <i style={{ width: `${(50 * Math.abs(g.ret)) / maxAbs}%` }} />
                    </span>
                  </td>
                  <td className="num">{g.count.toLocaleString("ko-KR")}</td>
                  <td className="num">{fmtAum(g.aum, unit)}</td>
                  {hasVol ? <td className="num">{g.surge ? `${g.surge}종` : "—"}</td> : null}
                  <td className="meta-soft">
                    {g.best ? (
                      <>
                        <code>{g.best.t}</code> {g.best.n}{" "}
                        <span className={signedClass(g.best[period])}>{fmtPct(g.best[period])}</span>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function EtfName({ r }: { r: EtfUniverseRow }) {
  return (
    <span className="etfmv-name" title={r.bm ? `BM: ${r.bm}` : undefined}>
      <code>{r.t}</code>
      <span className="etfmv-n">
        {r.n}
        {r.lev && r.lev !== "일반" ? <span className="etfu-tag warn">{r.lev}</span> : null}
      </span>
      <span className="meta-soft etfmv-sub">{[r.reg, r.st || r.ac].filter(Boolean).join(" · ")}</span>
    </span>
  );
}

function MoverList({
  title,
  tone,
  rows,
  period,
  unit,
}: {
  title: string;
  tone: "up" | "down";
  rows: EtfUniverseRow[];
  period: Period;
  unit: string;
}) {
  return (
    <section className={`etfmv-list is-${tone}`}>
      <h4>{title}</h4>
      {rows.length ? (
        <ol>
          {rows.map((r) => (
            <li key={r.t}>
              <EtfName r={r} />
              <span className="etfmv-val">
                <strong className={signedClass(r[period])}>{fmtPct(r[period])}</strong>
                <span className="meta-soft">{fmtAum(r.aum, unit)}</span>
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="empty">수익률이 있는 ETF가 없습니다.</p>
      )}
    </section>
  );
}
