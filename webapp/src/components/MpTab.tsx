"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

const loading = () => <p className="empty">불러오는 중…</p>;
const MpAnalysisPanel = dynamic(() => import("@/components/MpAnalysisPanel"), { loading });
const MpEtfPanel = dynamic(() => import("@/components/MpEtfPanel"), { loading });
const UsPortfolioTab = dynamic(() => import("@/components/UsPortfolioTab"), { loading });
const SimulateTab = dynamic(() => import("@/components/SimulateTab"), { loading });

type View = "mp" | "mpetf" | "sim" | "etf";

const VIEWS: Array<{ id: View; label: string }> = [
  { id: "mp", label: "MP-글로벌주식" },
  { id: "mpetf", label: "MP-ETF배분" },
  { id: "sim", label: "시뮬레이션" },
  { id: "etf", label: "시뮬레이션-ETF" },
];

/** `etf` is URL-backed (`?tab=simulate`) so old ETF 배분 links still land here. */
export default function MpTab({
  etf = false,
  onEtfChange,
}: {
  etf?: boolean;
  onEtfChange?: (etf: boolean) => void;
}) {
  const [inner, setInner] = useState<Exclude<View, "etf">>("mp");
  const view: View = etf ? "etf" : inner;
  const select = (v: View) => {
    if (v !== "etf") setInner(v);
    onEtfChange?.(v === "etf");
  };
  return (
    <div className="panel-stack">
      <div className="seg" style={{ marginBottom: 12 }}>
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            className={view === v.id ? "active" : ""}
            onClick={() => select(v.id)}
          >
            {v.label}
          </button>
        ))}
      </div>
      {view === "mp" ? (
        <MpAnalysisPanel />
      ) : view === "mpetf" ? (
        <MpEtfPanel />
      ) : view === "sim" ? (
        <UsPortfolioTab />
      ) : (
        <SimulateTab />
      )}
    </div>
  );
}
