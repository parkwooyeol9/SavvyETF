import Link from "next/link";

import GoogleSignInButton from "@/components/GoogleSignInButton";
import {
  createCommentAction,
  createPostAction,
  deletePostAction,
  updateDisplayNameAction,
} from "@/app/community/actions";
import {
  COMMUNITY_CATEGORIES,
  categoryLabel,
  type CommunityComment,
  type CommunityPost,
  type CommunityProfile,
} from "@/lib/community";

function formatWhen(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("ko-KR", { hour12: false });
}

export function CommunitySetupNotice() {
  return (
    <section className="panel community-panel">
      <h1 className="community-title">커뮤니티</h1>
      <p className="community-lead">
        Google 로그인 기반의 가벼운 질문·피드백 게시판입니다. Supabase 환경
        변수가 아직 없어 읽기/쓰기가 비활성화되어 있습니다.
      </p>
      <ol className="community-setup">
        <li>Supabase 프로젝트를 만들고 Google provider를 켭니다.</li>
        <li>
          <code>webapp/supabase/schema.sql</code> 을 SQL Editor에서 실행합니다.
        </li>
        <li>
          Vercel에{" "}
          <code>NEXT_PUBLIC_SUPABASE_URL</code>,{" "}
          <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> 를 넣습니다.
        </li>
        <li>
          Google Cloud OAuth 리다이렉트에{" "}
          <code>https://&lt;project&gt;.supabase.co/auth/v1/callback</code> 를
          등록합니다.
        </li>
      </ol>
      <p className="meta-soft">상세: webapp/README.md → Community 섹션</p>
    </section>
  );
}

export function CommunityHome({
  posts,
  profile,
  email,
  isAdmin,
  category,
  error,
}: {
  posts: CommunityPost[];
  profile: CommunityProfile | null;
  email: string | null;
  isAdmin: boolean;
  category: string | null;
  error?: string | null;
}) {
  const loggedIn = Boolean(profile);

  return (
    <div className="community-page">
      <section className="panel community-panel">
        <div className="community-head">
          <div>
            <h1 className="community-title">커뮤니티</h1>
            <p className="community-lead">
              시황은 텔레그램·대시보드, 여기는 질문·아이디어·피드백을 남기는
              공간입니다. 글쓰기는 Google 로그인이 필요합니다.
            </p>
          </div>
          <div className="community-userbox">
            {loggedIn ? (
              <>
                <div className="community-user">
                  {profile?.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={profile.avatar_url}
                      alt=""
                      className="community-avatar"
                    />
                  ) : null}
                  <div>
                    <strong>{profile?.display_name}</strong>
                    <div className="meta-soft">{email}</div>
                  </div>
                </div>
                <form action={updateDisplayNameAction} className="community-nick-form">
                  <input
                    name="display_name"
                    defaultValue={profile?.display_name || ""}
                    maxLength={40}
                    placeholder="닉네임"
                    aria-label="닉네임"
                  />
                  <button type="submit" className="ghost-btn">
                    닉네임 저장
                  </button>
                </form>
                <form action="/auth/signout" method="post">
                  <button type="submit" className="ghost-btn">
                    로그아웃
                  </button>
                </form>
              </>
            ) : (
              <GoogleSignInButton />
            )}
          </div>
        </div>

        {error ? <p className="empty warn">{error}</p> : null}

        <div className="chip-row community-filters" role="tablist" aria-label="카테고리">
          <Link
            href="/community"
            className={`chip ${!category ? "active" : ""}`}
          >
            전체
          </Link>
          {COMMUNITY_CATEGORIES.map((c) => (
            <Link
              key={c.id}
              href={`/community?category=${c.id}`}
              className={`chip ${category === c.id ? "active" : ""}`}
            >
              {c.label}
            </Link>
          ))}
        </div>
      </section>

      {loggedIn ? (
        <section className="panel community-panel">
          <h2 className="community-section-title">새 글 쓰기</h2>
          <form action={createPostAction} className="community-compose">
            <label>
              카테고리
              <select name="category" defaultValue="question">
                {COMMUNITY_CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              제목
              <input name="title" required maxLength={120} placeholder="짧게 요약" />
            </label>
            <label>
              본문
              <textarea
                name="body"
                required
                maxLength={8000}
                rows={5}
                placeholder="질문·아이디어·피드백을 적어 주세요"
              />
            </label>
            <button type="submit" className="community-submit">
              등록
            </button>
          </form>
        </section>
      ) : (
        <section className="panel community-panel">
          <p className="empty">글을 쓰려면 Google로 로그인해 주세요. 열람은 자유입니다.</p>
        </section>
      )}

      <section className="panel community-panel">
        <h2 className="community-section-title">게시글</h2>
        {!posts.length ? (
          <p className="empty">아직 글이 없습니다. 첫 질문을 남겨 보세요.</p>
        ) : (
          <ul className="community-post-list">
            {posts.map((post) => (
              <li key={post.id} className="community-post-item">
                <div className="community-post-meta">
                  <span className="community-cat">
                    {categoryLabel(post.category)}
                  </span>
                  <span className="meta-soft">
                    {post.profiles?.display_name || "member"} ·{" "}
                    {formatWhen(post.created_at)}
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
                {(profile?.id === post.author_id || isAdmin) && (
                  <form action={deletePostAction}>
                    <input type="hidden" name="post_id" value={post.id} />
                    <button type="submit" className="ghost-btn danger-btn">
                      삭제
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export function CommunityPostDetail({
  post,
  comments,
  profile,
  email,
  isAdmin,
}: {
  post: CommunityPost;
  comments: CommunityComment[];
  profile: CommunityProfile | null;
  email: string | null;
  isAdmin: boolean;
}) {
  const loggedIn = Boolean(profile);

  return (
    <div className="community-page">
      <section className="panel community-panel">
        <Link href="/community" className="community-back">
          ← 목록
        </Link>
        <div className="community-post-meta">
          <span className="community-cat">{categoryLabel(post.category)}</span>
          <span className="meta-soft">
            {post.profiles?.display_name || "member"} · {formatWhen(post.created_at)}
            {email && profile?.id === post.author_id ? ` · ${email}` : ""}
          </span>
        </div>
        <h1 className="community-title">{post.title}</h1>
        <p className="community-body">{post.body}</p>
        {(profile?.id === post.author_id || isAdmin) && (
          <form action={deletePostAction}>
            <input type="hidden" name="post_id" value={post.id} />
            <button type="submit" className="ghost-btn danger-btn">
              글 삭제
            </button>
          </form>
        )}
      </section>

      <section className="panel community-panel">
        <h2 className="community-section-title">댓글 {comments.length}</h2>
        {!comments.length ? <p className="empty">아직 댓글이 없습니다.</p> : null}
        <ul className="community-comment-list">
          {comments.map((c) => (
            <li key={c.id}>
              <div className="meta-soft">
                {c.profiles?.display_name || "member"} · {formatWhen(c.created_at)}
              </div>
              <p>{c.body}</p>
            </li>
          ))}
        </ul>

        {loggedIn ? (
          <form action={createCommentAction} className="community-compose">
            <input type="hidden" name="post_id" value={post.id} />
            <label>
              댓글
              <textarea name="body" required maxLength={4000} rows={3} />
            </label>
            <button type="submit" className="community-submit">
              댓글 등록
            </button>
          </form>
        ) : (
          <div className="community-auth-inline">
            <p className="empty">댓글을 쓰려면 로그인해 주세요.</p>
            <GoogleSignInButton next={`/community/${post.id}`} />
          </div>
        )}
      </section>
    </div>
  );
}
