export const COMMUNITY_CATEGORIES = [
  { id: "question", label: "질문" },
  { id: "idea", label: "아이디어" },
  { id: "feedback", label: "피드백" },
] as const;

export type CommunityCategory = (typeof COMMUNITY_CATEGORIES)[number]["id"];

export type CommunityProfile = {
  id: string;
  display_name: string;
  avatar_url: string | null;
};

export type CommunityPost = {
  id: string;
  author_id: string;
  category: CommunityCategory;
  title: string;
  body: string;
  created_at: string;
  updated_at: string;
  profiles?: CommunityProfile | null;
  comment_count?: number;
};

export type CommunityComment = {
  id: string;
  post_id: string;
  author_id: string;
  body: string;
  created_at: string;
  profiles?: CommunityProfile | null;
};

export function categoryLabel(id: string): string {
  return COMMUNITY_CATEGORIES.find((c) => c.id === id)?.label || id;
}

export function isCommunityCategory(value: string): value is CommunityCategory {
  return COMMUNITY_CATEGORIES.some((c) => c.id === value);
}
