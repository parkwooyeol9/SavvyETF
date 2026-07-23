/**
 * HTML sanitizers for dashboard ingest.
 *
 * - sanitizeBriefHtml: Telegram-style fragments for dangerouslySetInnerHTML
 * - sanitizeDocumentHtml: full brief pages for sandboxed iframe srcDoc
 *   (must preserve layout tags — do NOT run Telegram allowlist on these)
 */

const FRAGMENT_TAGS = new Set([
  "b",
  "strong",
  "i",
  "em",
  "u",
  "s",
  "strike",
  "del",
  "code",
  "pre",
  "a",
  "br",
  "span",
  "p",
  "ul",
  "ol",
  "li",
]);

function escapeText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sanitizeAttributes(tag: string, rawAttrs: string): string {
  if (tag !== "a") return "";
  const hrefMatch = rawAttrs.match(/\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
  if (!hrefMatch) return "";
  const href = (hrefMatch[2] ?? hrefMatch[3] ?? hrefMatch[4] ?? "").trim();
  if (!/^(https?:|mailto:|tg:)/i.test(href)) return "";
  if (/^\s*javascript:/i.test(href)) return "";
  const safe = href.replace(/"/g, "&quot;");
  return ` href="${safe}" rel="noopener noreferrer" target="_blank"`;
}

/** Telegram HTML fragments only (sections). */
export function sanitizeBriefHtml(input: string): string {
  if (!input) return "";
  const html = input
    .replace(/<\s*(script|style|iframe|object|embed|link|meta)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*(script|style|iframe|object|embed|link|meta)[^>]*\/?\s*>/gi, "");

  const out: string[] = [];
  const tokenRe = /<\/?([a-zA-Z0-9]+)(\s[^>]*)?>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(html)) !== null) {
    if (m[3] != null) {
      out.push(escapeText(m[3]));
      continue;
    }
    const tag = (m[1] || "").toLowerCase();
    const full = m[0];
    const closing = full.startsWith("</");
    if (!FRAGMENT_TAGS.has(tag)) continue;
    if (closing) {
      out.push(`</${tag}>`);
      continue;
    }
    if (tag === "br") {
      out.push("<br/>");
      continue;
    }
    const attrs = sanitizeAttributes(tag, m[2] || "");
    out.push(`<${tag}${attrs}>`);
  }
  return out.join("");
}

/**
 * Full HTML documents rendered in <iframe sandbox="">.
 * Keep structure; only strip executable bits (scripts already blocked by sandbox).
 */
export function sanitizeDocumentHtml(input: string): string {
  if (!input) return "";
  return input
    .replace(/<\s*script[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi, "")
    .replace(/<\s*script[^>]*\/?\s*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript\s*:/gi, "");
}
