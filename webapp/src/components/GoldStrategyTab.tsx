"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  positionSizeContracts,
  type GoldPlaybook,
  type GoldRuleEval,
  type GoldRuleStatus,
  type GoldStrategyPayload,
} from "@/lib/goldStrategy";

function fmtPx(n?: number | null, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: Math.min(digits, 2),
  });
}

function fmtChg(n?: number | null, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}`;
}

function statusClass(s: GoldRuleStatus): string {
  if (s === "pass") return "up";
  if (s === "fail") return "down";
  return "";
}

function statusLabel(s: GoldRuleStatus): string {
  if (s === "pass") return "충족";
  if (s === "fail") return "미충족";
  if (s === "unavailable") return "데이터 없음";
  return "참고";
}

function actionClass(action: GoldPlaybook["action"]): string {
  if (action === "buy") return "up";
  if (action === "sell") return "down";
  return "";
}

function RuleTable({
  title,
  rules,
  hint,
}: {
  title: string;
  rules: GoldRuleEval[];
  hint?: string;
}) {
  return (
    <div className="etfdb-table-wrap" style={{ marginTop: 10 }}>
      <h3 className="etfdb-detail-title" style={{ marginBottom: 6 }}>
        {title}
      </h3>
      {hint ? <p className="meta-soft">{hint}</p> : null}
      <table className="etfdb-table">
        <thead>
          <tr>
            <th>조건</th>
            <th>상태</th>
            <th>세부</th>
          </tr>
        </thead>
        <tbody>
          {rules.map((r) => (
            <tr key={r.id}>
              <td>{r.label}</td>
              <td className={`num ${statusClass(r.status)}`}>
                {statusLabel(r.status)}
              </td>
              <td className="meta-soft">{r.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PlaybookPanel({ playbook }: { playbook: GoldPlaybook }) {
  return (
    <div className="geo-composite macro-stress" style={{ marginTop: 12 }}>
      <div
        className="geo-score-ring"
        data-level={
          playbook.action === "buy"
            ? "cool"
            : playbook.action === "sell"
              ? "hot"
              : "warm"
        }
      >
        <span className={`geo-score-num ${actionClass(playbook.action)}`}>
          {playbook.action_ko}
        </span>
        <span className="geo-score-label">
          {playbook.buy_hits}/{playbook.buy_needed} · {playbook.score}
        </span>
      </div>
      <div className="geo-composite-body">
        <h3>{playbook.title}</h3>
        <p className="geo-thesis">{playbook.summary}</p>
        <div className="macro-snap-grid" style={{ marginTop: 12 }}>
          <article className="macro-snap-card">
            <span className="macro-snap-label">진입</span>
            <strong className="macro-snap-value" style={{ fontSize: "0.92rem" }}>
              {playbook.entry}
            </strong>
          </article>
          <article className="macro-snap-card">
            <span className="macro-snap-label">손절</span>
            <strong className="macro-snap-value" style={{ fontSize: "0.92rem" }}>
              {playbook.stop}
            </strong>
          </article>
          <article className="macro-snap-card">
            <span className="macro-snap-label">목표가</span>
            <strong className="macro-snap-value" style={{ fontSize: "0.92rem" }}>
              {playbook.targets.join(" · ") || "—"}
            </strong>
          </article>
          <article className="macro-snap-card">
            <span className="macro-snap-label">무효</span>
            <strong className="macro-snap-value" style={{ fontSize: "0.92rem" }}>
              {playbook.invalidation}
            </strong>
          </article>
        </div>
        {playbook.rr != null ? (
          <p className="meta-soft" style={{ marginTop: 10 }}>
            추정 손익비 {playbook.rr.toFixed(2)} · 위험/온스 $
            {fmtPx(playbook.risk_per_unit)} · 보상/온스 $
            {fmtPx(playbook.reward_per_unit)}
          </p>
        ) : null}
        {playbook.risk_notes.length ? (
          <ul className="panel-sub" style={{ marginTop: 8 }}>
            {playbook.risk_notes.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

export default function GoldStrategyTab() {
  const [data, setData] = useState<GoldStrategyPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [account, setAccount] = useState(10_000);
  const [riskPct, setRiskPct] = useState(1);
  const [presetId, setPresetId] = useState<"mgc" | "gc" | "gld_share">("mgc");
  const [entryOverride, setEntryOverride] = useState<string>("");
  const [stopOverride, setStopOverride] = useState<string>("");

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch("/api/gold-strategy");
      const json = (await res.json()) as GoldStrategyPayload;
      if (!res.ok || !json.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      setData(json);
      setError(null);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "로드 실패");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const preset =
    data?.position_presets.find((p) => p.id === presetId) ||
    data?.position_presets[0] ||
    null;

  const entryPx = useMemo(() => {
    const raw = entryOverride.trim();
    if (raw) {
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    }
    return data?.macro.gc ?? null;
  }, [entryOverride, data]);

  const stopPx = useMemo(() => {
    const raw = stopOverride.trim();
    if (raw) {
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    }
    return data?.playbook.suggested_stop ?? null;
  }, [stopOverride, data]);

  const sizing = useMemo(() => {
    if (!preset || entryPx == null || stopPx == null) return null;
    return positionSizeContracts({
      account,
      riskPct,
      entry: entryPx,
      stop: stopPx,
      multiplier: preset.multiplier,
    });
  }, [preset, account, riskPct, entryPx, stopPx]);

  const chartData = useMemo(() => {
    const series = data?.chart || [];
    return series.map((c) => ({
      label: c.date.slice(2),
      close: c.close,
      sma20: c.sma20,
      sma50: c.sma50,
    }));
  }, [data]);

  return (
    <section className="panel etfdb-panel">
      <div className="etfdb-hero">
        <div>
          <h2 className="kr-hero-title">금 매매 전략</h2>
          <p className="kr-note">
            일봉 추세 + 실질금리 + DXY + 손절/손익비 + 원/달러.{" "}
            {data?.schedule_note}
          </p>
        </div>
        <div className="etfdb-hero-actions">
          <button type="button" className="tab-btn" onClick={() => void load()}>
            새로고침
          </button>
        </div>
      </div>

      {loading && !data ? <p className="empty">금 전략 불러오는 중…</p> : null}
      {error ? <p className="empty">오류: {error}</p> : null}

      {data ? (
        <>
          <p className="kr-note">{data.source}</p>
          <p className="meta-soft">{data.note}</p>
          <p className="meta-soft">{data.feasibility.verdict}</p>

          <div className="etfdb-stats">
            <div>
              <div className="etfdb-stat-k">GC=F</div>
              <div className="etfdb-stat-v">{fmtPx(data.macro.gc)}</div>
            </div>
            <div>
              <div className="etfdb-stat-k">실질금리</div>
              <div className="etfdb-stat-v">
                {fmtPx(data.macro.real_yield, 3)}
                <span className="meta-soft" style={{ marginLeft: 6 }}>
                  5d {fmtChg(data.macro.real_yield_chg_5d, 3)}
                </span>
              </div>
            </div>
            <div>
              <div className="etfdb-stat-k">DXY</div>
              <div className="etfdb-stat-v">
                {fmtPx(data.macro.dxy)}
                <span className="meta-soft" style={{ marginLeft: 6 }}>
                  SMA20 {fmtPx(data.macro.dxy_sma20)}
                </span>
              </div>
            </div>
            <div>
              <div className="etfdb-stat-k">원/달러</div>
              <div className="etfdb-stat-v">
                {fmtPx(data.macro.usdkrw, 1)}
                <span className="meta-soft" style={{ marginLeft: 6 }}>
                  5d {fmtChg(data.macro.usdkrw_chg_5d_pct, 1)}%
                </span>
              </div>
            </div>
          </div>

          <PlaybookPanel playbook={data.playbook} />

          <div className="etfdbus-chart-head" style={{ marginTop: 14 }}>
            <h3 className="etfdb-detail-title" style={{ margin: 0 }}>
              GC=F · SMA20 / SMA50
            </h3>
            <span className="meta-soft">
              ATR14 {fmtPx(data.macro.atr14)} · 20일고점{" "}
              {fmtPx(data.macro.prior_20d_high)}
            </span>
          </div>
          <div className="etfdb-chart etfdbus-chart-lg">
            {chartData.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={chartData}
                  margin={{ top: 8, right: 12, left: 4, bottom: 4 }}
                >
                  <CartesianGrid
                    stroke="rgba(43,54,72,0.8)"
                    strokeDasharray="3 3"
                  />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: "#8fa3b8", fontSize: 11 }}
                    minTickGap={28}
                  />
                  <YAxis
                    domain={["auto", "auto"]}
                    tick={{ fill: "#8fa3b8", fontSize: 11 }}
                    width={64}
                    tickFormatter={(v) => fmtPx(Number(v), 0)}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "#141d2b",
                      border: "1px solid #2b3648",
                    }}
                    formatter={(v) => fmtPx(typeof v === "number" ? v : null)}
                  />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="close"
                    name="GC=F"
                    stroke="#fbbf24"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="sma20"
                    name="SMA20"
                    stroke="#34d399"
                    strokeWidth={1.4}
                    dot={false}
                    connectNulls
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="sma50"
                    name="SMA50"
                    stroke="#a78bfa"
                    strokeWidth={1.4}
                    dot={false}
                    connectNulls
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <p className="empty">차트 없음</p>
            )}
          </div>

          <RuleTable
            title="매수 조건 (3개 이상 충족 시 검토)"
            hint="고점 추격보다 돌파 → 되돌림 → 지지 확인 후 진입"
            rules={data.buy_rules}
          />
          <RuleTable
            title="매도·청산 조건"
            hint="RSI 70 무조건 매도는 채택하지 않음"
            rules={data.sell_rules}
          />
          <RuleTable title="기본 전술 체크" rules={data.tactics} />

          <div className="geo-composite" style={{ marginTop: 14 }}>
            <div className="geo-composite-body" style={{ width: "100%" }}>
              <h3 className="etfdb-detail-title">포지션 사이징</h3>
              <p className="meta-soft">
                수량 = (계좌 × 허용손실률) ÷ (|진입 − 손절| × 승수). MGC 승수 10,
                GC 승수 100.
              </p>
              <div
                className="etfdb-toolbar"
                style={{ flexWrap: "wrap", gap: 10, marginTop: 8 }}
              >
                <label className="meta-soft">
                  계좌($)
                  <input
                    className="etfdb-search"
                    type="number"
                    min={100}
                    step={100}
                    value={account}
                    onChange={(e) => setAccount(Number(e.target.value) || 0)}
                    style={{ marginLeft: 6, width: 120 }}
                  />
                </label>
                <label className="meta-soft">
                  허용손실(%)
                  <input
                    className="etfdb-search"
                    type="number"
                    min={0.1}
                    max={5}
                    step={0.1}
                    value={riskPct}
                    onChange={(e) => setRiskPct(Number(e.target.value) || 0)}
                    style={{ marginLeft: 6, width: 80 }}
                  />
                </label>
                <label className="meta-soft">
                  상품
                  <select
                    className="etfdb-search"
                    value={presetId}
                    onChange={(e) =>
                      setPresetId(e.target.value as "mgc" | "gc" | "gld_share")
                    }
                    style={{ marginLeft: 6 }}
                  >
                    {(data.position_presets || []).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label} (×{p.multiplier})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="meta-soft">
                  진입
                  <input
                    className="etfdb-search"
                    type="number"
                    placeholder={fmtPx(data.macro.gc)}
                    value={entryOverride}
                    onChange={(e) => setEntryOverride(e.target.value)}
                    style={{ marginLeft: 6, width: 110 }}
                  />
                </label>
                <label className="meta-soft">
                  손절
                  <input
                    className="etfdb-search"
                    type="number"
                    placeholder={fmtPx(data.playbook.suggested_stop)}
                    value={stopOverride}
                    onChange={(e) => setStopOverride(e.target.value)}
                    style={{ marginLeft: 6, width: 110 }}
                  />
                </label>
              </div>
              {preset ? <p className="meta-soft">{preset.note}</p> : null}
              <div className="macro-snap-grid" style={{ marginTop: 10 }}>
                <article className="macro-snap-card">
                  <span className="macro-snap-label">권장 수량</span>
                  <strong className="macro-snap-value">
                    {sizing
                      ? sizing.contracts.toFixed(2)
                      : "—"}
                  </strong>
                  <em className="macro-snap-sub">
                    {presetId === "gld_share" ? "주" : "계약"}
                  </em>
                </article>
                <article className="macro-snap-card">
                  <span className="macro-snap-label">허용 손실액</span>
                  <strong className="macro-snap-value">
                    ${fmtPx(sizing?.dollarRisk ?? null, 0)}
                  </strong>
                </article>
                <article className="macro-snap-card">
                  <span className="macro-snap-label">계약당 위험</span>
                  <strong className="macro-snap-value">
                    ${fmtPx(sizing?.perContractRisk ?? null, 0)}
                  </strong>
                </article>
                <article className="macro-snap-card">
                  <span className="macro-snap-label">추정 RR</span>
                  <strong className="macro-snap-value">
                    {data.playbook.rr != null
                      ? data.playbook.rr.toFixed(2)
                      : "—"}
                  </strong>
                </article>
              </div>
            </div>
          </div>

          <div className="geo-composite" style={{ marginTop: 14 }}>
            <div className="geo-composite-body" style={{ width: "100%" }}>
              <h3 className="etfdb-detail-title">원화 투자자 프레이밍</h3>
              <p className="geo-thesis">{data.krw_framing.note}</p>
              <div className="macro-snap-grid" style={{ marginTop: 10 }}>
                <article className="macro-snap-card">
                  <span className="macro-snap-label">달러 금</span>
                  <strong className="macro-snap-value">
                    ${fmtPx(data.krw_framing.usd_gold)}
                  </strong>
                </article>
                <article className="macro-snap-card">
                  <span className="macro-snap-label">원/달러</span>
                  <strong className="macro-snap-value">
                    {fmtPx(data.krw_framing.usdkrw, 1)}
                  </strong>
                </article>
                <article className="macro-snap-card">
                  <span className="macro-snap-label">원화 환산/oz</span>
                  <strong className="macro-snap-value">
                    ₩
                    {data.krw_framing.implied_krw_per_oz != null
                      ? Math.round(
                          data.krw_framing.implied_krw_per_oz,
                        ).toLocaleString("ko-KR")
                      : "—"}
                  </strong>
                </article>
              </div>
              <p className="meta-soft" style={{ marginTop: 8 }}>
                {data.event_risk.note}
              </p>
            </div>
          </div>

          <div style={{ marginTop: 14 }}>
            <h3 className="etfdb-detail-title">구현 범위 (타당성)</h3>
            <div className="macro-snap-grid macro-snap-grid-wide">
              <article className="macro-snap-card">
                <span className="macro-snap-label">즉시 가능</span>
                <ul className="panel-sub">
                  {data.feasibility.ready.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </article>
              <article className="macro-snap-card">
                <span className="macro-snap-label">후속</span>
                <ul className="panel-sub">
                  {data.feasibility.deferred.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </article>
              <article className="macro-snap-card">
                <span className="macro-snap-label">미채택</span>
                <ul className="panel-sub">
                  {data.feasibility.rejected.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </article>
            </div>
          </div>

          <p className="meta-soft" style={{ marginTop: 12 }}>
            스냅샷 {data.generated_at_display} · {data.macro.real_yield_source}
            {data.macro.mm_as_of ? ` · MM 보고일 ${data.macro.mm_as_of}` : ""}
          </p>
        </>
      ) : null}
    </section>
  );
}
