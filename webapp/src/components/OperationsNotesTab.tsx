"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAdminSession } from "@/components/AdminSession";
import styles from "./OperationsNotesTab.module.css";

type Note = { id: string; title: string; body: string; category: string; createdAt: string; updatedAt: string; files: { name: string; type: string; index: number; size: number }[] };
const blank = { id: "", title: "", body: "", category: "AI 리서치" };

export default function OperationsNotesTab() {
  const { secret, unlocked } = useAdminSession();
  const [items, setItems] = useState<Note[]>([]);
  const [draft, setDraft] = useState(blank);
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [removeFiles, setRemoveFiles] = useState(false);
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const headers = { Authorization: `Bearer ${secret}` };
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const res = await fetch("/api/operations-notes", { headers: { Authorization: `Bearer ${secret}` }, cache: "no-store", signal });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "조회 실패");
      if (!signal?.aborted) setItems(data.items);
    } catch (e) {
      if (!signal?.aborted) setError(e instanceof Error ? e.message : "조회 실패");
    } finally { if (!signal?.aborted) setLoading(false); }
  }, [secret]);
  useEffect(() => {
    const controller = new AbortController();
    if (unlocked && secret) void load(controller.signal);
    else { setItems([]); setDraft(blank); setEditing(false); setPreview(null); }
    return () => controller.abort();
  }, [load, secret, unlocked]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);
  if (!unlocked || !secret) return null;

  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try {
      const form = new FormData();
      Object.entries(draft).forEach(([k, v]) => form.set(k, v));
      form.set("removeFiles", removeFiles ? "1" : "0");
      for (const file of Array.from(input.current?.files || [])) form.append("files", file);
      const res = await fetch("/api/operations-notes", { method: "POST", headers, body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "저장 실패");
      setItems(prev => [data.item, ...prev.filter(n => n.id !== data.item.id)]);
      setDraft(blank); setEditing(false); setRemoveFiles(false);
    } catch (e) { setError(e instanceof Error ? e.message : "저장 실패"); }
    finally { setBusy(false); }
  }
  async function remove(note: Note) {
    if (!confirm(`‘${note.title}’과 첨부파일을 삭제할까요?`)) return;
    setBusy(true); setError("");
    try {
      const res = await fetch(`/api/operations-notes?id=${note.id}`, { method: "DELETE", headers });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "삭제 실패");
      setItems(prev => prev.filter(n => n.id !== note.id)); setPreview(null);
      if (draft.id === note.id) { setDraft(blank); setEditing(false); }
    } catch (e) { setError(e instanceof Error ? e.message : "삭제 실패"); }
    finally { setBusy(false); }
  }
  async function attachment(note: Note, index: number, show: boolean) {
    setBusy(true); setError("");
    try {
      const res = await fetch(`/api/operations-notes?id=${note.id}&file=${index}`, { headers, cache: "no-store" });
      if (!res.ok) { const data = await res.json(); throw new Error(data.error || "다운로드 실패"); }
      const file = note.files[index];
      const bytes = await res.arrayBuffer();
      const url = URL.createObjectURL(new Blob([bytes], { type: show ? file.type : "application/octet-stream" }));
      if (show) setPreview({ url, name: file.name });
      else {
        const link = document.createElement("a"); link.href = url; link.download = file.name; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (e) { setError(e instanceof Error ? e.message : "다운로드 실패"); }
    finally { setBusy(false); }
  }
  const filtered = items.filter(n => `${n.title} ${n.body} ${n.category} ${n.files.map(f => f.name).join(" ")}`.toLowerCase().includes(query.toLowerCase()));
  return <section className={styles.root}>
    <header className={styles.header}>
      <div><span className={styles.badge}>관리자 전용 · 비공개</span><h2>운영 노트</h2><p>AI 리서치, 데이터와 차트를 한곳에 보관하세요.</p></div>
      <button className="ghost-btn" disabled={busy} onClick={() => { setDraft(blank); setRemoveFiles(false); setEditing(true); setError(""); if (input.current) input.current.value = ""; }}>새 노트 작성</button>
    </header>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {editing && <form className={styles.editor} onSubmit={save}>
      <h3>{draft.id ? "노트 수정" : "새 노트"}</h3>
      <label>제목<input required maxLength={200} value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label>
      <label>분류<input list="note-categories" maxLength={50} value={draft.category} onChange={e => setDraft({ ...draft, category: e.target.value })} /></label>
      <datalist id="note-categories">{["AI 리서치", "데이터", "차트", "이미지", "작업 기록", "기타"].map(c => <option key={c} value={c} />)}</datalist>
      <label>본문<textarea rows={12} maxLength={50000} value={draft.body} onChange={e => setDraft({ ...draft, body: e.target.value })} placeholder="리서치 결과나 작업 메모를 붙여넣으세요." /></label>
      <label>첨부파일<input ref={input} type="file" multiple /></label>
      <small>PDF, Excel, CSV, 이미지 등 · 게시글당 최대 10개, 합계 3 MiB · 본문은 서식 없는 텍스트로 저장됩니다.</small>
      {draft.id && <label><input type="checkbox" checked={removeFiles} onChange={e => setRemoveFiles(e.target.checked)} /> 기존 첨부파일 모두 제거 (선택하지 않으면 유지)</label>}
      <div className={styles.actions}><button className="ghost-btn" disabled={busy}>{busy ? "처리 중…" : "저장"}</button><button type="button" className="ghost-btn" disabled={busy} onClick={() => setEditing(false)}>취소</button></div>
    </form>}
    <div className={styles.search}><input aria-label="노트 검색" placeholder="제목, 본문, 분류, 파일명 검색" value={query} onChange={e => setQuery(e.target.value)} /><span>{filtered.length}개 노트</span><button className="ghost-btn" disabled={busy || loading} onClick={() => { setError(""); void load(); }}>새로고침</button></div>
    {loading ? <p>불러오는 중…</p> : filtered.length === 0 ? <p className={styles.empty}>{query ? "검색 결과가 없습니다." : "아직 저장된 노트가 없습니다."}</p> : filtered.map(note => <article key={note.id} className={styles.note}>
      <span className={styles.badge}>{note.category}</span><h3>{note.title}</h3><small>수정 {new Date(note.updatedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} (KST)</small>
      <p className={styles.body}>{note.body}</p>
      <ul>{note.files.map((file, index) => <li key={index}>{file.name} <small>({(file.size / 1024).toFixed(1)} KB)</small> <button className="ghost-btn" disabled={busy} onClick={() => void attachment(note, index, false)}>다운로드</button> {/^(image\/(png|jpeg|webp|gif))$/.test(file.type) && <button className="ghost-btn" disabled={busy} onClick={() => void attachment(note, index, true)}>이미지 보기</button>}</li>)}</ul>
      <div className={styles.actions}><button className="ghost-btn" disabled={busy} onClick={() => { setDraft({ id: note.id, title: note.title, body: note.body, category: note.category }); setRemoveFiles(false); setEditing(true); if (input.current) input.current.value = ""; window.scrollTo({ top: 0, behavior: "smooth" }); }}>수정</button><button className="ghost-btn" disabled={busy} onClick={() => void remove(note)}>삭제</button></div>
    </article>)}
    {preview && <div className={styles.preview} role="dialog" aria-modal="true" aria-label={preview.name} onKeyDown={e => { if (e.key === "Escape") setPreview(null); }}><button autoFocus className="ghost-btn" onClick={() => setPreview(null)}>닫기</button><p>{preview.name}</p>{/* Authenticated local blob; never send private image through the public Next image optimizer. */}<img src={preview.url} alt={preview.name} /></div>}
  </section>;
}
