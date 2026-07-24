/** Anonymous community accounts use a synthetic email under this domain. */
export const COMMUNITY_AUTH_EMAIL_DOMAIN = "anon.savvyetf.community";

const USERNAME_RE = /^[a-zA-Z0-9_]{3,24}$/;

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export function validateUsername(raw: string): string | null {
  const username = normalizeUsername(raw);
  if (!USERNAME_RE.test(username)) {
    return "아이디는 영문·숫자·밑줄(_) 3~24자여야 합니다.";
  }
  if (username.startsWith("_") || username.endsWith("_")) {
    return "아이디는 밑줄로 시작하거나 끝날 수 없습니다.";
  }
  return null;
}

export function validatePassword(password: string): string | null {
  if (password.length < 8) return "비밀번호는 8자 이상이어야 합니다.";
  if (password.length > 72) return "비밀번호가 너무 깁니다.";
  return null;
}

export function usernameToEmail(username: string): string {
  return `${normalizeUsername(username)}@${COMMUNITY_AUTH_EMAIL_DOMAIN}`;
}

export function emailToUsername(email: string | null | undefined): string | null {
  if (!email) return null;
  const lower = email.toLowerCase();
  const suffix = `@${COMMUNITY_AUTH_EMAIL_DOMAIN}`;
  if (!lower.endsWith(suffix)) return null;
  return lower.slice(0, -suffix.length);
}

export function isAnonCommunityEmail(email: string | null | undefined): boolean {
  return Boolean(emailToUsername(email));
}
