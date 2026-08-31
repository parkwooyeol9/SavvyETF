/** Base URL for the Render Telegram bot (heatmap / optional APIs). */
export function botBaseUrl(): string {
  const fromEnv = (process.env.RENDER_BOT_URL || process.env.BOT_PUBLIC_URL || "").trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  return "https://savvyetf-bot.onrender.com";
}

function botWebHeaders(extra?: HeadersInit): HeadersInit {
  const secret = (
    process.env.BOT_WEB_API_SECRET ||
    process.env.WEB_INGEST_SECRET ||
    ""
  ).trim();
  return {
    Accept: "application/json",
    ...(secret
      ? { Authorization: `Bearer ${secret}`, "X-Bot-Web-Key": secret }
      : {}),
    ...(extra || {}),
  };
}

function looksLikeHtml(text: string): boolean {
  const head = text.trimStart().slice(0, 32).toLowerCase();
  return (
    head.startsWith("<!doctype") ||
    head.startsWith("<html") ||
    head.startsWith("<head") ||
    head.startsWith("<body")
  );
}

/**
 * Fetch JSON from the Render bot. Never call res.json() blindly —
 * Render gateway timeouts return HTML 502 pages, which previously
 * surfaced as: Unexpected token '<', "<!DOCTYPE "... is not valid JSON
 */
export async function fetchBotJson<T>(
  path: string,
  init?: RequestInit & { timeoutMs?: number },
): Promise<T> {
  const timeoutMs = init?.timeoutMs ?? 45_000;
  const base = botBaseUrl();
  if (!base) {
    throw new Error("RENDER_BOT_URL is not set");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}${path}`, {
      ...init,
      signal: controller.signal,
      headers: botWebHeaders(init?.headers),
      cache: "no-store",
    });
    const text = await res.text();
    const trimmed = text.trim();
    if (!trimmed) {
      throw new Error(`Bot ${path} returned empty body (HTTP ${res.status})`);
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error(`Bot ${path} unauthorized (HTTP ${res.status})`);
    }
    if (looksLikeHtml(trimmed)) {
      throw new Error(
        `Bot ${path} returned HTML instead of JSON (HTTP ${res.status}) — often a Render gateway timeout while the bot was busy`,
      );
    }
    try {
      return JSON.parse(trimmed) as T;
    } catch {
      throw new Error(
        `Bot ${path} returned non-JSON (HTTP ${res.status}): ${trimmed.slice(0, 120)}`,
      );
    }
  } finally {
    clearTimeout(timer);
  }
}
