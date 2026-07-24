"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  isCommunityCategory,
  type CommunityCategory,
} from "@/lib/community";
import {
  communityAdminEmails,
  supabaseConfigured,
} from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

function fail(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

async function requireUser(backPath: string) {
  if (!supabaseConfigured()) {
    fail(backPath, "커뮤니티가 아직 설정되지 않았습니다.");
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) fail(backPath, "로그인이 필요합니다.");
  return { supabase, user };
}

async function ensureProfile(
  supabase: Awaited<ReturnType<typeof createClient>>,
  user: { id: string; email?: string | null; user_metadata?: Record<string, unknown> },
) {
  await supabase.from("profiles").upsert(
    {
      id: user.id,
      display_name: String(
        user.user_metadata?.full_name ||
          user.user_metadata?.name ||
          user.email?.split("@")[0] ||
          "member",
      ).slice(0, 40),
      avatar_url: (user.user_metadata?.avatar_url as string | undefined) || null,
    },
    { onConflict: "id" },
  );
}

export async function createPostAction(formData: FormData) {
  const { supabase, user } = await requireUser("/community");
  const title = String(formData.get("title") || "").trim();
  const body = String(formData.get("body") || "").trim();
  const categoryRaw = String(formData.get("category") || "question");
  if (!isCommunityCategory(categoryRaw)) {
    fail("/community", "잘못된 카테고리입니다.");
  }
  const category: CommunityCategory = categoryRaw;
  if (title.length < 2 || title.length > 120) {
    fail("/community", "제목은 2~120자여야 합니다.");
  }
  if (body.length < 2 || body.length > 8000) {
    fail("/community", "본문은 2~8000자여야 합니다.");
  }

  await ensureProfile(supabase, user);
  const { error } = await supabase.from("posts").insert({
    author_id: user.id,
    category,
    title,
    body,
  });
  if (error) fail("/community", error.message);
  revalidatePath("/community");
  redirect("/community");
}

export async function createCommentAction(formData: FormData) {
  const postId = String(formData.get("post_id") || "").trim();
  const back = postId ? `/community/${postId}` : "/community";
  const { supabase, user } = await requireUser(back);
  const body = String(formData.get("body") || "").trim();
  if (!postId) fail("/community", "게시글이 없습니다.");
  if (body.length < 1 || body.length > 4000) {
    fail(back, "댓글은 1~4000자여야 합니다.");
  }

  await ensureProfile(supabase, user);
  const { error } = await supabase.from("comments").insert({
    post_id: postId,
    author_id: user.id,
    body,
  });
  if (error) fail(back, error.message);
  revalidatePath("/community");
  revalidatePath(back);
  redirect(back);
}

export async function deletePostAction(formData: FormData) {
  const postId = String(formData.get("post_id") || "").trim();
  const { supabase, user } = await requireUser("/community");
  if (!postId) fail("/community", "게시글이 없습니다.");

  const { data: post } = await supabase
    .from("posts")
    .select("author_id")
    .eq("id", postId)
    .maybeSingle();
  if (!post) fail("/community", "게시글을 찾을 수 없습니다.");

  const isAdmin = communityAdminEmails().has((user.email || "").toLowerCase());
  if (post.author_id !== user.id && !isAdmin) {
    fail("/community", "삭제 권한이 없습니다.");
  }

  if (post.author_id !== user.id && isAdmin) {
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    if (!serviceKey) {
      fail("/community", "관리자 삭제에는 SUPABASE_SERVICE_ROLE_KEY가 필요합니다.");
    }
    const { createClient: createAdmin } = await import("@supabase/supabase-js");
    const admin = createAdmin(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceKey,
      { auth: { persistSession: false } },
    );
    const { error } = await admin.from("posts").delete().eq("id", postId);
    if (error) fail("/community", error.message);
  } else {
    const { error } = await supabase.from("posts").delete().eq("id", postId);
    if (error) fail("/community", error.message);
  }

  revalidatePath("/community");
  redirect("/community");
}

export async function updateDisplayNameAction(formData: FormData) {
  const { supabase, user } = await requireUser("/community");
  const name = String(formData.get("display_name") || "").trim();
  if (name.length < 1 || name.length > 40) {
    fail("/community", "닉네임은 1~40자여야 합니다.");
  }
  const { error } = await supabase
    .from("profiles")
    .update({ display_name: name, updated_at: new Date().toISOString() })
    .eq("id", user.id);
  if (error) fail("/community", error.message);
  revalidatePath("/community");
  redirect("/community");
}
