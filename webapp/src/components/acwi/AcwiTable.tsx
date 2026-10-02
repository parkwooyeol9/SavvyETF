"use client";

import { useMemo, useState, type CSSProperties, type ReactNode } from "react";

export type Col<R> = {
  k: string;
  h: string;
  n?: boolean;
  t?: string;
  cls?: string;
  /** Sort value (defaults to row[k]). */
  v?: (r: R) => unknown;
  f?: (r: R) => ReactNode;
  heat?: (r: R) => CSSProperties;
};

type Props<R> = {
  cols: Col<R>[];
  rows: R[];
  sort?: string | null;
  dir?: "asc" | "desc";
  limit?: number;
  rowKey: (r: R, i: number) => string;
  onRow?: (r: R) => void;
  className?: string;
};

const missing = (x: unknown) => x === null || x === undefined || (typeof x === "number" && !Number.isFinite(x));

/** Sortable table with "더 보기" paging (nulls always last), as in analyzer.html `table()`. */
export default function AcwiTable<R>({ cols, rows, sort = null, dir = "desc", limit = 300, rowKey, onRow, className }: Props<R>) {
  const [st, setSt] = useState<{ k: string | null; d: "asc" | "desc" }>({ k: sort, d: dir });
  const [lim, setLim] = useState(limit);
  const [prev, setPrev] = useState({ sort, dir, rows });
  if (prev.sort !== sort || prev.dir !== dir || prev.rows !== rows) {
    setPrev({ sort, dir, rows });
    setSt({ k: sort, d: dir });
    setLim(limit);
  }

  const sorted = useMemo(() => {
    if (!st.k) return rows;
    const c = cols.find((x) => x.k === st.k);
    const g = c?.v ?? ((r: R) => (r as Record<string, unknown>)[st.k as string]);
    const sign = st.d === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = g(a);
      const y = g(b);
      const nx = missing(x);
      const ny = missing(y);
      if (nx && ny) return 0;
      if (nx) return 1;
      if (ny) return -1;
      return ((x as number) < (y as number) ? -1 : (x as number) > (y as number) ? 1 : 0) * sign;
    });
  }, [rows, cols, st]);

  return (
    <>
      <table className={className}>
        <thead>
          <tr>
            {cols.map((c) => (
              <th
                key={c.k}
                className={c.n ? "n" : undefined}
                title={c.t}
                aria-sort={st.k === c.k ? (st.d === "asc" ? "ascending" : "descending") : undefined}
                onClick={() => setSt((s) => ({ k: c.k, d: s.k === c.k && s.d === "desc" ? "asc" : "desc" }))}
              >
                {c.h}
                {st.k === c.k ? (st.d === "asc" ? " ▲" : " ▼") : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.slice(0, lim).map((r, i) => (
            <tr
              key={rowKey(r, i)}
              className={onRow ? "aa-click" : undefined}
              tabIndex={onRow ? 0 : undefined}
              onClick={onRow ? () => onRow(r) : undefined}
              onKeyDown={onRow ? (e) => e.key === "Enter" && onRow(r) : undefined}
            >
              {cols.map((c) => (
                <td key={c.k} className={[c.n ? "n" : "", c.cls ?? ""].join(" ").trim() || undefined} style={c.heat?.(r)}>
                  {c.f ? c.f(r) : String((r as Record<string, unknown>)[c.k] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {sorted.length > lim ? (
        <div className="aa-more">
          <button type="button" className="chip" onClick={() => setLim((l) => l + limit)}>
            더 보기 ({(sorted.length - lim).toLocaleString()}개 남음)
          </button>
        </div>
      ) : null}
    </>
  );
}
