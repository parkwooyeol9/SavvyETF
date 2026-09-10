export const ADMIN_STORAGE_KEY = "savvy_admin";

const LEGACY_KEYS = ["savvy_cardnews_admin", "savvy_research_admin"];

export function loadAdminSecret(): string {
  if (typeof window === "undefined") return "";
  const current = window.sessionStorage.getItem(ADMIN_STORAGE_KEY);
  if (current) return current;
  for (const key of LEGACY_KEYS) {
    const legacy = window.sessionStorage.getItem(key);
    if (legacy) {
      window.sessionStorage.setItem(ADMIN_STORAGE_KEY, legacy);
      return legacy;
    }
  }
  return "";
}

export function saveAdminSecret(secret: string) {
  window.sessionStorage.setItem(ADMIN_STORAGE_KEY, secret);
  for (const key of LEGACY_KEYS) {
    window.sessionStorage.setItem(key, secret);
  }
}

export function clearAdminSecret() {
  window.sessionStorage.removeItem(ADMIN_STORAGE_KEY);
  for (const key of LEGACY_KEYS) {
    window.sessionStorage.removeItem(key);
  }
}
