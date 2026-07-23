import {
  CommunityHome,
  CommunitySetupNotice,
} from "@/components/CommunityBoard";
import SiteChrome from "@/components/SiteChrome";
import {
  isCommunityCategory,
  type CommunityPost,
  type CommunityProfile,
} from "@/lib/community";
import {
  communityAdminEmails,
  supabaseConfigured,
} from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ category?: string; error?: string }>;

export default async function CommunityPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const category =
    sp.category && isCommunityCategory(sp.category) ? sp.category : null;
  const rawError = sp.error ? decodeURIComponent(sp.error) : null;
  const errorMsg =
    rawError === "auth"
      ? "Google 로그인에 실패했습니다. 다시 시도해 주세요."
      : rawError === "not_configured"
        ? "Supabase 환경 변수가 설정되지 않았습니다."
        : rawError;

  if (!supabaseConfigured()) {
    return (
      <SiteChrome active="community" meta="커뮤니티 설정 필요">
        <CommunitySetupNotice />
      </SiteChrome>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let profile: CommunityProfile | null = null;
  if (user) {
    const { data } = await supabase
      .from("profiles")
      .select("id, display_name, avatar_url")
      .eq("id", user.id)
      .maybeSingle();
    profile = (data as CommunityProfile | null) || {
      id: user.id,
      display_name:
        (user.user_metadata?.full_name as string | undefined) ||
        user.email?.split("@")[0] ||
        "member",
      avatar_url: (user.user_metadata?.avatar_url as string | undefined) || null,
    };
  }

  let query = supabase
    .from("posts")
    .select(
      "id, author_id, category, title, body, created_at, updated_at, profiles(id, display_name, avatar_url)",
    )
    .order("created_at", { ascending: false })
    .limit(50);
  if (category) query = query.eq("category", category);

  const { data: rows, error } = await query;
  const posts = ((rows || []) as unknown as CommunityPost[]).map((p) => ({
    ...p,
    profiles: Array.isArray(p.profiles) ? p.profiles[0] : p.profiles,
  }));

  // Comment counts (lightweight second query)
  const ids = posts.map((p) => p.id);
  const counts = new Map<string, number>();
  if (ids.length) {
    const { data: commentRows } = await supabase
      .from("comments")
      .select("post_id")
      .in("post_id", ids);
    for (const row of commentRows || []) {
      const pid = (row as { post_id: string }).post_id;
      counts.set(pid, (counts.get(pid) || 0) + 1);
    }
  }
  for (const p of posts) {
    p.comment_count = counts.get(p.id) || 0;
  }

  const isAdmin = communityAdminEmails().has((user?.email || "").toLowerCase());

  return (
    <SiteChrome
      active="community"
      meta={
        user
          ? `${profile?.display_name} 로그인됨`
          : "누구나 열람 · 글쓰기는 익명 아이디"
      }
    >
      <CommunityHome
        posts={posts}
        profile={profile}
        email={user?.email || null}
        isAdmin={isAdmin}
        category={category}
        error={errorMsg || error?.message}
      />
    </SiteChrome>
  );
}
