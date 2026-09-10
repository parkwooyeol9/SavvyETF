"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  DEFAULT_RESEARCH_YEAR,
  RESEARCH_CATEGORY_OPTIONS,
  RESEARCH_YEAR_OPTIONS,
  composeResearchDate,
  formatResearchDate,
  isResearchDate,
  researchYear,
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

const SECRET_KEY = "savvy_research_admin";

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
  return file.name.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ").trim();
}

function loadSecret(): string {
  if (typeof window === "undefined") return "";
  return window.sessionStorage.getItem(SECRET_KEY) || "";
}

function saveSecret(secret: string) {
  window.sessionStorage.setItem(SECRET_KEY, secret);
}

function clearSecret() {
  window.sessionStorage.removeItem(SECRET_KEY);
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
  const [items, setItems] = useState<ResearchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [open, setOpen] = useState<ResearchItem | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<ResearchCategory | "all">("all");
  const [year, setYear] = useState<string>("all");
  const [sort, setSort] = useState<"newest" | "oldest">("newest");
  const [title, setTitle] = useState("");
  const [uploadCategory, setUploadCategory] = useState<ResearchCategory>("quant");
  const [publishedYear, setPublishedYear] = useState(DEFAULT_RESEARCH_YEAR);
  const [publishedMonth, setPublishedMonth] = useState("");
  const [publishedDay, setPublishedDay] = useState("");
  const [summary, setSummary] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
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
    const stored = loadSecret();
    if (!stored) return;
    void (async () => {
      const res = await fetch("/api/research/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: stored }),
      });
      if (res.ok) {
        setSecret(stored);
        setUnlocked(true);
      } else {
        clearSecret();
      }
    })();
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

  async function onUnlock(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/research/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: password }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        throw new Error(json.error || "비밀번호가 올바르지 않습니다.");
      }
      saveSecret(password);
      setSecret(password);
      setUnlocked(true);
      setAuthOpen(false);
      setPassword("");
    } catch (exc) {
      setError(friendlyError(exc instanceof Error ? exc.message : "인증 실패"));
    } finally {
      setBusy(false);
    }
  }

  function onLock() {
    clearSecret();
    setSecret("");
    setUnlocked(false);
    setAuthOpen(false);
  }

  function pickFiles(list: FileList | File[] | null) {
    const next = [...(list || [])].filter(
      (f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name),
    );
    if (!next.length) {
      setError("PDF 파일만 올릴 수 있습니다.");
      return;
    }
    setError(null);
    setFiles(next);
    if (!title.trim() && next.length === 1) {
      setTitle(titleFromFile(next[0]!));
    }
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
    setBusy(true);
    setError(null);
    try {
      for (let i = 0; i < files.length; i += 1) {
        const file = files[i]!;
        setProgress(`${i + 1}/${files.length} 올리는 중…`);
        const body = new FormData();
        body.set(
          "title",
          (files.length === 1 ? title.trim() : "") || titleFromFile(file),
        );
        body.set("category", uploadCategory);
        body.set("published_at", publishedAt);
        body.set("summary", files.length === 1 ? summary.trim() : "");
        body.set("file", file);
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
      setTitle("");
      setSummary("");
      setFiles([]);
      if (inputRef.current) inputRef.current.value = "";
      await load();
    } catch (exc) {
      setError(friendlyError(exc instanceof Error ? exc.message : "업로드 실패"));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  async function onDelete(id: string) {
    if (!secret) return;
    if (!window.confirm("이 리서치를 삭제할까요?")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/research?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${secret}` },
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        throw new Error(json.error || "삭제 실패");
      }
      if (open?.id === id) setOpen(null);
      await load();
    } catch (exc) {
      setError(friendlyError(exc instanceof Error ? exc.message : "삭제 실패"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="edu-tab research-tab">
      <section className="feature-block">
        <div className="cardnews-head">
          <div>
            <h1 className="feature-title">리서치</h1>
            <p className="feature-lead">
              과거에 작성한 리서치 페이퍼를 유형(퀀트·AI·ETF·ESG·크립토·지정학)과
              발간 연도로 모아 둡니다. 월·일은 없어도 되고, 원하는 분류와 연도를
              골라 찾아볼 수 있습니다.
            </p>
          </div>
          {unlocked ? (
            <button type="button" className="ghost-btn" onClick={onLock}>
              관리 종료
            </button>
          ) : (
            <button
              type="button"
              className="ghost-btn"
              onClick={() => setAuthOpen((v) => !v)}
            >
              {authOpen ? "닫기" : "관리자"}
            </button>
          )}
        </div>

        {authOpen && !unlocked ? (
          <form className="cardnews-auth" onSubmit={(e) => void onUnlock(e)}>
            <label>
              관리자 비밀번호
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </label>
            <button type="submit" className="community-submit" disabled={busy}>
              {busy ? "확인 중…" : "잠금 해제"}
            </button>
          </form>
        ) : null}

        {unlocked ? (
          <form className="research-upload" onSubmit={(e) => void onUpload(e)}>
            <div className="research-upload-grid">
              <label>
                제목
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={200}
                  placeholder={
                    files.length > 1
                      ? "여러 장이면 파일명을 제목으로 씁니다"
                      : "비우면 파일명을 제목으로 씁니다"
                  }
                />
              </label>
              <label>
                유형
                <select
                  value={uploadCategory}
                  onChange={(e) =>
                    setUploadCategory(e.target.value as ResearchCategory)
                  }
                >
                  {RESEARCH_CATEGORY_OPTIONS.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="research-upload-dates">
              <label>
                발간 연도
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
            <label>
              요약 (선택)
              <textarea
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                rows={3}
                maxLength={2000}
                placeholder={
                  files.length > 1
                    ? "여러 장을 한 번에 올리면 요약은 비워 둡니다."
                    : "한두 문장으로 내용을 소개합니다."
                }
              />
            </label>
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
                PDF를 여러 장 한 번에 올릴 수 있습니다. 기본 발간 연도는
                2026년이고, 월·일은 생략해도 됩니다. 파일당 4MB 이하입니다.
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
                  PDF 선택
                </button>
                <span className="meta-soft">
                  {files.length
                    ? files.length === 1
                      ? `${files[0]!.name} · ${formatSize(files[0]!.size)}`
                      : `${files.length}개 파일 · ${formatSize(
                          files.reduce((n, f) => n + f.size, 0),
                        )}`
                    : "선택된 파일 없음"}
                </span>
              </div>
            </div>
            <button type="submit" className="community-submit" disabled={busy}>
              {busy ? progress || "올리는 중…" : "리서치 업로드"}
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
            {RESEARCH_CATEGORY_OPTIONS.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`chip ${category === c.id ? "active" : ""}`}
                onClick={() => setCategory(c.id)}
              >
                {c.label}
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
                <span className={`research-cat cat-${item.category}`}>
                  {categoryLabel(item.category)}
                </span>
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
