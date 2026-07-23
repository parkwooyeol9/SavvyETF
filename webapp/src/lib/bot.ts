/** Base URL for the Render Telegram bot (heatmap / optional APIs). */
export function botBaseUrl(): string {
  const fromEnv = (process.env.RENDER_BOT_URL || process.env.BOT_PUBLIC_URL || "").trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  return "https://savvyetf-bot.onrender.com";
}

function botWebHeaders(extra?: HeadersInit): HeadersInit {
  const secret = (process.env.BOT_WEB_API_SECRET || "").trim();
  return {
    Accept: "application/json",
    ...(secret
      ? { Authorization: `Bearer ${secret}`, "X-Bot-Web-Key": secret }
      : {}),
    ...(extra || {}),
  };
}

export async function fetchBotJson<T>(
  path: string,
  init?: RequestInit & { timeoutMs?: number },
): Promise<T> {
  const timeoutMs = init?.timeoutMs ?? 45_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${botBaseUrl()}${path}`, {
      ...init,
      signal: controller.signal,
      headers: botWebHeaders(init?.headers),
      cache: "no-store",
    });
    const data = (await res.json()) as T;
    return data;
  } finally {
    clearTimeout(timer);
  }
}
