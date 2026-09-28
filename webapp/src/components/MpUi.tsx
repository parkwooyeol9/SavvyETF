"use client";

import type { MpSaveState } from "@/components/useSharedMpPortfolio";
import type { MpMetricSet } from "@/lib/mpCore";

export type Freq = "daily" | "weekly";

export const tooltipStyle = {
  background: "#141d2b",
  border: "1px solid #2b3648",
  borderRadius: 8,
  color: "#e8eef5",
  fontSize: 12,
};

export const STYLE_COLORS = ["#60a5fa", "#f59e0b", "#a78bfa", "#ef4444", "#f472b6", "#94a3b8"];

export function fmtPct(n?: number | null, digits = 2, sign = true): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const s = sign && n > 0 ? "+" : "";
  return `${s}${n.toFixed(digits)}%`;
}

export function fmtNum(n?: number | null, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

export function fmtPrice(n?: number | null, cur?: string): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const s = n >= 1000 ? n.toLocaleString("en-US", { maximumFractionDigits: 0 }) : n.toFixed(2);
  return cur && cur !== "USD" ? `${s} ${cur}` : `$${s}`;
}

export function tone(n?: number | null): string {
  if (n == null || !Number.isFinite(n) || Math.abs(n) < 1e-9) return "";
  return n > 0 ? "up" : "down";
}

export function heat(v: number, scale = 1): string {
  const x = Math.max(-1, Math.min(1, v / scale));
  return x >= 0 ? `rgba(52, 211, 153, ${0.08 + x * 0.42})` : `rgba(248, 113, 113, ${0.08 + -x * 0.42})`;
}

export function timeAgo(ts: number): string {
  if (!ts) return "";
  const m = Math.round((Date.now() - ts) / 60_000);
  if (m < 60) return `${Math.max(1, m)}분 전`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}시간 전`;
  return `${Math.round(h / 24)}일 전`;
}

export function FreqToggle({ freq, setFreq }: { freq: Freq; setFreq: (f: Freq) => void }) {
  return (
    <div className="seg">
      <button type="button" className={freq === "daily" ? "active" : ""} onClick={() => setFreq("daily")}>
        일간
      </button>
      <button type="button" className={freq === "weekly" ? "active" : ""} onClick={() => setFreq("weekly")}>
        주간
      </button>
    </div>
  );
}

export function MpEditStatus({
  canEdit,
  saveState,
  saveError,
}: {
  canEdit: boolean;
  saveState: MpSaveState;
  saveError: string | null;
}) {
  if (!canEdit) {
    return <p className="meta-soft">조회 전용 · 편입·리밸런싱은 관리자 로그인 후 수정할 수 있습니다.</p>;
  }
  if (saveState === "saving") return <p className="meta-soft">관리자 편집 중 · 저장 중…</p>;
  if (saveState === "error") return <p className="down">저장 실패: {saveError || "알 수 없는 오류"} — 다시 수정하면 재시도합니다.</p>;
  return (
    <p className="meta-soft">
      관리자 편집 모드 · {saveState === "saved" ? "저장됨 · " : ""}변경 사항은 서버에 저장되어 모든 사용자에게 같은 구성으로 표시됩니다.
    </p>
  );
}

export function Kpi({ label, v, cls }: { label: string; v: string; cls?: string }) {
  return (
    <div>
      <span className="meta-soft">{label}</span>
      <strong className={cls || ""}>{v}</strong>
    </div>
  );
}

export function Row({ label, v, cls }: { label: string; v: string; cls?: string }) {
  return (
    <tr>
      <td>{label}</td>
      <td className={`num ${cls || ""}`}>{v}</td>
    </tr>
  );
}

export function MetricsTable({ p, b, longDates = false }: { p: MpMetricSet; b: MpMetricSet; longDates?: boolean }) {
  const dt = (d?: string | null) => (d ? d.slice(longDates ? 2 : 5) : "");
  const rows: Array<[string, (x: MpMetricSet) => string, boolean?]> = [
    ["누적 수익률", (x) => fmtPct(x.total_return_pct), true],
    ["연환산 수익률", (x) => fmtPct(x.ann_return_pct), true],
    ["변동성 (연)", (x) => fmtPct(x.vol_pct, 2, false)],
    ["Sharpe", (x) => fmtNum(x.sharpe)],
    ["Sortino", (x) => fmtNum(x.sortino)],
    ["MDD", (x) => fmtPct(x.mdd_pct)],
    ["MDD 구간", (x) => (x.mdd_trough ? `${dt(x.mdd_peak)}→${dt(x.mdd_trough)}${x.mdd_recovery ? ` (회복 ${dt(x.mdd_recovery)})` : " (미회복)"}` : "—")],
    ["현재 낙폭", (x) => fmtPct(x.current_dd_pct)],
    ["Calmar", (x) => fmtNum(x.calmar)],
    ["VaR 95% (일)", (x) => fmtPct(x.var95_pct, 2, false)],
    ["CVaR 95% (일)", (x) => fmtPct(x.cvar95_pct, 2, false)],
    ["왜도 / 초과첨도", (x) => `${fmtNum(x.skew)} / ${fmtNum(x.kurtosis)}`],
    ["최고의 날", (x) => `${fmtPct(x.best_day_pct)} ${dt(x.best_day)}`],
    ["최악의 날", (x) => `${fmtPct(x.worst_day_pct)} ${dt(x.worst_day)}`],
    ["상승일 비율", (x) => fmtPct(x.win_rate_pct, 1, false)],
  ];
  return (
    <div className="table-wrap" style={{ marginTop: 8 }}>
      <table className="data-table">
        <thead>
          <tr>
            <th>지표</th>
            <th className="num">MP</th>
            <th className="num">BM</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, f, colored]) => (
            <tr key={label}>
              <td>{label}</td>
              <td className={`num ${colored ? tone(label.includes("연환산") ? p.ann_return_pct : p.total_return_pct) : ""}`}>{f(p)}</td>
              <td className={`num ${colored ? tone(label.includes("연환산") ? b.ann_return_pct : b.total_return_pct) : ""}`}>{f(b)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
