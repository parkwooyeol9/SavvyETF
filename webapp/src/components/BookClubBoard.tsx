"use client";

import { useCallback, useEffect, useState } from "react";

type ListPost = {
  id: string;
  title: string;
  body: string;
  nickname: string;
  created_at: string;
  comment_count?: number;
};

type DetailComment = {
  id: string;
  nickname: string;
  body: string;
  created_at: string;
};

type DetailPost = ListPost & { comments: DetailComment[] };

const NICK_KEY = "savvy_bookclub_nick";
const DEL_PREFIX = "savvy_bookclub_del_";

function friendlyError(msg: string): string {
  if (/R2 not configured/i.test(msg) || /저장소/.test(msg)) {
    return "게시판 저장소가 아직 연결되지 않았습니다. 잠시 후 다시 시도해 주세요.";
  }
  return msg;
}

function formatWhen(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("ko-KR", { hour12: false });
}

function loadNick(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(NICK_KEY) || "";
}

function saveNick(nick: string) {
  window.localStorage.setItem(NICK_KEY, nick);
}

function saveDeleteKey(kind: "post" | "comment", id: string, key: string) {
  window.localStorage.setItem(`${DEL_PREFIX}${kind}_${id}`, key);
}

function getDeleteKey(kind: "post" | "comment", id: string): string {
  return window.localStorage.getItem(`${DEL_PREFIX}${kind}_${id}`) || "";
}

export default function BookClubBoard() {
  const [posts, setPosts] = useState<ListPost[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailPost | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nickname, setNickname] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [commentBody, setCommentBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [ownedPostIds, setOwnedPostIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    setNickname(loadNick());
  }, []);

  useEffect(() => {
    const owned = new Set<string>();
    for (const p of posts) {
      if (getDeleteKey("post", p.id)) owned.add(p.id);
    }
    setOwnedPostIds(owned);
  }, [posts]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/bookclub/posts", { cache: "no-store" });
      const json = (await res.json()) as {
        ok: boolean;
        posts?: ListPost[];
        error?: string;
      };
      if (!res.ok || !json.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      setPosts(json.posts || []);
      setError(null);
    } catch (exc) {
      setError(
        friendlyError(exc instanceof Error ? exc.message : "로드 실패"),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/bookclub/posts/${id}`, { cache: "no-store" });
      const json = (await res.json()) as {
        ok: boolean;
        post?: DetailPost;
        error?: string;
      };
      if (!res.ok || !json.ok || !json.post) {
        throw new Error(json.error || "글을 찾을 수 없습니다.");
      }
      setDetail(json.post);
      setError(null);
    } catch (exc) {
      setError(
        friendlyError(exc instanceof Error ? exc.message : "로드 실패"),
      );
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!openId) {
      setDetail(null);
      return;
    }
    void loadDetail(openId);
  }, [openId, loadDetail]);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const nick = nickname.trim();
      saveNick(nick);
      const res = await fetch("/api/bookclub/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nickname: nick,
          title,
          body,
        }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        error?: string;
        post?: ListPost;
        delete_key?: string;
      };
      if (!res.ok || !json.ok || !json.post) {
        throw new Error(json.error || "등록 실패");
      }
      if (json.delete_key) saveDeleteKey("post", json.post.id, json.delete_key);
      setTitle("");
      setBody("");
      await load();
      setOpenId(json.post.id);
    } catch (exc) {
      setError(friendlyError(exc instanceof Error ? exc.message : "등록 실패"));
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: string) {
    const key = getDeleteKey("post", id);
    if (!key) {
      setError("이 브라우저에서 작성한 글만 삭제할 수 있습니다.");
      return;
    }
    if (!window.confirm("이 글을 삭제할까요?")) return;
    const res = await fetch(`/api/bookclub/posts/${id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ delete_key: key }),
    });
    const json = (await res.json()) as { ok: boolean; error?: string };
    if (!res.ok || !json.ok) {
      setError(json.error || "삭제 실패");
      return;
    }
    if (openId === id) setOpenId(null);
    await load();
  }

  async function onComment(e: React.FormEvent) {
    e.preventDefault();
    if (!openId) return;
    setBusy(true);
    try {
      const nick = nickname.trim();
      saveNick(nick);
      const res = await fetch(`/api/bookclub/posts/${openId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname: nick, body: commentBody }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        error?: string;
        comment?: DetailComment;
        delete_key?: string;
      };
      if (!res.ok || !json.ok) throw new Error(json.error || "댓글 실패");
      if (json.comment && json.delete_key) {
        saveDeleteKey("comment", json.comment.id, json.delete_key);
      }
      setCommentBody("");
      await loadDetail(openId);
      await load();
    } catch (exc) {
      setError(friendlyError(exc instanceof Error ? exc.message : "댓글 실패"));
    } finally {
      setBusy(false);
    }
  }

  if (openId) {
    return (
      <div className="community-page bookclub-board">
        <section className="panel community-panel">
          <button
            type="button"
            className="community-back"
            onClick={() => setOpenId(null)}
          >
            ← 목록
          </button>
          {detailLoading && !detail ? (
            <p className="empty">불러오는 중…</p>
          ) : null}
          {detail ? (
            <>
              <div className="community-post-meta">
                <span className="community-cat">익명</span>
                <span className="meta-soft">
                  {detail.nickname} · {formatWhen(detail.created_at)}
                </span>
              </div>
              <h1 className="community-title">{detail.title}</h1>
              <p className="community-body">{detail.body}</p>
              {getDeleteKey("post", detail.id) ? (
                <button
                  type="button"
                  className="ghost-btn danger-btn"
                  onClick={() => void onDelete(detail.id)}
                >
                  글 삭제
                </button>
              ) : null}
            </>
          ) : null}
          {error ? <p className="empty warn">{error}</p> : null}
        </section>

        {detail ? (
          <section className="panel community-panel">
            <h2 className="community-section-title">
              댓글 {detail.comments?.length || 0}
            </h2>
            <ul className="community-comment-list">
              {(detail.comments || []).map((c) => (
                <li key={c.id}>
                  <div className="meta-soft">
                    {c.nickname} · {formatWhen(c.created_at)}
                  </div>
                  <p>{c.body}</p>
                </li>
              ))}
            </ul>
            <form className="community-compose" onSubmit={(e) => void onComment(e)}>
              <label>
                표시 이름 (선택)
                <input
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  maxLength={24}
                  placeholder="비워 두면 익명"
                />
              </label>
              <label>
                댓글
                <textarea
                  value={commentBody}
                  onChange={(e) => setCommentBody(e.target.value)}
                  maxLength={4000}
                  rows={3}
                  required
                />
              </label>
              <button type="submit" className="community-submit" disabled={busy}>
                {busy ? "등록 중…" : "댓글 등록"}
              </button>
            </form>
          </section>
        ) : null}
      </div>
    );
  }

  return (
    <div className="community-page bookclub-board">
      <section className="panel community-panel">
        <div className="community-head">
          <div>
            <h1 className="community-title">북클럽 게시판</h1>
            <p className="community-lead">
              로그인 없이 누구나 익명으로 글을 남길 수 있습니다. 표시 이름은
              선택이며, 비워 두면 ‘익명’으로 올라갑니다. 이 브라우저에서 쓴 글만
              삭제할 수 있습니다.
            </p>
          </div>
        </div>
      </section>

      <section className="panel community-panel">
        <h2 className="community-section-title">새 글 쓰기</h2>
        <form className="community-compose" onSubmit={(e) => void onCreate(e)}>
          <label>
            표시 이름 (선택)
            <input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              maxLength={24}
              placeholder="비워 두면 익명"
            />
          </label>
          <label>
            제목
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
              required
            />
          </label>
          <label>
            본문
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={8000}
              rows={5}
              required
            />
          </label>
          <button type="submit" className="community-submit" disabled={busy}>
            {busy ? "등록 중…" : "등록"}
          </button>
        </form>
        {error ? <p className="empty warn">{error}</p> : null}
      </section>

      <section className="panel community-panel">
        <h2 className="community-section-title">게시글</h2>
        {loading ? <p className="empty">불러오는 중…</p> : null}
        {!loading && !posts.length ? (
          <p className="empty">아직 글이 없습니다. 첫 글을 남겨 보세요.</p>
        ) : null}
        <ul className="community-post-list">
          {posts.map((post) => (
            <li key={post.id} className="community-post-item">
              <div className="community-post-meta">
                <span className="community-cat">익명</span>
                <span className="meta-soft">
                  {post.nickname} · {formatWhen(post.created_at)}
                  {typeof post.comment_count === "number"
                    ? ` · 댓글 ${post.comment_count}`
                    : ""}
                </span>
              </div>
              <button
                type="button"
                className="community-post-title"
                onClick={() => setOpenId(post.id)}
              >
                {post.title}
              </button>
              <p className="community-post-excerpt">
                {post.body.length > 160 ? `${post.body.slice(0, 160)}…` : post.body}
              </p>
              {ownedPostIds.has(post.id) ? (
                <button
                  type="button"
                  className="ghost-btn danger-btn"
                  onClick={() => void onDelete(post.id)}
                >
                  삭제
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
