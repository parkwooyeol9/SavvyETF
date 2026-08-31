/**
 * Lightweight community board stored as one JSON object in R2.
 * No Supabase / Google — nickname + optional delete key.
 */

import { randomBytes, randomUUID } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

import { r2Configured, r2GetObjectText, r2PutObject } from "@/lib/r2";
import { secretsEqual } from "@/lib/secretsEqual";
import {
  COMMUNITY_CATEGORIES,
  isCommunityCategory,
  type CommunityCategory,
} from "@/lib/community";

export type BoardKind = "community" | "bookclub";

const STORE_KEYS: Record<BoardKind, string> = {
  community: "community/board.json",
  bookclub: "community/bookclub.json",
};

const MAX_POSTS = 200;
const MAX_COMMENTS_PER_POST = 100;
const ANON_NICK = "익명";

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

function parseStore(raw: string | null): BoardStore {
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

function localBoardPath(kind: BoardKind): string {
  const dir =
    process.env.VERCEL === "1"
      ? "/tmp"
      : path.join(process.cwd(), "data");
  return path.join(dir, `${kind}-board.json`);
}

async function loadLocalBoard(kind: BoardKind): Promise<BoardStore> {
  try {
    const raw = await readFile(localBoardPath(kind), "utf8");
    return parseStore(raw);
  } catch {
    return emptyStore();
  }
}

async function saveLocalBoard(store: BoardStore, kind: BoardKind): Promise<void> {
  const file = localBoardPath(kind);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(store), "utf8");
}

export async function loadBoard(
  kind: BoardKind = "community",
): Promise<BoardStore> {
  if (r2Configured()) {
    const raw = await r2GetObjectText(STORE_KEYS[kind]);
    return parseStore(raw);
  }
  if (kind === "bookclub") return loadLocalBoard(kind);
  return emptyStore();
}

async function saveBoard(
  store: BoardStore,
  kind: BoardKind = "community",
): Promise<void> {
  store.updated_at = new Date().toISOString();
  // Keep newest first, cap size
  store.posts = store.posts
    .slice()
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .slice(0, MAX_POSTS);
  const payload = JSON.stringify(store);
  if (r2Configured()) {
    await r2PutObject(
      STORE_KEYS[kind],
      payload,
      "application/json; charset=utf-8",
      "private, max-age=0",
    );
    return;
  }
  if (kind !== "bookclub") {
    throw new Error("게시판 저장소(R2)가 설정되지 않았습니다.");
  }
  await saveLocalBoard(store, kind);
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
  board?: BoardKind;
}): Promise<{ post: ReturnType<typeof publicPost>; delete_key: string }> {
  const board = input.board || "community";
  if (!r2Configured() && board !== "bookclub") {
    throw new Error("게시판 저장소(R2)가 설정되지 않았습니다.");
  }
  const anonymous = board === "bookclub";
  let nickname = sanitizeNickname(input.nickname);
  if (anonymous && !nickname) nickname = ANON_NICK;
  const title = input.title.trim().slice(0, 120);
  const body = input.body.trim().slice(0, 8000);
  if (nickname.length < 1) throw new Error("닉네임을 입력해 주세요.");
  if (title.length < 2) throw new Error("제목은 2자 이상이어야 합니다.");
  if (body.length < 2) throw new Error("본문은 2자 이상이어야 합니다.");
  let category: CommunityCategory = "question";
  if (!anonymous) {
    if (!isCommunityCategory(input.category)) {
      throw new Error("잘못된 카테고리입니다.");
    }
    category = input.category;
  }

  const store = await loadBoard(board);
  const delete_key = newDeleteKey();
  const post: BoardPost = {
    id: randomUUID(),
    category,
    title,
    body,
    nickname,
    created_at: new Date().toISOString(),
    delete_key,
    comments: [],
  };
  store.posts.unshift(post);
  await saveBoard(store, board);
  return { post: publicPost(post), delete_key };
}

export async function createComment(input: {
  postId: string;
  nickname: string;
  body: string;
  board?: BoardKind;
}): Promise<{ comment: Omit<BoardComment, "delete_key">; delete_key: string }> {
  const board = input.board || "community";
  if (!r2Configured() && board !== "bookclub") {
    throw new Error("게시판 저장소(R2)가 설정되지 않았습니다.");
  }
  const anonymous = board === "bookclub";
  let nickname = sanitizeNickname(input.nickname);
  if (anonymous && !nickname) nickname = ANON_NICK;
  const body = input.body.trim().slice(0, 4000);
  if (nickname.length < 1) throw new Error("닉네임을 입력해 주세요.");
  if (body.length < 1) throw new Error("댓글을 입력해 주세요.");

  const store = await loadBoard(board);
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
  await saveBoard(store, board);
  const { delete_key: _d, ...pub } = comment;
  return { comment: pub, delete_key };
}

export async function deletePost(
  postId: string,
  deleteKey: string,
  adminSecret?: string,
  board: BoardKind = "community",
): Promise<void> {
  if (!r2Configured() && board !== "bookclub") {
    throw new Error("게시판 저장소(R2)가 설정되지 않았습니다.");
  }
  const store = await loadBoard(board);
  const post = store.posts.find((p) => p.id === postId);
  if (!post) throw new Error("게시글을 찾을 수 없습니다.");
  const adminSecretEnv = process.env.COMMUNITY_ADMIN_SECRET?.trim() || "";
  const admin =
    Boolean(adminSecret && adminSecretEnv) &&
    secretsEqual(adminSecret, adminSecretEnv);
  if (!admin && post.delete_key !== deleteKey) {
    throw new Error("삭제 권한이 없습니다.");
  }
  store.posts = store.posts.filter((p) => p.id !== postId);
  await saveBoard(store, board);
}

export { COMMUNITY_CATEGORIES };
