"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAdminSession } from "@/components/AdminSession";
import VaultPdfViewer from "@/components/VaultPdfViewer";
import { adminAuthHeaders } from "@/lib/adminSession";
import {
  VAULT_CHUNK_BYTES,
  VAULT_MAX_FILE_BYTES,
  VAULT_MAX_FILES_PER_POST,
  VAULT_MAX_MEMO,
  VAULT_MAX_TITLE,
  formatVaultSize,
  isVaultPdf,
  type VaultPostView,
} from "@/lib/adminVaultMeta";

type ViewingFile = { postId: string; file: VaultPostView["files"][number] };

type UploadRef = { upload_id: string; filename: string; parts: number };

type ApiResult = { ok?: boolean; error?: string };

const ACCEPT =
  ".xlsx,.xlsm,.xls,.csv,.pptx,.ppt,.docx,.doc,.pdf,.hwp,.hwpx,.txt,.md,.json,.zip,.png,.jpg,.jpeg";

function friendlyError(msg: string): string {
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) {
    return "연결이 끊겼습니다. 다시 시도해 주세요.";
  }
  return msg;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function validateFiles(list: File[], already: number): string | null {
  if (already + list.length > VAULT_MAX_FILES_PER_POST) {
    return `파일은 글 하나에 ${VAULT_MAX_FILES_PER_POST}개까지 올릴 수 있습니다.`;
  }
  const empty = list.find((f) => f.size <= 0);
  if (empty) return `${empty.name}은(는) 빈 파일입니다.`;
  const big = list.find((f) => f.size > VAULT_MAX_FILE_BYTES);
  if (big) return `${big.name}이(가) 30MB를 넘습니다.`;
  return null;
}

async function uploadFile(
  file: File,
  secret: string,
  onProgress: (text: string) => void,
): Promise<UploadRef> {
  const uploadId = crypto.randomUUID();
  const total = Math.max(1, Math.ceil(file.size / VAULT_CHUNK_BYTES));
  for (let part = 0; part < total; part += 1) {
    onProgress(total > 1 ? `${file.name} · ${part + 1}/${total}` : file.name);
    const start = part * VAULT_CHUNK_BYTES;
    const blob = file.slice(start, Math.min(file.size, start + VAULT_CHUNK_BYTES));
    for (let attempt = 0; ; attempt += 1) {
      try {
        const body = new FormData();
        body.set("upload_id", uploadId);
        body.set("part", String(part));
        body.set("total", String(total));
        body.set("file", new File([blob], "chunk.bin"));
        const res = await fetch("/api/admin-vault/chunk", {
          method: "POST",
          headers: adminAuthHeaders(secret),
          body,
        });
        const json = (await res.json()) as ApiResult;
        if (!res.ok || !json.ok) throw new Error(json.error || `${file.name} 업로드 실패`);
        break;
      } catch (exc) {
        if (attempt >= 2) throw exc;
        await new Promise((r) => window.setTimeout(r, 400 * (attempt + 1)));
      }
    }
  }
  return { upload_id: uploadId, filename: file.name, parts: total };
}

function FilePicker({
  files,
  onPick,
  onRemove,
  disabled,
  existing = 0,
}: {
  files: File[];
  onPick: (list: File[]) => void;
  onRemove: (index: number) => void;
  disabled?: boolean;
  existing?: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  return (
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
        if (!disabled) onPick([...e.dataTransfer.files]);
      }}
    >
      <p>
        엑셀·장표·PDF 등을 끌어다 놓거나 선택하세요. 파일당 최대 30MB, 글 하나에{" "}
        {VAULT_MAX_FILES_PER_POST}개까지.
      </p>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          onPick([...(e.target.files || [])]);
          e.target.value = "";
        }}
      />
      <div className="research-file-row">
        <button
          type="button"
          className="chip"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
        >
          파일 선택
        </button>
        <span className="meta-soft">
          {files.length
            ? `${files.length}개 · ${formatVaultSize(files.reduce((n, f) => n + f.size, 0))}`
            : existing
              ? `기존 ${existing}개`
              : "선택된 파일 없음"}
        </span>
      </div>
      {files.length ? (
        <ul className="research-file-list">
          {files.map((file, i) => (
            <li key={`${file.name}-${file.size}-${i}`}>
              <span>{file.name}</span>
              <span className="vault-file-tail">
                {formatVaultSize(file.size)}
                <button
                  type="button"
                  className="vault-x"
                  aria-label={`${file.name} 빼기`}
                  disabled={disabled}
                  onClick={() => onRemove(i)}
                >
                  ×
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export default function AdminVaultTab() {
  const { secret, unlocked } = useAdminSession();
  const [items, setItems] = useState<VaultPostView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const [title, setTitle] = useState("");
  const [memo, setMemo] = useState("");
  const [files, setFiles] = useState<File[]>([]);

  const [editId, setEditId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editMemo, setEditMemo] = useState("");
  const [editRemove, setEditRemove] = useState<string[]>([]);
  const [editAdd, setEditAdd] = useState<File[]>([]);
  const [viewing, setViewing] = useState<ViewingFile | null>(null);
  const closeViewer = useCallback(() => setViewing(null), []);

  const authed = useCallback(
    (extra?: Record<string, string>) => ({ ...adminAuthHeaders(secret), ...extra }),
    [secret],
  );

  const load = useCallback(async () => {
    if (!secret) return;
    setLoading(true);
    try {
      const res = await fetch("/api/admin-vault", { cache: "no-store", headers: authed() });
      const json = (await res.json()) as ApiResult & { items?: VaultPostView[] };
      if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setItems(json.items || []);
      setError(null);
    } catch (exc) {
      setError(friendlyError(exc instanceof Error ? exc.message : "불러오기 실패"));
    } finally {
      setLoading(false);
    }
  }, [secret, authed]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.memo.toLowerCase().includes(q) ||
        p.files.some((f) => f.filename.toLowerCase().includes(q)),
    );
  }, [items, query]);

  const totalBytes = useMemo(
    () => items.reduce((n, p) => n + p.files.reduce((m, f) => m + f.size, 0), 0),
    [items],
  );

  function pickInto(
    current: File[],
    set: (next: File[]) => void,
    list: File[],
    existing = 0,
  ) {
    const next = [...current, ...list];
    const problem = validateFiles(next, existing);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    set(next);
  }

  async function uploadAll(list: File[]): Promise<UploadRef[]> {
    const out: UploadRef[] = [];
    for (const [i, file] of list.entries()) {
      out.push(
        await uploadFile(file, secret, (text) =>
          setProgress(list.length > 1 ? `(${i + 1}/${list.length}) ${text}` : text),
        ),
      );
    }
    return out;
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() && !memo.trim() && !files.length) {
      setError("제목·메모·파일 중 하나는 있어야 합니다.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const uploads = await uploadAll(files);
      setProgress("저장 중…");
      const res = await fetch("/api/admin-vault", {
        method: "POST",
        headers: authed({ "Content-Type": "application/json" }),
        body: JSON.stringify({ title, memo, uploads }),
      });
      const json = (await res.json()) as ApiResult;
      if (!res.ok || !json.ok) throw new Error(json.error || "저장 실패");
      setTitle("");
      setMemo("");
      setFiles([]);
      await load();
    } catch (exc) {
      setError(friendlyError(exc instanceof Error ? exc.message : "저장 실패"));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  function startEdit(post: VaultPostView) {
    setEditId(post.id);
    setEditTitle(post.title);
    setEditMemo(post.memo);
    setEditRemove([]);
    setEditAdd([]);
    setError(null);
  }

  function cancelEdit() {
    setEditId(null);
    setEditRemove([]);
    setEditAdd([]);
  }

  async function onSaveEdit(post: VaultPostView) {
    setBusy(true);
    setError(null);
    try {
      const add = await uploadAll(editAdd);
      setProgress("저장 중…");
      const res = await fetch("/api/admin-vault", {
        method: "PATCH",
        headers: authed({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          id: post.id,
          title: editTitle,
          memo: editMemo,
          add,
          remove: editRemove,
        }),
      });
      const json = (await res.json()) as ApiResult;
      if (!res.ok || !json.ok) throw new Error(json.error || "수정 실패");
      cancelEdit();
      await load();
    } catch (exc) {
      setError(friendlyError(exc instanceof Error ? exc.message : "수정 실패"));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  async function onDelete(post: VaultPostView) {
    const extra = post.files.length ? ` (첨부 ${post.files.length}개 포함)` : "";
    if (!window.confirm(`"${post.title}" 글을 삭제할까요?${extra}`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin-vault?id=${encodeURIComponent(post.id)}`, {
        method: "DELETE",
        headers: authed(),
      });
      const json = (await res.json()) as ApiResult;
      if (!res.ok || !json.ok) throw new Error(json.error || "삭제 실패");
      if (editId === post.id) cancelEdit();
      await load();
    } catch (exc) {
      setError(friendlyError(exc instanceof Error ? exc.message : "삭제 실패"));
    } finally {
      setBusy(false);
    }
  }

  async function onDownload(postId: string, fileId: string) {
    try {
      const params = new URLSearchParams({ post: postId, file: fileId });
      const res = await fetch(`/api/admin-vault/file?${params}`, {
        cache: "no-store",
        headers: authed(),
      });
      const json = (await res.json()) as ApiResult & { url?: string };
      if (!res.ok || !json.ok || !json.url) throw new Error(json.error || "다운로드 실패");
      const a = document.createElement("a");
      a.href = json.url;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (exc) {
      setError(friendlyError(exc instanceof Error ? exc.message : "다운로드 실패"));
    }
  }

  if (!unlocked) {
    return (
      <div className="edu-tab research-tab">
        <section className="feature-block">
          <p className="empty">관리자 로그인 후 이용할 수 있습니다.</p>
        </section>
      </div>
    );
  }

  return (
    <div className="edu-tab research-tab vault-tab">
      <section className="feature-block">
        <div className="cardnews-head">
          <div>
            <h1 className="feature-title">자료실</h1>
            <p className="meta-soft">
              관리자만 보고 받을 수 있는 자료 보관함입니다. PDF는 눌러서 화면에서 바로 보고, 쪽마다
              PNG로 저장할 수 있습니다. 다운로드 링크는 5분 뒤 만료됩니다.
            </p>
          </div>
        </div>

        <form className="research-upload" onSubmit={(e) => void onCreate(e)}>
          <label>
            제목 (비우면 첫 파일명)
            <input
              type="text"
              value={title}
              maxLength={VAULT_MAX_TITLE}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="예: 10월 리밸런싱 장표"
              disabled={busy}
            />
          </label>
          <label>
            메모 (선택)
            <textarea
              value={memo}
              maxLength={VAULT_MAX_MEMO}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="자료 설명, 출처, 후속 작업 등"
              disabled={busy}
            />
          </label>
          <FilePicker
            files={files}
            disabled={busy}
            onPick={(list) => pickInto(files, setFiles, list)}
            onRemove={(i) => setFiles((cur) => cur.filter((_, j) => j !== i))}
          />
          <button type="submit" className="community-submit" disabled={busy}>
            {busy && !editId ? progress || "올리는 중…" : "게시하기"}
          </button>
        </form>

        {error ? <p className="empty warn">{error}</p> : null}
      </section>

      <section className="feature-block">
        <div className="research-search-row">
          <label className="research-search">
            제목·메모·파일명 검색
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="키워드"
            />
          </label>
        </div>

        {loading && !items.length ? <p className="empty">불러오는 중…</p> : null}
        {!loading && !filtered.length ? (
          <p className="empty">
            {items.length ? "조건에 맞는 글이 없습니다." : "아직 저장된 자료가 없습니다."}
          </p>
        ) : null}

        <ul className="research-list">
          {filtered.map((post) => {
            const editing = editId === post.id;
            return (
              <li key={post.id} className="research-item">
                <div className="research-item-meta">
                  <span>{formatWhen(post.created_at)}</span>
                  {post.updated_at !== post.created_at ? (
                    <span>수정 {formatWhen(post.updated_at)}</span>
                  ) : null}
                  {post.files.length ? <span>첨부 {post.files.length}</span> : null}
                </div>

                {editing ? (
                  <div className="research-upload">
                    <label>
                      제목
                      <input
                        type="text"
                        value={editTitle}
                        maxLength={VAULT_MAX_TITLE}
                        onChange={(e) => setEditTitle(e.target.value)}
                        disabled={busy}
                      />
                    </label>
                    <label>
                      메모
                      <textarea
                        value={editMemo}
                        maxLength={VAULT_MAX_MEMO}
                        onChange={(e) => setEditMemo(e.target.value)}
                        disabled={busy}
                      />
                    </label>
                    {post.files.length ? (
                      <ul className="research-file-list">
                        {post.files.map((f) => {
                          const removing = editRemove.includes(f.id);
                          return (
                            <li key={f.id} className={removing ? "vault-removing" : ""}>
                              <span>{f.filename}</span>
                              <span className="vault-file-tail">
                                {formatVaultSize(f.size)}
                                <button
                                  type="button"
                                  className="chip"
                                  disabled={busy}
                                  onClick={() =>
                                    setEditRemove((cur) =>
                                      removing ? cur.filter((id) => id !== f.id) : [...cur, f.id],
                                    )
                                  }
                                >
                                  {removing ? "되돌리기" : "제거"}
                                </button>
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
                    <FilePicker
                      files={editAdd}
                      disabled={busy}
                      existing={post.files.length - editRemove.length}
                      onPick={(list) =>
                        pickInto(editAdd, setEditAdd, list, post.files.length - editRemove.length)
                      }
                      onRemove={(i) => setEditAdd((cur) => cur.filter((_, j) => j !== i))}
                    />
                    <div className="research-item-actions">
                      <button
                        type="button"
                        className="community-submit"
                        disabled={busy}
                        onClick={() => void onSaveEdit(post)}
                      >
                        {busy ? progress || "저장 중…" : "저장"}
                      </button>
                      <button
                        type="button"
                        className="chip"
                        disabled={busy}
                        onClick={cancelEdit}
                      >
                        취소
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="research-item-title vault-title">{post.title}</p>
                    {post.memo ? <p className="research-item-summary vault-memo">{post.memo}</p> : null}
                    {post.files.length ? (
                      <div className="vault-files">
                        {post.files.map((f) =>
                          isVaultPdf(f) ? (
                            <button
                              key={f.id}
                              type="button"
                              className="chip"
                              title={`${f.filename} 화면에서 보기`}
                              onClick={() => setViewing({ postId: post.id, file: f })}
                            >
                              📄 {f.filename} · {formatVaultSize(f.size)}
                            </button>
                          ) : (
                            <button
                              key={f.id}
                              type="button"
                              className="chip"
                              title={`${f.filename} 다운로드`}
                              onClick={() => void onDownload(post.id, f.id)}
                            >
                              ⬇ {f.filename} · {formatVaultSize(f.size)}
                            </button>
                          ),
                        )}
                      </div>
                    ) : null}
                    <div className="research-item-actions">
                      <button
                        type="button"
                        className="chip"
                        disabled={busy || Boolean(editId)}
                        onClick={() => startEdit(post)}
                      >
                        수정
                      </button>
                      <button
                        type="button"
                        className="ghost-btn danger-btn"
                        disabled={busy}
                        onClick={() => void onDelete(post)}
                      >
                        삭제
                      </button>
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ul>
        {items.length ? (
          <p className="meta-soft cardnews-count">
            {filtered.length === items.length
              ? `전체 ${items.length}건`
              : `${filtered.length}건 / 전체 ${items.length}건`}{" "}
            · 첨부 합계 {formatVaultSize(totalBytes)}
          </p>
        ) : null}
      </section>

      {viewing ? (
        <VaultPdfViewer
          key={`${viewing.postId}:${viewing.file.id}`}
          postId={viewing.postId}
          file={viewing.file}
          secret={secret}
          onClose={closeViewer}
          onDownload={() => void onDownload(viewing.postId, viewing.file.id)}
        />
      ) : null}
    </div>
  );
}
