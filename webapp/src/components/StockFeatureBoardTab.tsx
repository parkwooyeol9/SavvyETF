"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import { useAdminSession } from "@/components/AdminSession";
import type {
  StockBoardPick,
  StockFeatureBoardPayload,
} from "@/lib/stockFeatureBoard";

function PickCard({
  pick,
  tone,
}: {
  pick: StockBoardPick;
  tone: "up" | "down" | "flat";
}) {
  return (
    <article className={`geo-featured stockboard-card stockboard-${tone}`}>
      <header className="stockboard-card-head">
        <strong>{pick.ticker}</strong>
        <span className="meta-soft">{pick.name}</span>
        {pick.score != null ? (
          <span className="stockboard-score">{pick.score}</span>
        ) : null}
      </header>
      <p className="meta-soft" style={{ margin: "6px 0 0" }}>
        {pick.why || "—"}
      </p>
      {pick.tags?.length ? (
        <p className="meta-soft" style={{ marginTop: 6 }}>
          {pick.tags.map((t) => (
            <span key={t} className="chip" style={{ pointerEvents: "none" }}>
              {t}
            </span>
          ))}
        </p>
      ) : null}
    </article>
  );
}

export default function StockFeatureBoardTab() {
  const { secret, unlocked } = useAdminSession();
  const [data, setData] = useState<StockFeatureBoardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!unlocked || !secret) {
      setLoading(false);
      setData(null);
      setError("관리자 잠금 해제 후 종목보드를 볼 수 있습니다.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/stock-features", {
        headers: { Authorization: `Bearer ${secret}` },
      });
      const json = (await res.json()) as StockFeatureBoardPayload;
      setData(json);
      if (!json.ok && json.error) setError(json.error);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [secret, unlocked]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onUpload(e: FormEvent) {
    e.preventDefault();
    if (!unlocked || !secret) {
      setError("헤더에서 관리자 잠금을 먼저 해제해 주세요.");
      return;
    }
    if (!files.length) {
      setError("xlsx 파일을 1~4개 선택해 주세요.");
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      files.slice(0, 4).forEach((f, i) => form.append(`file${i}`, f));
      const res = await fetch("/api/stock-features", {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}` },
        body: form,
      });
      const json = (await res.json()) as StockFeatureBoardPayload;
      setData(json);
      if (!res.ok || !json.ok) {
        setError(json.error || "업로드·재가공 실패");
      } else {
        setFiles([]);
        if (inputRef.current) inputRef.current.value = "";
      }
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="geo-tab macro-tab">
      <section className="feature-block">
        <div className="feature-head geo-head-row">
          <div>
            <h2 className="feature-title">
              {data?.title_ko || "종목보드"}
            </h2>
            <p className="macro-subhead">
              관리자 전용. 종목·특성 엑셀을 열 역할 추론 후 AI(Gemini)로
              테마·후보·요약표로 재구성합니다. (최대 4개 xlsx)
            </p>
          </div>
          <button
            type="button"
            className="ghost-btn"
            disabled={loading || uploading || !unlocked}
            onClick={() => void load()}
          >
            {loading ? "불러오는 중…" : "새로고침"}
          </button>
        </div>

        {data?.generated_at ? (
          <p className="macro-schedule">
            갱신 {new Date(data.generated_at).toLocaleString("ko-KR")}
            {data.processor === "gemini"
              ? " · AI 재가공(gemini)"
              : " · 휴리스틱(키 없거나 AI 실패 시)"}
            {data.cached ? " · 저장본" : ""}
          </p>
        ) : null}

        {error ? <p className="empty warn">{error}</p> : null}
        {loading && !data ? <p className="empty">불러오는 중…</p> : null}

        {data?.headline_ko ? (
          <p className="meta-soft" style={{ marginBottom: 14, maxWidth: 720 }}>
            {data.headline_ko}
          </p>
        ) : null}

        {data?.themes?.length ? (
          <section className="geo-section">
            <h3 className="geo-section-title">테마</h3>
            <div className="stockboard-theme-grid">
              {data.themes.map((t) => (
                <div key={t.name} className="geo-featured">
                  <strong>{t.name}</strong>
                  <p className="meta-soft" style={{ margin: "6px 0" }}>
                    {t.summary}
                  </p>
                  {t.tickers.length ? (
                    <p className="meta-soft" style={{ margin: 0 }}>
                      {t.tickers.join(" · ")}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {data?.top_picks?.length ? (
          <section className="geo-section">
            <h3 className="geo-section-title">주목 후보</h3>
            <div className="stockboard-pick-grid">
              {data.top_picks.map((p) => (
                <PickCard key={`top-${p.ticker}-${p.name}`} pick={p} tone="up" />
              ))}
            </div>
          </section>
        ) : null}

        {data?.watchouts?.length ? (
          <section className="geo-section">
            <h3 className="geo-section-title">주의·회피</h3>
            <div className="stockboard-pick-grid">
              {data.watchouts.map((p) => (
                <PickCard
                  key={`w-${p.ticker}-${p.name}`}
                  pick={p}
                  tone="down"
                />
              ))}
            </div>
          </section>
        ) : null}

        {data?.tables?.map((tbl) => (
          <section key={tbl.title} className="geo-section">
            <h3 className="geo-section-title">{tbl.title}</h3>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    {tbl.columns.map((c) => (
                      <th key={c}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tbl.rows.map((row, i) => (
                    <tr key={i}>
                      {tbl.columns.map((_, j) => (
                        <td key={j}>{row[j] ?? ""}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}

        {data?.sources?.length ? (
          <section className="geo-section">
            <h3 className="geo-section-title">원본 · 열 프로파일</h3>
            <ul className="meta-soft" style={{ margin: 0, paddingLeft: 18 }}>
              {data.sources.map((s) => (
                <li key={s.filename} style={{ marginBottom: 8 }}>
                  <strong>{s.filename}</strong> · {s.sheet}
                  {s.header_row != null ? ` · 헤더행 ${s.header_row + 1}` : ""}
                  {" · "}
                  {s.rows}행 × {s.cols}열
                  {s.profile?.length ? (
                    <div style={{ marginTop: 4 }}>
                      {s.profile
                        .filter((p) =>
                          [
                            "ticker",
                            "name",
                            "score",
                            "rank",
                            "theme",
                            "sector",
                          ].includes(p.role),
                        )
                        .map(
                          (p) =>
                            `${p.name}→${p.role}${
                              p.mean != null ? `(μ${p.mean})` : ""
                            }`,
                        )
                        .join(" · ") || "핵심 열 미탐지"}
                    </div>
                  ) : s.headers?.length ? (
                    <div style={{ marginTop: 4 }}>
                      열: {s.headers.slice(0, 10).join(", ")}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {data?.notes?.length ? (
          <ul className="meta-soft" style={{ paddingLeft: 18 }}>
            {data.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        ) : null}

        {unlocked ? (
          <section className="geo-section" style={{ marginTop: 20 }}>
            <h3 className="geo-section-title">엑셀 업로드 · 재가공</h3>
            <p className="meta-soft">
              .xlsx 최대 4개(각 4MB). 업로드 시 헤더 자동 탐지 → 열 역할 추론 →
              상·하위 표본으로 Gemini 재작성. 상단에{" "}
              <strong>AI 재가공(gemini)</strong>이 보이면 성공입니다. heuristic만
              보이면 Vercel에 <code>GEMINI_API_KEY</code>를 확인하세요.
            </p>
            <form className="research-upload" onSubmit={(e) => void onUpload(e)}>
              <input
                ref={inputRef}
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                multiple
                onChange={(e) =>
                  setFiles(Array.from(e.target.files || []).slice(0, 4))
                }
              />
              <p className="meta-soft">
                {files.length
                  ? files.map((f) => f.name).join(" · ")
                  : "선택된 파일 없음"}
              </p>
              <button
                type="submit"
                className="tab-btn"
                disabled={uploading || !files.length}
              >
                {uploading ? "업로드·AI 재가공 중…" : "업로드하고 보드 갱신"}
              </button>
            </form>
          </section>
        ) : (
          <p className="meta-soft" style={{ marginTop: 16 }}>
            엑셀을 올리려면 헤더에서 관리자 잠금을 해제하세요.
          </p>
        )}
      </section>
    </div>
  );
}
