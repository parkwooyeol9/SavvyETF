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
  leverageNotionalNote,
  positionSizeContracts,
  type MetalId,
  type MetalPanel,
  type MetalPlaybook,
  type PreciousMetalsPayload,
  type RuleEval,
  type RuleStatus,
  type SignalStrength,
} from "@/lib/preciousMetals";

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

function statusClass(s: RuleStatus): string {
  if (s === "pass") return "up";
  if (s === "fail") return "down";
  return "";
}

function statusLabel(s: RuleStatus): string {
  if (s === "pass") return "충족";
  if (s === "fail") return "미충족";
  if (s === "unavailable") return "데이터 없음";
  return "참고";
}

function strengthClass(s: SignalStrength): string {
  if (s === "strong_buy" || s === "buy") return "up";
  if (s === "strong_sell" || s === "sell") return "down";
  return "";
}

function actionClass(action: MetalPlaybook["action"]): string {
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
  rules: RuleEval[];
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

function PlaybookPanel({ panel }: { panel: MetalPanel }) {
  const { playbook: pb } = panel;
  const lev = pb.leverage;
  return (
    <div className="geo-composite macro-stress" style={{ marginTop: 12 }}>
      <div
        className="geo-score-ring"
        data-level={
          lev.strength === "strong_buy" || lev.strength === "buy"
            ? "cool"
            : lev.strength === "strong_sell" || lev.strength === "sell"
              ? "hot"
              : "warm"
        }
      >
        <span className={`geo-score-num ${actionClass(pb.action)}`}>
          {pb.action_ko}
        </span>
        <span className="geo-score-label">
          {pb.buy_hits}/{pb.buy_needed} · {fmtChg(lev.suggested, 1)}×
        </span>
      </div>
      <div className="geo-composite-body">
        <h3>{pb.title}</h3>
        <p className="geo-thesis">{pb.summary}</p>
        <p className={`meta-soft ${strengthClass(lev.strength)}`} style={{ marginTop: 6 }}>
          신호 {lev.strength_ko} · 권장 배율 {fmtChg(lev.suggested, 1)}× (밴드{" "}
          {fmtChg(lev.min, 1)} ~ {fmtChg(lev.max, 1)}) · 방향{" "}
          {lev.direction === "long"
            ? "롱"
            : lev.direction === "short"
              ? "숏/인버스"
              : "플랫"}
        </p>
        <div className="macro-snap-grid" style={{ marginTop: 12 }}>
          <article className="macro-snap-card">
            <span className="macro-snap-label">진입</span>
            <strong className="macro-snap-value" style={{ fontSize: "0.92rem" }}>
              {pb.entry}
            </strong>
          </article>
          <article className="macro-snap-card">
            <span className="macro-snap-label">손절</span>
            <strong className="macro-snap-value" style={{ fontSize: "0.92rem" }}>
              {pb.stop}
            </strong>
          </article>
          <article className="macro-snap-card">
            <span className="macro-snap-label">목표가</span>
            <strong className="macro-snap-value" style={{ fontSize: "0.92rem" }}>
              {pb.targets.join(" · ") || "—"}
            </strong>
          </article>
          <article className="macro-snap-card">
            <span className="macro-snap-label">무효</span>
            <strong className="macro-snap-value" style={{ fontSize: "0.92rem" }}>
              {pb.invalidation}
            </strong>
          </article>
        </div>
        {pb.rr != null ? (
          <p className="meta-soft" style={{ marginTop: 10 }}>
            추정 RR {pb.rr.toFixed(2)} · 위험/온스 ${fmtPx(pb.risk_per_unit)} ·
            보상/온스 ${fmtPx(pb.reward_per_unit)}
          </p>
        ) : null}
        <p className="meta-soft" style={{ marginTop: 6 }}>
          수단: {lev.instruments.join(" · ")}
        </p>
        {lev.risk_caps.length || pb.risk_notes.length ? (
          <ul className="panel-sub" style={{ marginTop: 8 }}>
            {[...pb.risk_notes, ...lev.risk_caps].slice(0, 7).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

export default function PreciousMetalsTab() {
  const [data, setData] = useState<PreciousMetalsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [focus, setFocus] = useState<MetalId>("gold");
  const [account, setAccount] = useState(10_000);
  const [riskPct, setRiskPct] = useState(1);
  const [presetId, setPresetId] = useState<string>("");
  const [entryOverride, setEntryOverride] = useState("");
  const [stopOverride, setStopOverride] = useState("");

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch("/api/precious-metals");
      const json = (await res.json()) as PreciousMetalsPayload;
      if (!res.ok || !json.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      setData(json);
      setFocus(json.focus_default || "gold");
      const firstPreset = json.metals.find((m) => m.id === json.focus_default)
        ?.position_presets[0];
      setPresetId(firstPreset?.id || json.metals[0]?.position_presets[0]?.id || "");
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

  const panel = useMemo(
    () => data?.metals.find((m) => m.id === focus) || data?.metals[0] || null,
    [data, focus],
  );

  useEffect(() => {
    if (!panel) return;
    const ok = panel.position_presets.some((p) => p.id === presetId);
    if (!ok) setPresetId(panel.position_presets[0]?.id || "");
  }, [panel, presetId]);

  const preset =
    panel?.position_presets.find((p) => p.id === presetId) ||
    panel?.position_presets[0] ||
    null;

  const entryPx = useMemo(() => {
    const raw = entryOverride.trim();
    if (raw) {
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    }
    return panel?.snapshot.price ?? null;
  }, [entryOverride, panel]);

  const stopPx = useMemo(() => {
    const raw = stopOverride.trim();
    if (raw) {
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    }
    return panel?.playbook.suggested_stop ?? null;
  }, [stopOverride, panel]);

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
    return (panel?.chart || []).map((c) => ({
      label: c.date.slice(2),
      close: c.close,
      sma20: c.sma20,
      sma50: c.sma50,
    }));
  }, [panel]);

  const levSuggested = panel?.playbook.leverage.suggested ?? 0;

  return (
    <section className="panel etfdb-panel">
      <div className="etfdb-hero">
        <div>
          <h2 className="kr-hero-title">귀금속 · 금·은 타이밍</h2>
          <p className="kr-note">
            선물 가정 · 롱 최대 +10배 · 숏/인버스 최대 −10배. 강한 매수→레버리지
            롱, 강한 매도→공매도. {data?.schedule_note}
          </p>
        </div>
        <div className="etfdb-hero-actions">
          <button type="button" className="tab-btn" onClick={() => void load()}>
            새로고침
          </button>
        </div>
      </div>

      {loading && !data ? <p className="empty">귀금속 불러오는 중…</p> : null}
      {error ? <p className="empty">오류: {error}</p> : null}

      {data ? (
        <>
          <p className="kr-note">{data.source}</p>
          <p className="meta-soft">{data.note}</p>
          <p className="meta-soft">{data.leverage_policy.note}</p>

          <div className="etfdb-stats">
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
              <div className="etfdb-stat-k">금은비</div>
              <div className="etfdb-stat-v">
                {fmtPx(data.macro.gold_silver_ratio, 1)}
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

          <div className="etfdbus-watch" style={{ marginTop: 10 }}>
            {data.metals.map((m) => {
              const lev = m.playbook.leverage;
              return (
                <button
                  key={m.id}
                  type="button"
                  className={`etfdbus-watch-card ${focus === m.id ? "active" : ""}`}
                  onClick={() => setFocus(m.id)}
                >
                  <strong>
                    {m.label} · {lev.strength_ko}
                  </strong>
                  <span className={strengthClass(lev.strength)}>
                    {fmtPx(m.snapshot.price)} · {fmtChg(lev.suggested, 1)}×
                  </span>
                  <span>
                    매수 {m.playbook.buy_hits}/{m.playbook.buy_needed} · 매도{" "}
                    {m.playbook.sell_hits} · ATR%{" "}
                    {fmtPx(m.snapshot.atr_pct, 2)}
                  </span>
                  <span className={signedTone(m.snapshot.chg_5d_pct)}>
                    5d {fmtChg(m.snapshot.chg_5d_pct, 1)}%
                  </span>
                </button>
              );
            })}
          </div>

          {panel ? (
            <>
              <PlaybookPanel panel={panel} />

              <div className="etfdbus-chart-head" style={{ marginTop: 14 }}>
                <h3 className="etfdb-detail-title" style={{ margin: 0 }}>
                  {panel.yahoo} · SMA20 / SMA50
                </h3>
                <span className="meta-soft">
                  ATR14 {fmtPx(panel.snapshot.atr14)} · 20일고점{" "}
                  {fmtPx(panel.snapshot.prior_20d_high)}
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
                        formatter={(v) =>
                          fmtPx(typeof v === "number" ? v : null)
                        }
                      />
                      <Legend />
                      <Line
                        type="monotone"
                        dataKey="close"
                        name={panel.yahoo}
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
                title={`${panel.label} 매수 조건 (3개 이상 → 롱 검토)`}
                hint="강한 매수(5+) + 50일선 위 → 레버리지 롱(+3~+10)"
                rules={panel.buy_rules}
              />
              <RuleTable
                title={`${panel.label} 매도·청산 조건`}
                hint="강한 매도(2+) + 50일선 이탈 → 공매도/인버스(−3~−10)"
                rules={panel.sell_rules}
              />
              <RuleTable title="기본 전술" rules={panel.tactics} />

              <div className="geo-composite" style={{ marginTop: 14 }}>
                <div className="geo-composite-body" style={{ width: "100%" }}>
                  <h3 className="etfdb-detail-title">
                    포지션 사이징 · 레버리지 명목
                  </h3>
                  <p className="meta-soft">
                    수량 = (계좌 × 허용손실률) ÷ (|진입 − 손절| × 승수). 배율은
                    방향·강도 지침이며, 계좌 위험금액은 배율과 무관하게
                    유지합니다.
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
                        onChange={(e) =>
                          setAccount(Number(e.target.value) || 0)
                        }
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
                        onChange={(e) =>
                          setRiskPct(Number(e.target.value) || 0)
                        }
                        style={{ marginLeft: 6, width: 80 }}
                      />
                    </label>
                    <label className="meta-soft">
                      상품
                      <select
                        className="etfdb-search"
                        value={presetId}
                        onChange={(e) => setPresetId(e.target.value)}
                        style={{ marginLeft: 6 }}
                      >
                        {(panel.position_presets || []).map((p) => (
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
                        placeholder={fmtPx(panel.snapshot.price)}
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
                        placeholder={fmtPx(panel.playbook.suggested_stop)}
                        value={stopOverride}
                        onChange={(e) => setStopOverride(e.target.value)}
                        style={{ marginLeft: 6, width: 110 }}
                      />
                    </label>
                  </div>
                  {preset ? <p className="meta-soft">{preset.note}</p> : null}
                  <p className="meta-soft">
                    {leverageNotionalNote(levSuggested, account)}
                  </p>
                  <div className="macro-snap-grid" style={{ marginTop: 10 }}>
                    <article className="macro-snap-card">
                      <span className="macro-snap-label">권장 수량</span>
                      <strong className="macro-snap-value">
                        {sizing ? sizing.contracts.toFixed(2) : "—"}
                      </strong>
                      <em className="macro-snap-sub">계약</em>
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
                      <span className="macro-snap-label">권장 배율</span>
                      <strong
                        className={`macro-snap-value ${strengthClass(panel.playbook.leverage.strength)}`}
                      >
                        {fmtChg(levSuggested, 1)}×
                      </strong>
                    </article>
                  </div>
                </div>
              </div>
            </>
          ) : null}

          <div className="geo-composite" style={{ marginTop: 14 }}>
            <div className="geo-composite-body" style={{ width: "100%" }}>
              <h3 className="etfdb-detail-title">원화 투자자 프레이밍</h3>
              <p className="geo-thesis">{data.krw_framing.note}</p>
              <div className="macro-snap-grid" style={{ marginTop: 10 }}>
                <article className="macro-snap-card">
                  <span className="macro-snap-label">달러 금</span>
                  <strong className="macro-snap-value">
                    ${fmtPx(data.krw_framing.gold_usd)}
                  </strong>
                </article>
                <article className="macro-snap-card">
                  <span className="macro-snap-label">달러 은</span>
                  <strong className="macro-snap-value">
                    ${fmtPx(data.krw_framing.silver_usd)}
                  </strong>
                </article>
                <article className="macro-snap-card">
                  <span className="macro-snap-label">원화 금/oz</span>
                  <strong className="macro-snap-value">
                    ₩
                    {data.krw_framing.gold_krw_oz != null
                      ? Math.round(data.krw_framing.gold_krw_oz).toLocaleString(
                          "ko-KR",
                        )
                      : "—"}
                  </strong>
                </article>
                <article className="macro-snap-card">
                  <span className="macro-snap-label">원화 은/oz</span>
                  <strong className="macro-snap-value">
                    ₩
                    {data.krw_framing.silver_krw_oz != null
                      ? Math.round(
                          data.krw_framing.silver_krw_oz,
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

          <p className="meta-soft" style={{ marginTop: 12 }}>
            스냅샷 {data.generated_at_display} · {data.macro.real_yield_source} ·{" "}
            {data.feasibility.verdict}
          </p>
        </>
      ) : null}
    </section>
  );
}

function signedTone(n?: number | null): string {
  if (n == null || n === 0) return "";
  return n > 0 ? "up" : "down";
}
