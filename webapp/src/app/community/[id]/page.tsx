import { notFound } from "next/navigation";

import { CommunityPostDetail } from "@/components/CommunityBoard";
import SiteChrome from "@/components/SiteChrome";
import type { CommunityComment, CommunityPost, CommunityProfile } from "@/lib/community";
import {
  communityAdminEmails,
  supabaseConfigured,
} from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

export default async function CommunityPostPage({
  params,
}: {
  params: Params;
}) {
  const { id } = await params;

  if (!supabaseConfigured()) {
    notFound();
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

  const { data: postRow } = await supabase
    .from("posts")
    .select(
      "id, author_id, category, title, body, created_at, updated_at, profiles(id, display_name, avatar_url)",
    )
    .eq("id", id)
    .maybeSingle();

  if (!postRow) notFound();

  const rawPost = postRow as unknown as CommunityPost & {
    profiles?: CommunityProfile | CommunityProfile[] | null;
  };
  const post: CommunityPost = {
    ...rawPost,
    profiles: Array.isArray(rawPost.profiles)
      ? rawPost.profiles[0]
      : rawPost.profiles,
  };

  const { data: commentRows } = await supabase
    .from("comments")
    .select(
      "id, post_id, author_id, body, created_at, profiles(id, display_name, avatar_url)",
    )
    .eq("post_id", id)
    .order("created_at", { ascending: true });

  const comments: CommunityComment[] = (commentRows || []).map((row) => {
    const c = row as unknown as CommunityComment & {
      profiles?: CommunityProfile | CommunityProfile[] | null;
    };
    return {
      ...c,
      profiles: Array.isArray(c.profiles) ? c.profiles[0] : c.profiles,
    };
  });

  const isAdmin = communityAdminEmails().has((user?.email || "").toLowerCase());

  return (
    <SiteChrome active="community" meta={post.title}>
      <CommunityPostDetail
        post={post}
        comments={comments}
        profile={profile}
        email={user?.email || null}
        isAdmin={isAdmin}
      />
    </SiteChrome>
  );
}
