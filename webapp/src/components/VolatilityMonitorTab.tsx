"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Brush,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  VOL_ASSET_GROUPS,
  VOL_MONITOR_RANGES,
  VOL_WINDOWS,
  defaultPairIds,
  lastPoint,
  meanVolInWindow,
  rollingReturnCorrelation,
  returnCorrelation,
  windowReturnCorrelation,
  type VolAssetId,
  type VolAssetSeries,
  type VolMonitorPayload,
  type VolMonitorRange,
  type VolWindow,
} from "@/lib/volatilityMonitor";

type BrushRange = { startIndex?: number; endIndex?: number };

function fmtVol(n?: number | null, digits = 1): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

function fmtCorr(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}`;
}

function fmtPct(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function corrTone(n?: number | null): "up" | "down" | "flat" {
  if (n == null) return "flat";
  if (n >= 0.4) return "up";
  if (n <= -0.2) return "down";
  return "flat";
}

const PRESETS: Array<{ label: string; a: VolAssetId; b: VolAssetId }> = [
  { label: "금 ↔ BTC", a: "gold", b: "btc" },
  { label: "금 ↔ WTI", a: "gold", b: "wti" },
  { label: "BTC ↔ SPY", a: "btc", b: "spy" },
  { label: "WTI ↔ VIX", a: "wti", b: "vix" },
  { label: "EWY ↔ EWJ", a: "ewy", b: "ewj" },
  { label: "EWY ↔ XLK", a: "ewy", b: "xlk" },
  { label: "XLK ↔ XLF", a: "xlk", b: "xlf" },
  { label: "EEM ↔ EFA", a: "eem", b: "efa" },
  { label: "DXY ↔ 금", a: "dxy", b: "gold" },
];

export default function VolatilityMonitorTab() {
  const defaults = defaultPairIds();
  const [range, setRange] = useState<VolMonitorRange>("1y");
  const [volWindow, setVolWindow] = useState<VolWindow>(20);
  const [assetA, setAssetA] = useState<VolAssetId>(defaults.a);
  const [assetB, setAssetB] = useState<VolAssetId>(defaults.b);
  const [data, setData] = useState<VolMonitorPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [brush, setBrush] = useState<BrushRange>({});

  const load = useCallback(async (r: VolMonitorRange) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/volatility-monitor?range=${encodeURIComponent(r)}`,
        { cache: "no-store" },
      );
      const json = (await res.json()) as VolMonitorPayload;
      if (!res.ok || !json.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      setData(json);
      setBrush({});
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(range);
  }, [load, range]);

  const byId = useMemo(() => {
    const map = new Map<VolAssetId, VolAssetSeries>();
    for (const a of data?.assets || []) map.set(a.id, a);
    return map;
  }, [data]);

  const seriesA = byId.get(assetA) || null;
  const seriesB = byId.get(assetB) || null;

  const volKey = volWindow === 60 ? "vol60_series" : "vol20_series";
  const latestVolKey = volWindow === 60 ? "vol60" : "vol20";

  const chartRows = useMemo(() => {
    if (!seriesA || !seriesB) return [];
    const mapA = new Map(seriesA[volKey].map((p) => [p.date, p.value]));
    const mapB = new Map(seriesB[volKey].map((p) => [p.date, p.value]));
    const dates = [
      ...new Set([...mapA.keys(), ...mapB.keys()]),
    ].sort();
    return dates
      .map((date) => ({
        date,
        volA: mapA.get(date) ?? null,
        volB: mapB.get(date) ?? null,
      }))
      .filter((r) => r.volA != null || r.volB != null);
  }, [seriesA, seriesB, volKey]);

  const corrSeries = useMemo(() => {
    if (!seriesA || !seriesB) return [];
    return rollingReturnCorrelation(
      seriesA.closes,
      seriesB.closes,
      volWindow,
    );
  }, [seriesA, seriesB, volWindow]);

  const corrRows = useMemo(
    () => corrSeries.map((p) => ({ date: p.date, corr: p.value })),
    [corrSeries],
  );

  const fullCorr = useMemo(() => {
    if (!seriesA || !seriesB) return null;
    return returnCorrelation(seriesA.closes, seriesB.closes);
  }, [seriesA, seriesB]);

  const latestCorr = lastPoint(corrSeries)?.value ?? null;

  const brushStats = useMemo(() => {
    if (!chartRows.length || !seriesA || !seriesB) return null;
    const start = brush.startIndex ?? 0;
    const end = brush.endIndex ?? chartRows.length - 1;
    if (start < 0 || end < start || end >= chartRows.length) return null;
    const startDate = chartRows[start]!.date;
    const endDate = chartRows[end]!.date;
    const volA = meanVolInWindow(seriesA[volKey], startDate, endDate);
    const volB = meanVolInWindow(seriesB[volKey], startDate, endDate);
    const corr = windowReturnCorrelation(
      seriesA.closes,
      seriesB.closes,
      startDate,
      endDate,
    );
    const fullLen = chartRows.length;
    const selectedLen = end - start + 1;
    const isPartial = selectedLen < fullLen;
    return { startDate, endDate, volA, volB, corr, isPartial };
  }, [brush, chartRows, seriesA, seriesB, volKey]);

  const corrDelta =
    brushStats?.corr != null && fullCorr != null
      ? brushStats.corr - fullCorr
      : null;

  function swapPair() {
    setAssetA(assetB);
    setAssetB(assetA);
    setBrush({});
  }

  function pickPreset(a: VolAssetId, b: VolAssetId) {
    setAssetA(a);
    setAssetB(b);
    setBrush({});
  }

  return (
    <section className="panel etfdb-panel volmon-panel">
      <div className="etfdb-hero">
        <div>
          <p className="eyebrow">원자재 · Volatility Monitor</p>
          <h2 className="kr-hero-title">Volatility Monitor</h2>
          <p className="meta-soft">
            원자재·가상자산·국가 ETF(EWY/EWJ 등)·미국 업종(XLK 등)의 실현변동성을
            페어로 비교합니다. 하단 브러시로 구간을 좁히면 그 시점의 평균
            변동성·수익률 상관계수가 함께 바뀝니다.
          </p>
        </div>
        <button
          type="button"
          className="tab-btn"
          onClick={() => void load(range)}
          disabled={loading}
        >
          {loading ? "로딩…" : "새로고침"}
        </button>
      </div>

      <div className="etfdb-stats volmon-stats">
        <div>
          <div className="etfdb-stat-k">{seriesA?.short || "A"} 변동성</div>
          <div className="etfdb-stat-v">
            {fmtVol(seriesA?.[latestVolKey] ?? null)}
          </div>
        </div>
        <div>
          <div className="etfdb-stat-k">{seriesB?.short || "B"} 변동성</div>
          <div className="etfdb-stat-v">
            {fmtVol(seriesB?.[latestVolKey] ?? null)}
          </div>
        </div>
        <div>
          <div className="etfdb-stat-k">롤링 상관 ({volWindow}d)</div>
          <div className={`etfdb-stat-v ${corrTone(latestCorr)}`}>
            {fmtCorr(latestCorr)}
          </div>
        </div>
        <div>
          <div className="etfdb-stat-k">전체 기간 상관</div>
          <div className={`etfdb-stat-v ${corrTone(fullCorr)}`}>
            {fmtCorr(fullCorr)}
          </div>
        </div>
      </div>

      <div className="chip-row geo-range-chips volmon-controls">
        <span className="meta-soft">기간</span>
        {VOL_MONITOR_RANGES.map((r) => (
          <button
            key={r}
            type="button"
            className={`tab-btn sub ${range === r ? "active" : ""}`}
            onClick={() => setRange(r)}
          >
            {r}
          </button>
        ))}
        <span className="meta-soft volmon-sep">창</span>
        {VOL_WINDOWS.map((w) => (
          <button
            key={w}
            type="button"
            className={`tab-btn sub ${volWindow === w ? "active" : ""}`}
            onClick={() => {
              setVolWindow(w);
              setBrush({});
            }}
          >
            {w}d
          </button>
        ))}
      </div>

      <div className="chip-row geo-range-chips volmon-presets">
        <span className="meta-soft">빠른 비교</span>
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            className={`tab-btn sub ${
              assetA === p.a && assetB === p.b ? "active" : ""
            }`}
            onClick={() => pickPreset(p.a, p.b)}
          >
            {p.label}
          </button>
        ))}
        <button type="button" className="tab-btn sub" onClick={swapPair}>
          A ↔ B
        </button>
      </div>

      <div className="volmon-pickers">
        {(["a", "b"] as const).map((role) => {
          const selected = role === "a" ? assetA : assetB;
          const setSelected = role === "a" ? setAssetA : setAssetB;
          const other = role === "a" ? assetB : assetA;
          return (
            <div key={role} className="volmon-picker">
              <div className="volmon-picker-head">
                <strong>{role === "a" ? "자산 A" : "자산 B"}</strong>
                <span className="meta-soft">
                  {byId.get(selected)?.label || selected}
                </span>
              </div>
              {VOL_ASSET_GROUPS.map((group) => (
                <div key={group} className="volmon-group">
                  <div className="volmon-group-label">{group}</div>
                  <div className="etfdbus-watch">
                    {(data?.assets || [])
                      .filter((a) => a.group === group)
                      .map((a) => (
                        <button
                          key={`${role}-${a.id}`}
                          type="button"
                          className={`etfdbus-watch-card ${
                            selected === a.id ? "active" : ""
                          }`}
                          disabled={a.id === other || !a.closes.length}
                          onClick={() => {
                            setSelected(a.id);
                            setBrush({});
                          }}
                          style={
                            selected === a.id
                              ? { borderColor: a.color }
                              : undefined
                          }
                        >
                          <strong style={{ color: a.color }}>{a.short}</strong>
                          <span>{fmtVol(a[latestVolKey])}</span>
                          <span className="meta-soft">
                            {fmtPct(a.change_pct)}
                          </span>
                        </button>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {error ? <p className="error-text">{error}</p> : null}
      {loading && !data ? (
        <p className="meta-soft">변동성 시계열 불러오는 중…</p>
      ) : null}

      {brushStats?.isPartial ? (
        <div className="volmon-brush-banner">
          <strong>
            선택 구간 {brushStats.startDate} → {brushStats.endDate}
          </strong>
          <span>
            평균 변동성 {seriesA?.short} {fmtVol(brushStats.volA)} ·{" "}
            {seriesB?.short} {fmtVol(brushStats.volB)}
          </span>
          <span className={corrTone(brushStats.corr)}>
            구간 상관 {fmtCorr(brushStats.corr)}
            {corrDelta != null
              ? ` (전체 대비 ${corrDelta >= 0 ? "+" : ""}${corrDelta.toFixed(2)})`
              : ""}
          </span>
        </div>
      ) : (
        <p className="meta-soft volmon-hint">
          차트 하단 브러시를 드래그해 시점을 좁히면, 그 구간의 변동성·상관계수를
          전체 기간과 바로 비교할 수 있습니다.
        </p>
      )}

      <div className="etfdb-chart etfdbus-chart-lg volmon-chart">
        <h3 className="etfdb-detail-title">
          실현변동성 비교 ({volWindow}d · 연율화 %)
        </h3>
        {chartRows.length ? (
          <div className="geo-chart-wrap" style={{ height: 340 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={chartRows}
                margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
              >
                <CartesianGrid
                  stroke="rgba(148,163,184,0.14)"
                  vertical={false}
                />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11, fill: "#8fa3b8" }}
                  minTickGap={28}
                  tickFormatter={(v: string) => String(v).slice(2)}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "#8fa3b8" }}
                  width={44}
                  tickFormatter={(v: number) => `${v.toFixed(0)}%`}
                />
                <Tooltip
                  formatter={(value, _name, item) => {
                    // Recharts passes Line `name` (display label), not dataKey —
                    // resolve via dataKey so A/B never collapse to the same label.
                    const key =
                      item && typeof item === "object" && "dataKey" in item
                        ? String((item as { dataKey?: unknown }).dataKey)
                        : "";
                    const label =
                      key === "volA"
                        ? seriesA?.short || "A"
                        : key === "volB"
                          ? seriesB?.short || "B"
                          : String(_name ?? "");
                    return [
                      typeof value === "number" ? `${value.toFixed(2)}%` : "—",
                      label,
                    ];
                  }}
                  labelFormatter={(label) => String(label)}
                  contentStyle={{
                    background: "rgba(15,23,42,0.92)",
                    border: "none",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="volA"
                  name={seriesA?.short || "A"}
                  stroke={seriesA?.color || "#d4a017"}
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="volB"
                  name={seriesB?.short || "B"}
                  stroke={seriesB?.color || "#f59e0b"}
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
                <Brush
                  dataKey="date"
                  height={28}
                  stroke="#64748b"
                  travellerWidth={8}
                  tickFormatter={(v: string) => String(v).slice(2)}
                  onChange={(next) => {
                    const n = next as BrushRange;
                    setBrush({
                      startIndex: n.startIndex,
                      endIndex: n.endIndex,
                    });
                  }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="geo-chart-empty">변동성 시계열 없음</div>
        )}
      </div>

      <div className="etfdb-chart etfdbus-chart-lg volmon-chart">
        <h3 className="etfdb-detail-title">
          롤링 상관계수 ({volWindow}d 수익률)
        </h3>
        <p className="meta-soft" style={{ marginBottom: 8 }}>
          두 자산의 일간 로그수익률 Pearson 상관. 0에 가까우면 디커플링, +1에
          가까우면 동조화입니다.
        </p>
        {corrRows.length ? (
          <div className="geo-chart-wrap" style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={corrRows}
                margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
              >
                <CartesianGrid
                  stroke="rgba(148,163,184,0.14)"
                  vertical={false}
                />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11, fill: "#8fa3b8" }}
                  minTickGap={28}
                  tickFormatter={(v: string) => String(v).slice(2)}
                />
                <YAxis
                  domain={[-1, 1]}
                  tick={{ fontSize: 11, fill: "#8fa3b8" }}
                  width={40}
                  tickFormatter={(v: number) => v.toFixed(1)}
                />
                <ReferenceLine y={0} stroke="rgba(148,163,184,0.45)" />
                <Tooltip
                  formatter={(value) =>
                    typeof value === "number" ? value.toFixed(3) : "—"
                  }
                  labelFormatter={(label) => String(label)}
                  contentStyle={{
                    background: "rgba(15,23,42,0.92)",
                    border: "none",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="corr"
                  name="상관"
                  stroke="#0ea5e9"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="geo-chart-empty">상관계수 시계열 없음</div>
        )}
      </div>

      <div className="etfdb-table-wrap" style={{ marginTop: 14 }}>
        <h3 className="etfdb-detail-title">유니버스 스냅샷</h3>
        <table className="etfdb-table">
          <thead>
            <tr>
              <th>자산</th>
              <th>그룹</th>
              <th className="num">가격</th>
              <th className="num">1D</th>
              <th className="num">Vol 20d</th>
              <th className="num">Vol 60d</th>
            </tr>
          </thead>
          <tbody>
            {(data?.assets || []).map((a) => (
              <tr
                key={a.id}
                className={
                  a.id === assetA || a.id === assetB ? "volmon-row-active" : ""
                }
              >
                <td>
                  <button
                    type="button"
                    className="volmon-link"
                    style={{ color: a.color }}
                    onClick={() => {
                      if (a.id === assetA || a.id === assetB) return;
                      setAssetB(a.id);
                      setBrush({});
                    }}
                  >
                    {a.label}
                  </button>
                </td>
                <td>{a.group}</td>
                <td className="num">
                  {a.price != null ? a.price.toLocaleString() : "—"}
                </td>
                <td
                  className={`num ${
                    (a.change_pct ?? 0) > 0
                      ? "up"
                      : (a.change_pct ?? 0) < 0
                        ? "down"
                        : ""
                  }`}
                >
                  {fmtPct(a.change_pct)}
                </td>
                <td className="num">{fmtVol(a.vol20)}</td>
                <td className="num">{fmtVol(a.vol60)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="meta-soft" style={{ marginTop: 10 }}>
        {data?.schedule_note || "—"}
        {data?.generated_at
          ? ` · 갱신 ${new Date(data.generated_at).toLocaleString("ko-KR")}`
          : ""}
      </p>
    </section>
  );
}
