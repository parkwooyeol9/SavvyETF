"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

const loading = () => <p className="empty">불러오는 중…</p>;
const MpAnalysisPanel = dynamic(() => import("@/components/MpAnalysisPanel"), { loading });
const UsPortfolioTab = dynamic(() => import("@/components/UsPortfolioTab"), { loading });

type View = "mp" | "sim";

const VIEWS: Array<{ id: View; label: string }> = [
  { id: "mp", label: "MP 분석" },
  { id: "sim", label: "시뮬레이션" },
];

export default function MpTab() {
  const [view, setView] = useState<View>("mp");
  return (
    <div className="panel-stack">
      <div className="seg" style={{ marginBottom: 12 }}>
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            className={view === v.id ? "active" : ""}
            onClick={() => setView(v.id)}
          >
            {v.label}
          </button>
        ))}
      </div>
      {view === "mp" ? <MpAnalysisPanel /> : <UsPortfolioTab />}
    </div>
  );
}
