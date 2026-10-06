"use client";

import { useMemo, useState } from "react";

import {
  ACWI_FACTORS,
  fmt,
  fmtCap,
  heatStyle,
  isDeleted,
  isNum,
  type AcwiNumKey,
  type AcwiStock,
  type AcwiSummary,
} from "@/lib/acwiAnalyzer";

import AcwiTable, { type Col } from "./AcwiTable";
import { MsBadge, nameCol, Sg } from "./parts";

type Row = AcwiStock & { zc?: number | null; rkc?: number };
type GroupId = "factor" | "tech" | "fund" | "msci";

const n1 = (k: AcwiNumKey, h: string, d: number, suf = "", t?: string): Col<Row> => ({ k, h, n: true, t, f: (s) => fmt(s[k], d, suf) });
const sg = (k: AcwiNumKey, h: string, d = 1): Col<Row> => ({ k, h, n: true, f: (s) => <Sg v={s[k]} d={d} /> });
const ht = (col: Col<Row>, lo: number, hi: number, inv = false): Col<Row> => ({
  ...col,
  heat: (s) => heatStyle((s as Record<string, unknown>)[col.k], lo, hi, inv),
});

const GROUPS: Record<GroupId, { h: string; cols: Col<Row>[] }> = {
  factor: {
    h: "팩터",
    cols: [
      { k: "rk", h: "순위", n: true, f: (s) => s.rk ?? "–" },
      ht(n1("z", "종합", 2), -2, 2),
      ...ACWI_FACTORS.map(([k, l]) => ht(n1(k, l, 2), -2, 2)),
      n1("pe", "PER", 1),
      n1("pb", "PBR", 2),
      n1("dy", "배당", 2, "%"),
      n1("roe", "ROE", 1, "%"),
    ],
  },
  tech: {
    h: "기술적",
    cols: [
      {
        k: "ts",
        h: "추세점수",
        n: true,
        t: "0~6: 종가>MA50, 종가>MA200, MA50>MA200, MACD>시그널, 40≤RSI≤70, 3M>0",
        f: (s) => (isNum(s.ts) ? `${s.ts}/6` : "–"),
        heat: (s) => heatStyle(s.ts, 0, 6),
      },
      sg("r1m", "1M"),
      sg("r3m", "3M"),
      sg("r12m", "12M", 0),
      sg("ytd", "YTD"),
      sg("ma50", "MA50 괴리"),
      sg("ma200", "MA200 괴리"),
      ht(n1("rsi", "RSI14", 0), 30, 70),
      sg("dd52", "52주고점比"),
      n1("vol", "변동성1Y", 0, "%"),
      n1("beta", "베타", 2),
      n1("mdd", "MDD1Y", 0, "%"),
      n1("liq", "거래대금20D", 0, "", "20일 평균 거래대금 근사 (백만$)"),
      ht(n1("vr", "거래량비", 2, "", "20일 ÷ 120일 평균 거래량"), 0.5, 1.5),
    ],
  },
  fund: {
    h: "EPS·BPS·배당",
    cols: [
      sg("er1", "EPS Δ1M"),
      sg("er3", "EPS Δ3M"),
      sg("er12", "EPS Δ12M", 0),
      sg("eg", "EPS g CY27", 0),
      sg("bg", "BPS Δ12M"),
      n1("dy", "배당", 2, "%"),
      sg("dg12", "DPS Δ12M"),
      { k: "cuts", h: "DPS삭감(36M)", n: true, f: (s) => s.cuts ?? "–" },
      ht(n1("pep", "PER 3Y위치", 0, "", "근사 PER 3년 백분위 (0=최저)"), 0, 100, true),
      ht(n1("pbp", "PBR 3Y위치", 0), 0, 100, true),
      ht(n1("dyp", "배당 3Y위치", 0), 0, 100),
      sg("sv3", "매출 Δ3M"),
      ht(n1("pep10", "PER 10Y위치", 0, "", "근사 PER 10년 백분위 (0=최저)"), 0, 100, true),
    ],
  },
  msci: {
    h: "MSCI",
    cols: [
      { k: "ms", h: "상태", f: (s) => <MsBadge s={s} /> },
      { k: "sr", h: "편입 리뷰", f: (s) => (s.sr === "<coverage" ? "2013-08 이전" : s.sr || "–") },
      { k: "w", h: "ACWI 비중", n: true, f: (s) => fmt((s.w ?? 0) * 100, 3, "%") },
      n1("tail", "국가 내 꼬리", 1, "", "국가 내 누적비중 위치(100=가장 작음)"),
      { k: "wr", h: "편출관찰 순위", n: true, v: (s) => s.wr ?? 1e9, f: (s) => s.wr ?? "–" },
      { k: "cap", h: "시총", n: true, f: (s) => fmtCap(s.cap) },
    ],
  },
};

type Preset = [string, (s: AcwiStock) => boolean, string | null];
const gt = (v: number | undefined, x: number) => isNum(v) && v > x;
const lt = (v: number | undefined, x: number) => isNum(v) && v < x;
const PRESETS: Preset[] = [
  ["전체", () => true, null],
  ["퀄리티+모멘텀", (s) => gt(s.fq, 0.5) && gt(s.fm, 0.5) && (s.ts ?? 0) >= 4, "z"],
  ["저평가+리비전↑", (s) => gt(s.fv, 0.5) && gt(s.er3, 2), "er3"],
  ["역사적 저PER", (s) => isNum(s.pep) && s.pep <= 10 && isNum(s.er3) && s.er3 >= 0, "pep:asc"],
  ["고배당 안정", (s) => isNum(s.dy) && s.dy >= 4 && s.cuts === 0, "dy"],
  ["과매도 반등후보", (s) => lt(s.rsi, 30) && gt(s.er3, 0), "rsi:asc"],
  ["추세 강세", (s) => (s.ts ?? 0) >= 6, "r3m"],
  ["리비전 하향", (s) => lt(s.er3, -5), "er3:asc"],
];

const DEFAULT_W = Object.fromEntries(ACWI_FACTORS.map(([k]) => [k, 1])) as Record<AcwiNumKey, number>;
const uniq = (rows: AcwiStock[], k: "rg" | "ct" | "s") =>
  [...new Set(rows.map((s) => s[k]).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, "ko"));

export default function AcwiScreener({ A, onPick }: { A: AcwiSummary; onPick: (code: string) => void }) {
  const [q, setQ] = useState("");
  const [rg, setRg] = useState("");
  const [ct, setCt] = useState("");
  const [sec, setSec] = useState("");
  const [ms, setMs] = useState("cur");
  const [preset, setPreset] = useState(0);
  const [group, setGroup] = useState<GroupId>("factor");
  const [W, setW] = useState(DEFAULT_W);

  const opts = useMemo(() => ({ rg: uniq(A.stocks, "rg"), ct: uniq(A.stocks, "ct"), s: uniq(A.stocks, "s") }), [A.stocks]);
  const custom = ACWI_FACTORS.some(([k]) => W[k] !== 1);

  /** 가중 평균 → 전체 Z 재표준화 → 순위 (analyzer.html recompute). */
  const scored: Row[] = useMemo(() => {
    if (!custom) return A.stocks;
    const tw = ACWI_FACTORS.reduce((a, [k]) => a + W[k], 0) || 1;
    const raw = A.stocks.map((s) =>
      ACWI_FACTORS.every(([k]) => isNum(s[k])) ? ACWI_FACTORS.reduce((a, [k]) => a + (s[k] as number) * W[k], 0) / tw : null,
    );
    const v = raw.filter(isNum);
    const mu = v.reduce((a, b) => a + b, 0) / v.length;
    const sd = Math.sqrt(v.reduce((a, b) => a + (b - mu) ** 2, 0) / (v.length - 1)) || 1;
    const rows: Row[] = A.stocks.map((s, i) => ({ ...s, zc: isNum(raw[i]) ? (raw[i] - mu) / sd : null }));
    rows
      .filter((s) => isNum(s.zc))
      .sort((a, b) => (b.zc as number) - (a.zc as number))
      .forEach((s, i) => (s.rkc = i + 1));
    return rows;
  }, [A.stocks, W, custom]);

  const P = PRESETS[preset];
  const rows = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return scored.filter(
      (s) =>
        (!qq || (s.n ?? "").toLowerCase().includes(qq) || s.c.toLowerCase().includes(qq) || (s.isin ?? "").toLowerCase().includes(qq)) &&
        (!rg || s.rg === rg) &&
        (!ct || s.ct === ct) &&
        (!sec || s.s === sec) &&
        (ms === "" ||
          (ms === "cur" && !isDeleted(s)) ||
          (ms === "del" && isDeleted(s)) ||
          (ms === "watch" && isNum(s.wr) && s.wr <= 200)) &&
        P[1](s),
    );
  }, [scored, q, rg, ct, sec, ms, P]);

  const { cols, sk, sd } = useMemo(() => {
    let cols: Col<Row>[] = [nameCol<Row>(), { k: "s", h: "섹터", f: (s) => s.s ?? "" }];
    if (group === "factor" && custom) {
      cols.push(
        { k: "rkc", h: "순위(가중)", n: true, f: (s) => s.rkc ?? "–" },
        { k: "zc", h: "종합(가중)", n: true, f: (s) => fmt(s.zc, 2), heat: (s) => heatStyle(s.zc, -2, 2) },
      );
    }
    cols = cols.concat(GROUPS[group].cols, group !== "msci" ? [{ k: "ms", h: "MSCI", f: (s) => <MsBadge s={s} /> }] : []);
    let sk = group === "factor" ? (custom ? "zc" : "z") : group === "tech" ? "ts" : group === "fund" ? "er3" : "wr";
    let sd: "asc" | "desc" = group === "msci" ? "asc" : "desc";
    if (P[2]) {
      const [k, d] = P[2].split(":");
      sk = k;
      sd = d === "asc" ? "asc" : "desc";
      if (!cols.find((c) => c.k === k)) cols.push({ k, h: k, n: true, f: (s) => fmt((s as Record<string, unknown>)[k], 1) });
    }
    return { cols, sk, sd };
  }, [group, custom, P]);

  return (
    <div className="aa-screener">
      <aside className="aa-ctl">
        <div className="aa-card aa-fields">
          <label className="aa-field">
            <span>검색</span>
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="종목명·코드·ISIN" />
          </label>
          {(
            [
              ["지역", rg, setRg, opts.rg],
              ["국가", ct, setCt, opts.ct],
              ["섹터", sec, setSec, opts.s],
            ] as const
          ).map(([label, val, set, list]) => (
            <label key={label} className="aa-field">
              <span>{label}</span>
              <select className="im-select" value={val} onChange={(e) => set(e.target.value)}>
                <option value="">전체</option>
                {list.map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
          ))}
          <label className="aa-field">
            <span>MSCI 상태</span>
            <select className="im-select" value={ms} onChange={(e) => setMs(e.target.value)}>
              <option value="cur">현재 구성 (5·8월 편출 제외)</option>
              <option value="">파일 전체</option>
              <option value="del">5·8월 편출 (파일에 남음)</option>
              <option value="watch">편출 관찰 상위 200</option>
            </select>
          </label>
          <div className="aa-field">
            <span>프리셋</span>
            <div className="aa-seg">
              {PRESETS.map((p, i) => (
                <button key={p[0]} type="button" className={`chip${i === preset ? " active" : ""}`} aria-pressed={i === preset} onClick={() => setPreset(i)}>
                  {p[0]}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="aa-card aa-fields">
          <div className="aa-field">
            <span>팩터 가중치 → 종합점수 재계산</span>
          </div>
          {ACWI_FACTORS.map(([k, l]) => (
            <label key={k} className="aa-wrow">
              <span>{l}</span>
              <input
                type="range"
                min={0}
                max={3}
                step={0.5}
                value={W[k]}
                onChange={(e) => setW((w) => ({ ...w, [k]: Number(e.target.value) }))}
              />
              <output>{W[k]}</output>
            </label>
          ))}
          <button type="button" className="chip" onClick={() => setW(DEFAULT_W)}>
            기본(동일가중)
          </button>
        </div>
      </aside>
      <div className="aa-card aa-tablebox">
        <div className="aa-tablehead">
          <h3 className="aa-h">
            {rows.length.toLocaleString()}개 종목 <span className="meta-soft">{P[0]}</span>
          </h3>
          <div className="aa-seg">
            {(Object.keys(GROUPS) as GroupId[]).map((g) => (
              <button key={g} type="button" className={`chip${g === group ? " active" : ""}`} aria-pressed={g === group} onClick={() => setGroup(g)}>
                {GROUPS[g].h}
              </button>
            ))}
          </div>
        </div>
        <div className="aa-scroll">
          <AcwiTable className="aa-tbl" cols={cols} rows={rows} sort={sk} dir={sd} limit={200} rowKey={(s) => s.c} onRow={(s) => onPick(s.c)} />
        </div>
      </div>
    </div>
  );
}
