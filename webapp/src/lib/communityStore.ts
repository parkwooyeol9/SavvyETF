/**
 * Lightweight community board stored as one JSON object in R2.
 * No Supabase / Google — nickname + optional delete key.
 */

import { randomBytes, randomUUID } from "crypto";

import { r2Configured, r2GetObjectText, r2PutObject } from "@/lib/r2";
import {
  COMMUNITY_CATEGORIES,
  isCommunityCategory,
  type CommunityCategory,
} from "@/lib/community";

const STORE_KEY = "community/board.json";
const MAX_POSTS = 200;
const MAX_COMMENTS_PER_POST = 100;

export type BoardComment = {
  id: string;
  nickname: string;
  body: string;
  created_at: string;
  delete_key: string;
};

export type BoardPost = {
  id: string;
  category: CommunityCategory;
  title: string;
  body: string;
  nickname: string;
  created_at: string;
  delete_key: string;
  comments: BoardComment[];
};

export type BoardStore = {
  updated_at: string;
  posts: BoardPost[];
};

function emptyStore(): BoardStore {
  return { updated_at: new Date().toISOString(), posts: [] };
}

function newDeleteKey(): string {
  return randomBytes(12).toString("hex");
}

export function communityBoardConfigured(): boolean {
  return r2Configured();
}

export async function loadBoard(): Promise<BoardStore> {
  if (!r2Configured()) return emptyStore();
  const raw = await r2GetObjectText(STORE_KEY);
  if (!raw) return emptyStore();
  try {
    const parsed = JSON.parse(raw) as BoardStore;
    if (!parsed || !Array.isArray(parsed.posts)) return emptyStore();
    return {
      updated_at: parsed.updated_at || new Date().toISOString(),
      posts: parsed.posts,
    };
  } catch {
    return emptyStore();
  }
}

async function saveBoard(store: BoardStore): Promise<void> {
  store.updated_at = new Date().toISOString();
  // Keep newest first, cap size
  store.posts = store.posts
    .slice()
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .slice(0, MAX_POSTS);
  await r2PutObject(
    STORE_KEY,
    JSON.stringify(store),
    "application/json; charset=utf-8",
    "private, max-age=0",
  );
}

export function sanitizeNickname(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").slice(0, 24);
}

export function publicPost(post: BoardPost) {
  const { delete_key: _dk, comments, ...rest } = post;
  return {
    ...rest,
    comment_count: comments.length,
    comments: comments.map(({ delete_key: _c, ...c }) => c),
  };
}

export function publicPostList(store: BoardStore, category?: string | null) {
  let posts = store.posts;
  if (category && isCommunityCategory(category)) {
    posts = posts.filter((p) => p.category === category);
  }
  return posts.map((p) => {
    const { delete_key: _dk, comments, ...rest } = p;
    return { ...rest, comment_count: comments.length };
  });
}

export async function createPost(input: {
  nickname: string;
  title: string;
  body: string;
  category: string;
}): Promise<{ post: ReturnType<typeof publicPost>; delete_key: string }> {
  if (!r2Configured()) throw new Error("게시판 저장소(R2)가 설정되지 않았습니다.");
  const nickname = sanitizeNickname(input.nickname);
  const title = input.title.trim().slice(0, 120);
  const body = input.body.trim().slice(0, 8000);
  if (nickname.length < 1) throw new Error("닉네임을 입력해 주세요.");
  if (title.length < 2) throw new Error("제목은 2자 이상이어야 합니다.");
  if (body.length < 2) throw new Error("본문은 2자 이상이어야 합니다.");
  if (!isCommunityCategory(input.category)) {
    throw new Error("잘못된 카테고리입니다.");
  }

  const store = await loadBoard();
  const delete_key = newDeleteKey();
  const post: BoardPost = {
    id: randomUUID(),
    category: input.category,
    title,
    body,
    nickname,
    created_at: new Date().toISOString(),
    delete_key,
    comments: [],
  };
  store.posts.unshift(post);
  await saveBoard(store);
  return { post: publicPost(post), delete_key };
}

export async function createComment(input: {
  postId: string;
  nickname: string;
  body: string;
}): Promise<{ comment: Omit<BoardComment, "delete_key">; delete_key: string }> {
  if (!r2Configured()) throw new Error("게시판 저장소(R2)가 설정되지 않았습니다.");
  const nickname = sanitizeNickname(input.nickname);
  const body = input.body.trim().slice(0, 4000);
  if (nickname.length < 1) throw new Error("닉네임을 입력해 주세요.");
  if (body.length < 1) throw new Error("댓글을 입력해 주세요.");

  const store = await loadBoard();
  const post = store.posts.find((p) => p.id === input.postId);
  if (!post) throw new Error("게시글을 찾을 수 없습니다.");
  if (post.comments.length >= MAX_COMMENTS_PER_POST) {
    throw new Error("댓글 수가 한도에 도달했습니다.");
  }
  const delete_key = newDeleteKey();
  const comment: BoardComment = {
    id: randomUUID(),
    nickname,
    body,
    created_at: new Date().toISOString(),
    delete_key,
  };
  post.comments.push(comment);
  await saveBoard(store);
  const { delete_key: _d, ...pub } = comment;
  return { comment: pub, delete_key };
}

export async function deletePost(
  postId: string,
  deleteKey: string,
  adminSecret?: string,
): Promise<void> {
  if (!r2Configured()) throw new Error("게시판 저장소(R2)가 설정되지 않았습니다.");
  const store = await loadBoard();
  const post = store.posts.find((p) => p.id === postId);
  if (!post) throw new Error("게시글을 찾을 수 없습니다.");
  const admin =
    adminSecret &&
    process.env.COMMUNITY_ADMIN_SECRET?.trim() &&
    adminSecret === process.env.COMMUNITY_ADMIN_SECRET.trim();
  if (!admin && post.delete_key !== deleteKey) {
    throw new Error("삭제 권한이 없습니다.");
  }
  store.posts = store.posts.filter((p) => p.id !== postId);
  await saveBoard(store);
}

export { COMMUNITY_CATEGORIES };
