import type { ReactNode } from "react";

import { fmt, isNum, type AcwiStock } from "@/lib/acwiAnalyzer";

import type { Col } from "./AcwiTable";

/** Signed number: 상승 빨강 · 하락 파랑. */
export function Sg({ v, d = 1, suf = "%" }: { v: unknown; d?: number; suf?: string }) {
  if (!isNum(v)) return <>–</>;
  return (
    <span className={v > 0 ? "aa-pos" : v < 0 ? "aa-neg" : undefined}>
      {v > 0 ? "+" : ""}
      {fmt(v, d)}
      {suf}
    </span>
  );
}

export function MsBadge({ s }: { s: AcwiStock }) {
  const m = s.ms ?? "";
  if (m.startsWith("편출")) {
    return (
      <span className="aa-badge aa-b-del" title={`${s.er ?? ""} 리뷰 편출, ${s.ee ?? ""} 효력`}>
        편출 {s.er}
      </span>
    );
  }
  if (m.startsWith("구성")) return <span className="aa-badge aa-b-on">ACWI</span>;
  return <span className="aa-badge">{m || "?"}</span>;
}

export function Legend({ items }: { items: [string, string, boolean?][] }) {
  return (
    <div className="aa-legend">
      {items.map(([c, t, dash]) => (
        <span key={t}>
          <i
            style={{
              background: dash ? `repeating-linear-gradient(90deg, ${c} 0 4px, transparent 4px 7px)` : c,
            }}
          />
          {t}
        </span>
      ))}
    </div>
  );
}

export function Kpi({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="aa-kpi">
      <span>{label}</span>
      <b>{value}</b>
      {sub ? <small>{sub}</small> : null}
    </div>
  );
}

export function Card({ title, sub, children, className }: { title?: ReactNode; sub?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`aa-card${className ? ` ${className}` : ""}`}>
      {title ? <h3 className="aa-h">{title}</h3> : null}
      {sub ? <p className="aa-sub">{sub}</p> : null}
      {children}
    </section>
  );
}

export function nameCol<R extends { c?: string; n?: string; ct?: string }>(): Col<R> {
  return {
    k: "n",
    h: "종목",
    cls: "aa-name",
    f: (s) => (
      <>
        {s.n || s.c}
        <small>
          {s.c} · {s.ct ?? ""}
        </small>
      </>
    ),
  };
}
