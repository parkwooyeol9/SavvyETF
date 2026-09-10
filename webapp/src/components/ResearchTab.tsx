"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAdminSession } from "@/components/AdminSession";

import {
  DEFAULT_RESEARCH_YEAR,
  RESEARCH_CATEGORY_OPTIONS,
  RESEARCH_CLASSIFY_OPTIONS,
  RESEARCH_CHUNK_BYTES,
  RESEARCH_MAX_PDF_BYTES,
  RESEARCH_PROXY_PDF_BYTES,
  RESEARCH_YEAR_OPTIONS,
  composeResearchDate,
  dateFromFilename,
  formatResearchDate,
  isResearchDate,
  researchYear,
  titleFromFilename,
  type ResearchCategory,
} from "@/lib/researchMeta";

type ResearchItem = {
  id: string;
  title: string;
  category: ResearchCategory;
  published_at: string;
  summary: string;
  filename: string;
  key: string;
  url: string;
  size: number;
  uploaded_at: string;
};

const MONTHS = [
  { id: "", label: "월 생략" },
  ...Array.from({ length: 12 }, (_, i) => {
    const id = String(i + 1).padStart(2, "0");
    return { id, label: `${i + 1}월` };
  }),
];

function daysInMonth(year: string, month: string): number {
  if (!month) return 0;
  const y = Number(year);
  const m = Number(month);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function friendlyError(msg: string): string {
  if (/Failed to fetch|NetworkError|Load failed|network/i.test(msg)) {
    return "연결이 끊겼습니다. 같은 파일을 다시 선택해 이어서 올려 주세요.";
  }
  if (/R2 not configured/i.test(msg) || /저장소/.test(msg)) {
    return "리서치 저장소가 아직 연결되지 않았습니다. 배포 환경의 R2 설정을 확인해 주세요.";
  }
  if (/관리자 비밀번호가 아직/.test(msg)) {
    return "관리자 비밀번호가 아직 설정되지 않았습니다. 카드뉴스와 같은 관리자 비밀번호를 사용할 수 있습니다.";
  }
  return msg;
}

function formatDay(date: string): string {
  return formatResearchDate(date);
}

function categoryLabel(id: ResearchCategory): string {
  return RESEARCH_CATEGORY_OPTIONS.find((c) => c.id === id)?.label || id;
}

function titleFromFile(file: File): string {
  return titleFromFilename(file.name);
}

function publishedAtForFile(file: File, fallback: string): string {
  return dateFromFilename(file.name) || fallback;
}

function sortFilesByDate(list: File[]): File[] {
  return [...list].sort((a, b) => {
    const da = dateFromFilename(a.name) || "";
    const db = dateFromFilename(b.name) || "";
    if (da !== db) return db.localeCompare(da);
    return a.name.localeCompare(b.name, "ko");
  });
}

function formatSize(bytes: number): string {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function mediaUrl(item: ResearchItem, download = false): string {
  const params = new URLSearchParams();
  if (item.url.includes("?")) {
    const existing = new URL(item.url, "https://local.invalid");
    existing.searchParams.forEach((value, key) => params.set(key, value));
  }
  if (download) params.set("download", "1");
  params.set("filename", item.filename || "paper.pdf");
  const base = item.url.split("?")[0] || item.url;
  return `${base}?${params.toString()}`;
}

export default function ResearchTab() {
  const { secret, unlocked } = useAdminSession();
  const [items, setItems] = useState<ResearchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [open, setOpen] = useState<ResearchItem | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<ResearchCategory | "all">("all");
  const [year, setYear] = useState<string>("all");
  const [sort, setSort] = useState<"newest" | "oldest">("newest");
  const [publishedYear, setPublishedYear] = useState(DEFAULT_RESEARCH_YEAR);
  const [publishedMonth, setPublishedMonth] = useState("");
  const [publishedDay, setPublishedDay] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [applyCategory, setApplyCategory] = useState<ResearchCategory>("quant");
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/research", { cache: "no-store" });
      const json = (await res.json()) as {
        ok: boolean;
        items?: ResearchItem[];
        error?: string;
      };
      if (!res.ok || !json.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      setItems(json.items || []);
      setError(null);
    } catch (exc) {
      setError(friendlyError(exc instanceof Error ? exc.message : "로드 실패"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const years = useMemo(() => {
    const set = new Set(items.map((item) => researchYear(item.published_at)));
    return [...set].sort((a, b) => b.localeCompare(a));
  }, [items]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const next = items.filter((item) => {
      if (category !== "all" && item.category !== category) return false;
      if (year !== "all" && researchYear(item.published_at) !== year) return false;
      if (!q) return true;
      return (
        item.title.toLowerCase().includes(q) ||
        (item.summary || "").toLowerCase().includes(q)
      );
    });
    next.sort((a, b) => {
      const cmp = a.published_at.localeCompare(b.published_at);
      return sort === "newest" ? -cmp : cmp;
    });
    return next;
  }, [items, category, year, query, sort]);

  const dayOptions = useMemo(() => {
    const max = daysInMonth(publishedYear, publishedMonth);
    return [
      { id: "", label: "일 생략" },
      ...Array.from({ length: max }, (_, i) => {
        const id = String(i + 1).padStart(2, "0");
        return { id, label: `${i + 1}일` };
      }),
    ];
  }, [publishedYear, publishedMonth]);

  function pickFiles(list: FileList | File[] | null) {
    const next = [...(list || [])].filter(
      (f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name),
    );
    if (!next.length) {
      setError("PDF 파일만 올릴 수 있습니다.");
      return;
    }
    setError(null);
    setFiles(sortFilesByDate(next));
  }

  async function uploadViaProxy(file: File, publishedAt: string, title: string) {
    const body = new FormData();
    body.set("title", title);
    body.set("category", "pending");
    body.set("published_at", publishedAt);
    body.set("filename", file.name);
    body.set(
      "file",
      new File([file], "upload.pdf", { type: file.type || "application/pdf" }),
    );
    const res = await fetch("/api/research", {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}` },
      body,
    });
    const json = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok || !json.ok) {
      throw new Error(json.error || `${file.name} 업로드 실패`);
    }
  }

  async function uploadViaChunks(file: File, publishedAt: string, title: string) {
    const headers = { Authorization: `Bearer ${secret}` };
    const presignRes = await fetch("/api/research/presign", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        published_at: publishedAt,
        filename: file.name,
        size: file.size,
        chunked: true,
      }),
    });
    const slot = (await presignRes.json()) as {
      ok?: boolean;
      error?: string;
      id?: string;
      key?: string;
      token?: string;
    };
    if (!presignRes.ok || !slot.ok || !slot.id || !slot.key || !slot.token) {
      throw new Error(slot.error || `${file.name} 업로드 준비 실패`);
    }
    const total = Math.max(1, Math.ceil(file.size / RESEARCH_CHUNK_BYTES));
    for (let part = 0; part < total; part += 1) {
      setProgress(`${title} · 조각 ${part + 1}/${total}`);
      const start = part * RESEARCH_CHUNK_BYTES;
      const blob = file.slice(
        start,
        Math.min(file.size, start + RESEARCH_CHUNK_BYTES),
      );
      let lastErr: Error | null = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const body = new FormData();
          body.set("id", slot.id);
          body.set("key", slot.key);
          body.set("token", slot.token);
          body.set("published_at", publishedAt);
          body.set("filename", file.name);
          body.set("part", String(part));
          body.set("total", String(total));
          body.set("file", new File([blob], "chunk.bin"));
          const res = await fetch("/api/research/chunk", {
            method: "POST",
            headers,
            body,
          });
          const json = (await res.json()) as { ok?: boolean; error?: string };
          if (!res.ok || !json.ok) {
            throw new Error(json.error || `${file.name} 조각 업로드 실패`);
          }
          lastErr = null;
          break;
        } catch (exc) {
          lastErr = exc instanceof Error ? exc : new Error(String(exc));
          if (attempt === 2) throw lastErr;
          await new Promise((r) => window.setTimeout(r, 400 * (attempt + 1)));
        }
      }
      if (lastErr) throw lastErr;
    }
    const done = await fetch("/api/research/complete", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        id: slot.id,
        key: slot.key,
        token: slot.token,
        title,
        published_at: publishedAt,
        filename: file.name,
        parts: total,
      }),
    });
    const json = (await done.json()) as { ok?: boolean; error?: string };
    if (!done.ok || !json.ok) {
      throw new Error(json.error || `${file.name} 등록 실패`);
    }
  }

  async function uploadOne(file: File, fallbackDate: string) {
    if (file.size > RESEARCH_MAX_PDF_BYTES) {
      throw new Error(
        `${file.name}은 25MB를 넘습니다. 용량을 줄이거나 나눠 올려 주세요.`,
      );
    }
    const title = titleFromFile(file);
    const publishedAt = publishedAtForFile(file, fallbackDate);
    if (file.size <= RESEARCH_PROXY_PDF_BYTES) {
      try {
        await uploadViaProxy(file, publishedAt, title);
        return;
      } catch (exc) {
        const msg = exc instanceof Error ? exc.message : String(exc);
        const network = /Failed to fetch|NetworkError|Load failed/i.test(msg);
        if (!network) throw exc instanceof Error ? exc : new Error(msg);
      }
    }
    await uploadViaChunks(file, publishedAt, title);
  }

  async function onUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!secret) {
      setError("관리자 인증이 필요합니다.");
      return;
    }
    if (!files.length) {
      setError("PDF 파일을 선택해 주세요.");
      return;
    }
    const publishedAt = composeResearchDate(
      publishedYear,
      publishedMonth,
      publishedDay,
    );
    if (!isResearchDate(publishedAt)) {
      setError("발간 연도를 확인해 주세요. 월·일은 생략할 수 있습니다.");
      return;
    }
    const queue = [...files];
    setBusy(true);
    setError(null);
    const failed: string[] = [];
    const failedFiles: File[] = [];
    let ok = 0;
    try {
      for (let i = 0; i < queue.length; i += 1) {
        const file = queue[i]!;
        setProgress(`${i + 1}/${queue.length} 올리는 중… ${titleFromFile(file)}`);
        try {
          await uploadOne(file, publishedAt);
          ok += 1;
        } catch (exc) {
          failedFiles.push(file);
          failed.push(
            `${titleFromFile(file)}: ${
              exc instanceof Error ? exc.message : "업로드 실패"
            }`,
          );
        }
        if (i < queue.length - 1) {
          await new Promise((r) => window.setTimeout(r, 120));
        }
      }
      setFiles(failedFiles);
      setCategory("pending");
      setYear("all");
      setSelected([]);
      if (inputRef.current) inputRef.current.value = "";
      await load();
      if (failed.length) {
        setError(
          `${ok}편 업로드, ${failed.length}편 실패. 남은 파일을 다시 올려 주세요. ${failed.slice(0, 3).join(" · ")}`,
        );
      }
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  async function onDelete(id: string) {
    await onDeleteMany([id]);
  }

  async function onDeleteMany(ids: string[]) {
    if (!secret || !ids.length) return;
    const ok = window.confirm(
      ids.length === 1
        ? "이 리서치를 삭제할까요?"
        : `선택한 ${ids.length}편을 삭제할까요? 삭제 후 다시 한꺼번에 올릴 수 있습니다.`,
    );
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/research", {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${secret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ids }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        throw new Error(json.error || "삭제 실패");
      }
      if (open && ids.includes(open.id)) setOpen(null);
      setSelected((cur) => cur.filter((id) => !ids.includes(id)));
      await load();
    } catch (exc) {
      setError(friendlyError(exc instanceof Error ? exc.message : "삭제 실패"));
    } finally {
      setBusy(false);
    }
  }

  function toggleSelected(id: string) {
    setSelected((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id],
    );
  }

  async function onClassify(ids: string[], nextCategory: ResearchCategory) {
    if (!secret || !ids.length) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/research", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${secret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ids, category: nextCategory }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        throw new Error(json.error || "분류 실패");
      }
      setSelected((cur) => cur.filter((id) => !ids.includes(id)));
      await load();
    } catch (exc) {
      setError(friendlyError(exc instanceof Error ? exc.message : "분류 실패"));
    } finally {
      setBusy(false);
    }
  }

  const pendingCount = items.filter((item) => item.category === "pending").length;
  const visibleIds = filtered.map((item) => item.id);

  return (
    <div className="edu-tab research-tab">
      <section className="feature-block">
        <div className="cardnews-head">
          <div>
            <h1 className="feature-title">리서치</h1>
            <p className="feature-lead">
              PDF를 한꺼번에 올린 뒤, 아래에서 퀀트·AI·ETF·ESG·크립토·지정학으로
              분류합니다. 업로드·삭제는 오른쪽 위 관리자 로그인 후에 열립니다.
            </p>
          </div>
        </div>

        {unlocked ? (
          <form className="research-upload" onSubmit={(e) => void onUpload(e)}>
            <p className="research-upload-step">
              1. PDF를 한꺼번에 올립니다. 파일명 끝 날짜(예: 20260107)를
              읽어 발간일로 정렬하고, 유형은 올린 뒤에 붙입니다.
            </p>
            <div className="research-upload-dates">
              <label>
                날짜 없을 때 연도
                <select
                  value={publishedYear}
                  onChange={(e) => {
                    setPublishedYear(e.target.value);
                    setPublishedDay("");
                  }}
                >
                  {RESEARCH_YEAR_OPTIONS.map((y) => (
                    <option key={y} value={y}>
                      {y}년
                    </option>
                  ))}
                </select>
              </label>
              <label>
                월 (선택)
                <select
                  value={publishedMonth}
                  onChange={(e) => {
                    setPublishedMonth(e.target.value);
                    setPublishedDay("");
                  }}
                >
                  {MONTHS.map((m) => (
                    <option key={m.id || "none"} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                일 (선택)
                <select
                  value={publishedDay}
                  onChange={(e) => setPublishedDay(e.target.value)}
                  disabled={!publishedMonth}
                >
                  {dayOptions.map((d) => (
                    <option key={d.id || "none"} value={d.id}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div
              className={`cardnews-drop ${dragging ? "dragging" : ""}`}
              onDragEnter={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                const next = e.relatedTarget as Node | null;
                if (!next || !e.currentTarget.contains(next)) setDragging(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                pickFiles(e.dataTransfer.files);
              }}
            >
              <p>
                리포트를 여러 장 끌어다 놓으세요. 용량이 달라도 한 번에 올릴 수
                있습니다. 파일명 끝의 8자리 날짜(예: _20260827)를 자동으로
                인식합니다. 날짜가 없으면 {publishedYear}년을 씁니다. 파일당
                최대 25MB.
              </p>
              <input
                ref={inputRef}
                type="file"
                accept="application/pdf,.pdf"
                multiple
                hidden
                onChange={(e) => {
                  pickFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              <div className="research-file-row">
                <button
                  type="button"
                  className="chip"
                  onClick={() => inputRef.current?.click()}
                >
                  PDF 여러 장 선택
                </button>
                <span className="meta-soft">
                  {files.length
                    ? `${files.length}개 · ${formatSize(
                        files.reduce((n, f) => n + f.size, 0),
                      )}`
                    : "선택된 파일 없음"}
                </span>
              </div>
              {files.length ? (
                <ul className="research-file-list">
                  {files.map((file) => {
                    const parsed = dateFromFilename(file.name);
                    return (
                      <li key={`${file.name}-${file.size}`}>
                        <span>
                          {titleFromFile(file)}
                          <em className="research-file-date">
                            {parsed
                              ? formatResearchDate(parsed)
                              : `날짜 없음 · ${publishedYear}년`}
                          </em>
                        </span>
                        <span>{formatSize(file.size)}</span>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>
            <button type="submit" className="community-submit" disabled={busy}>
              {busy
                ? progress || "올리는 중…"
                : files.length
                  ? `선택한 ${files.length}편 올리기`
                  : "PDF를 선택한 뒤 올리기"}
            </button>
          </form>
        ) : null}

        {error ? <p className="empty warn">{error}</p> : null}
      </section>

      <section className="feature-block">
        <div className="research-filters">
          <div className="chip-row community-filters" role="tablist" aria-label="유형">
            <button
              type="button"
              className={`chip ${category === "all" ? "active" : ""}`}
              onClick={() => setCategory("all")}
            >
              전체
            </button>
            {RESEARCH_CATEGORY_OPTIONS.filter(
              (c) => c.id !== "pending" || pendingCount > 0 || unlocked,
            ).map((c) => (
              <button
                key={c.id}
                type="button"
                className={`chip ${category === c.id ? "active" : ""}`}
                onClick={() => setCategory(c.id)}
              >
                {c.id === "pending" && pendingCount
                  ? `${c.label} ${pendingCount}`
                  : c.label}
              </button>
            ))}
          </div>
          {years.length ? (
            <div className="chip-row" role="tablist" aria-label="발간 연도">
              <button
                type="button"
                className={`chip ${year === "all" ? "active" : ""}`}
                onClick={() => setYear("all")}
              >
                모든 연도
              </button>
              {years.map((y) => (
                <button
                  key={y}
                  type="button"
                  className={`chip ${year === y ? "active" : ""}`}
                  onClick={() => setYear(y)}
                >
                  {y}
                </button>
              ))}
            </div>
          ) : null}
          <div className="research-search-row">
            <label className="research-search">
              제목·요약 검색
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="키워드"
              />
            </label>
            <label>
              정렬
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as "newest" | "oldest")}
              >
                <option value="newest">최신 발간순</option>
                <option value="oldest">오래된순</option>
              </select>
            </label>
          </div>
        </div>

        {unlocked ? (
          <div className="research-classify">
            <p className="research-upload-step">
              2. 같은 유형끼리 고르거나, 실패한 업로드를 골라 한꺼번에 지운 뒤
              다시 올립니다.
            </p>
            <div className="research-classify-row">
              <button
                type="button"
                className="chip"
                onClick={() => setSelected(visibleIds)}
              >
                이 목록 모두 선택
              </button>
              <button
                type="button"
                className="chip"
                onClick={() => setSelected([])}
              >
                선택 해제
              </button>
              <span className="meta-soft">{selected.length}편 선택</span>
              <select
                value={applyCategory}
                onChange={(e) =>
                  setApplyCategory(e.target.value as ResearchCategory)
                }
              >
                {RESEARCH_CLASSIFY_OPTIONS.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="community-submit"
                disabled={busy || !selected.length}
                onClick={() => void onClassify(selected, applyCategory)}
              >
                선택에 {RESEARCH_CATEGORY_OPTIONS.find((c) => c.id === applyCategory)?.label} 붙이기
              </button>
              <button
                type="button"
                className="ghost-btn danger-btn"
                disabled={busy || !selected.length}
                onClick={() => void onDeleteMany(selected)}
              >
                선택 {selected.length || ""}편 삭제
              </button>
            </div>
          </div>
        ) : null}

        {loading ? <p className="empty">불러오는 중…</p> : null}
        {!loading && !filtered.length ? (
          <p className="empty">
            {items.length
              ? "조건에 맞는 리서치가 없습니다."
              : "아직 올라온 리서치가 없습니다."}
          </p>
        ) : null}

        <ul className="research-list">
          {filtered.map((item) => (
            <li key={item.id} className="research-item">
              <div className="research-item-meta">
                {unlocked ? (
                  <label className="research-check">
                    <input
                      type="checkbox"
                      checked={selected.includes(item.id)}
                      onChange={() => toggleSelected(item.id)}
                    />
                    선택
                  </label>
                ) : null}
                {unlocked ? (
                  <select
                    className="research-inline-cat"
                    value={item.category}
                    disabled={busy}
                    onChange={(e) =>
                      void onClassify([item.id], e.target.value as ResearchCategory)
                    }
                  >
                    {RESEARCH_CATEGORY_OPTIONS.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className={`research-cat cat-${item.category}`}>
                    {categoryLabel(item.category)}
                  </span>
                )}
                <span>{formatDay(item.published_at)}</span>
                {item.size ? <span>{formatSize(item.size)}</span> : null}
              </div>
              <button
                type="button"
                className="research-item-title"
                onClick={() => setOpen(item)}
              >
                {item.title}
              </button>
              {item.summary ? (
                <p className="research-item-summary">{item.summary}</p>
              ) : null}
              <div className="research-item-actions">
                <button
                  type="button"
                  className="chip active"
                  onClick={() => setOpen(item)}
                >
                  보기
                </button>
                <a className="chip" href={mediaUrl(item, true)}>
                  다운로드
                </a>
                {unlocked ? (
                  <button
                    type="button"
                    className="ghost-btn danger-btn"
                    disabled={busy}
                    onClick={() => void onDelete(item.id)}
                  >
                    삭제
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
        {!loading && items.length ? (
          <p className="meta-soft cardnews-count">
            {filtered.length === items.length
              ? `전체 ${items.length}편`
              : `${filtered.length}편 / 전체 ${items.length}편`}
          </p>
        ) : null}
      </section>

      {open ? (
        <div
          className="research-lightbox"
          role="dialog"
          aria-modal="true"
          onClick={() => setOpen(null)}
        >
          <div
            className="research-lightbox-inner"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="research-lightbox-bar">
              <div>
                <span className={`research-cat cat-${open.category}`}>
                  {categoryLabel(open.category)}
                </span>
                <strong>{open.title}</strong>
                <span className="meta-soft">{formatDay(open.published_at)}</span>
              </div>
              <div className="research-item-actions">
                <a className="chip" href={mediaUrl(open)} target="_blank" rel="noreferrer">
                  새 탭
                </a>
                <a className="chip" href={mediaUrl(open, true)}>
                  다운로드
                </a>
                {unlocked ? (
                  <button
                    type="button"
                    className="ghost-btn danger-btn"
                    onClick={() => void onDelete(open.id)}
                  >
                    삭제
                  </button>
                ) : null}
                <button type="button" className="chip" onClick={() => setOpen(null)}>
                  닫기
                </button>
              </div>
            </div>
            {open.summary ? (
              <p className="research-item-summary">{open.summary}</p>
            ) : null}
            <iframe
              className="research-frame"
              title={open.title}
              src={mediaUrl(open)}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
