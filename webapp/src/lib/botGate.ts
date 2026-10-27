/**
 * Edge-safe access gate for middleware: blocks scraper / AI-crawler user agents
 * and only lets the site's own pages read the public JSON APIs.
 *
 * Headers can be forged, so this stops casual copying (curl, python scripts,
 * crawlers), not a determined attacker. Admin-only data is still guarded by
 * `requireSiteAdmin` in each route.
 */

/** AI crawlers, SEO scrapers, HTTP libraries and headless browsers. */
const BLOCKED_UA =
  /gptbot|chatgpt-user|oai-searchbot|claudebot|claude-user|claude-searchbot|anthropic-ai|ccbot|google-extended|perplexity|bytespider|amazonbot|applebot-extended|meta-externalagent|meta-externalfetcher|cohere-ai|diffbot|imagesiftbot|timpibot|omgili|youbot|ai2bot|duckassistbot|petalbot|ahrefsbot|semrushbot|mj12bot|dotbot|dataforseobot|blexbot|serpstatbot|barkrowler|zoominfobot|scrapy|python-requests|python-urllib|python-httpx|aiohttp|httpx|curl\/|wget|go-http-client|java\/|okhttp|apache-httpclient|node-fetch|axios|undici|got \(|libwww-perl|php\/|guzzlehttp|ruby|postmanruntime|insomnia|headlesschrome|phantomjs|puppeteer|playwright|selenium|^node$/i;

/**
 * Routes outside the browser-only rule: cron + bot ingest carry their own
 * secrets, OAuth callbacks arrive as cross-site navigations, and brief images
 * load from a sandboxed (opaque-origin) iframe.
 */
const API_EXEMPT =
  /^\/api\/(?:cron\/|ingest(?:\/|$)|private-upload(?:\/|$)|tv\/oauth\/|briefs\/media\/)/;

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Server-to-server self calls (warm-cache, us-midterm-refresh) send `Bearer $CRON_SECRET`. */
function internalCaller(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  return Boolean(token) && constantTimeEqual(token, secret);
}

function hostOf(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).host;
  } catch {
    return null;
  }
}

/** Fetch issued by this site's own page (or same-site subdomain such as www). */
function fromOwnPage(request: Request, host: string): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site) return site === "same-origin" || site === "same-site";
  // Older browsers without Fetch Metadata: fall back to Origin / Referer.
  const from = hostOf(request.headers.get("origin")) || hostOf(request.headers.get("referer"));
  return from === host;
}

export type GateVerdict = { ok: true } | { ok: false; reason: "bot" | "cross-origin" };

export function checkAccess(request: Request, pathname: string, host: string): GateVerdict {
  // Well-behaved crawlers must be able to read the rules that turn them away.
  if (pathname === "/robots.txt") return { ok: true };
  const isApi = pathname.startsWith("/api/");
  if (isApi && API_EXEMPT.test(pathname)) return { ok: true };
  if (isApi && internalCaller(request)) return { ok: true };

  const ua = request.headers.get("user-agent") || "";
  if (!ua.trim() || BLOCKED_UA.test(ua)) return { ok: false, reason: "bot" };

  const method = request.method.toUpperCase();
  if (isApi && (method === "GET" || method === "HEAD") && !fromOwnPage(request, host)) {
    return { ok: false, reason: "cross-origin" };
  }
  return { ok: true };
}
