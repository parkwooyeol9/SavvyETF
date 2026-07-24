"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { COMMUNITY_CATEGORIES, categoryLabel } from "@/lib/community";

type ListPost = {
  id: string;
  category: string;
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

function formatWhen(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("ko-KR", { hour12: false });
}

function loadNick(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem("savvy_community_nick") || "";
}

function saveNick(nick: string) {
  window.localStorage.setItem("savvy_community_nick", nick);
}

function saveDeleteKey(kind: "post" | "comment", id: string, key: string) {
  window.localStorage.setItem(`savvy_community_del_${kind}_${id}`, key);
}

function getDeleteKey(kind: "post" | "comment", id: string): string {
  return window.localStorage.getItem(`savvy_community_del_${kind}_${id}`) || "";
}

export function SimpleCommunityHome({
  initialCategory,
}: {
  initialCategory?: string | null;
}) {
  const [category, setCategory] = useState<string | null>(initialCategory || null);
  const [posts, setPosts] = useState<ListPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nickname, setNickname] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [postCategory, setPostCategory] = useState("question");
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
      const qs = category ? `?category=${encodeURIComponent(category)}` : "";
      const res = await fetch(`/api/community/posts${qs}`, { cache: "no-store" });
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
      setError(exc instanceof Error ? exc.message : "로드 실패");
    } finally {
      setLoading(false);
    }
  }, [category]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const nick = nickname.trim();
      saveNick(nick);
      const res = await fetch("/api/community/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nickname: nick,
          title,
          body,
          category: postCategory,
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
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "등록 실패");
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
    const res = await fetch(`/api/community/posts/${id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ delete_key: key }),
    });
    const json = (await res.json()) as { ok: boolean; error?: string };
    if (!res.ok || !json.ok) {
      setError(json.error || "삭제 실패");
      return;
    }
    await load();
  }

  return (
    <div className="community-page">
      <section className="panel community-panel">
        <div className="community-head">
          <div>
            <h1 className="community-title">커뮤니티</h1>
            <p className="community-lead">
              로그인 없이 닉네임으로 질문·아이디어·피드백을 남길 수 있습니다.
              (작성한 브라우저에서만 본인 글 삭제 가능)
            </p>
          </div>
        </div>

        <div className="chip-row community-filters">
          <button
            type="button"
            className={`chip ${!category ? "active" : ""}`}
            onClick={() => setCategory(null)}
          >
            전체
          </button>
          {COMMUNITY_CATEGORIES.map((c) => (
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
      </section>

      <section className="panel community-panel">
        <h2 className="community-section-title">새 글 쓰기</h2>
        <form className="community-compose" onSubmit={(e) => void onCreate(e)}>
          <label>
            닉네임
            <input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              maxLength={24}
              required
              placeholder="표시할 이름"
            />
          </label>
          <label>
            카테고리
            <select
              value={postCategory}
              onChange={(e) => setPostCategory(e.target.value)}
            >
              {COMMUNITY_CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
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
          <p className="empty">아직 글이 없습니다. 첫 질문을 남겨 보세요.</p>
        ) : null}
        <ul className="community-post-list">
          {posts.map((post) => (
            <li key={post.id} className="community-post-item">
              <div className="community-post-meta">
                <span className="community-cat">{categoryLabel(post.category)}</span>
                <span className="meta-soft">
                  {post.nickname} · {formatWhen(post.created_at)}
                  {typeof post.comment_count === "number"
                    ? ` · 댓글 ${post.comment_count}`
                    : ""}
                </span>
              </div>
              <Link href={`/community/${post.id}`} className="community-post-title">
                {post.title}
              </Link>
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

export function SimpleCommunityDetail({ id }: { id: string }) {
  const router = useRouter();
  const [post, setPost] = useState<DetailPost | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nickname, setNickname] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [canDelete, setCanDelete] = useState(false);

  useEffect(() => {
    setNickname(loadNick());
  }, []);

  useEffect(() => {
    setCanDelete(post ? Boolean(getDeleteKey("post", post.id)) : false);
  }, [post]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/community/posts/${id}`, { cache: "no-store" });
      const json = (await res.json()) as {
        ok: boolean;
        post?: DetailPost;
        error?: string;
      };
      if (!res.ok || !json.ok || !json.post) {
        throw new Error(json.error || "not found");
      }
      setPost(json.post);
      setError(null);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "로드 실패");
      setPost(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onComment(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const nick = nickname.trim();
      saveNick(nick);
      const res = await fetch(`/api/community/posts/${id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname: nick, body }),
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
      setBody("");
      await load();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "댓글 실패");
    } finally {
      setBusy(false);
    }
  }

  async function onDeletePost() {
    const key = getDeleteKey("post", id);
    if (!key || !window.confirm("이 글을 삭제할까요?")) return;
    const res = await fetch(`/api/community/posts/${id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ delete_key: key }),
    });
    const json = (await res.json()) as { ok: boolean; error?: string };
    if (!res.ok || !json.ok) {
      setError(json.error || "삭제 실패");
      return;
    }
    router.push("/community");
  }

  if (loading) {
    return (
      <section className="panel community-panel">
        <p className="empty">불러오는 중…</p>
      </section>
    );
  }
  if (!post) {
    return (
      <section className="panel community-panel">
        <p className="empty warn">{error || "글을 찾을 수 없습니다."}</p>
        <Link href="/community" className="community-back">
          ← 목록
        </Link>
      </section>
    );
  }

  return (
    <div className="community-page">
      <section className="panel community-panel">
        <Link href="/community" className="community-back">
          ← 목록
        </Link>
        <div className="community-post-meta">
          <span className="community-cat">{categoryLabel(post.category)}</span>
          <span className="meta-soft">
            {post.nickname} · {formatWhen(post.created_at)}
          </span>
        </div>
        <h1 className="community-title">{post.title}</h1>
        <p className="community-body">{post.body}</p>
        {canDelete ? (
          <button
            type="button"
            className="ghost-btn danger-btn"
            onClick={() => void onDeletePost()}
          >
            글 삭제
          </button>
        ) : null}
      </section>

      <section className="panel community-panel">
        <h2 className="community-section-title">
          댓글 {post.comments?.length || 0}
        </h2>
        <ul className="community-comment-list">
          {(post.comments || []).map((c) => (
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
            닉네임
            <input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              maxLength={24}
              required
            />
          </label>
          <label>
            댓글
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={4000}
              rows={3}
              required
            />
          </label>
          <button type="submit" className="community-submit" disabled={busy}>
            {busy ? "등록 중…" : "댓글 등록"}
          </button>
        </form>
        {error ? <p className="empty warn">{error}</p> : null}
      </section>
    </div>
  );
}
