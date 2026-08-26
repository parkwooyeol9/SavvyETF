import type { BriefSlot } from "@/lib/types";

/**
 * Prepare full brief HTML for sandboxed iframe srcDoc.
 *
 * Briefs link to Render `/css/styles.css` + Google Fonts, but the dashboard
 * CSP + empty sandbox often block those loads → black text on the dark
 * iframe chrome. Always inject a self-contained dark theme.
 */

const BRIEF_THEME_CSS = `
:root {
  --bg: #0b1018;
  --panel: #141d2b;
  --panel-2: #1a2538;
  --text: #e8eef5;
  --muted: #8fa3b8;
  --accent: #4da3ff;
  --accent-2: #3dd68c;
  --warn: #fbbf24;
  --border: #2b3648;
  --radius: 14px;
  --sans: "DM Sans", "Pretendard", "Noto Sans KR", system-ui, sans-serif;
  --serif: "Instrument Serif", Georgia, "Noto Serif KR", serif;
}
html, body {
  margin: 0 !important;
  padding: 0;
  background: var(--bg) !important;
  color: var(--text) !important;
  font-family: var(--sans);
  font-size: 15px;
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
}
a { color: var(--accent) !important; }
h1, h2, h3, h4, h5 { color: var(--text); }
p, li, td, th, span, div, label { color: inherit; }
table { color: var(--text); border-color: var(--border); }
.meta, .muted, caption, figcaption { color: var(--muted) !important; }
.pos { color: var(--accent-2) !important; }
.neg { color: #ff6b6b !important; }
img { max-width: 100%; height: auto; }
/* Widen Telegram brief layouts inside dashboard iframe */
:root {
  --container: min(100%, calc(100% - 0.75rem)) !important;
}
.summary-wrap,
.wrap,
.container {
  max-width: none !important;
  width: 100% !important;
  margin-left: 0 !important;
  margin-right: 0 !important;
  padding-left: 0.65rem !important;
  padding-right: 0.65rem !important;
  box-sizing: border-box !important;
}
.hero .lead,
.feature-lead {
  max-width: none !important;
}
`.trim();

const THEME_STYLE_TAG = `<style id="savvyetf-brief-theme">${BRIEF_THEME_CSS}</style>`;

/** Fragment wrapper when brief HTML is not a full document. */
export function wrapBriefFragment(html: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>${THEME_STYLE_TAG}</head><body>${html}</body></html>`;
}

/**
 * Ensure a full HTML document has readable dark-theme colors even when
 * external stylesheets cannot load inside the sandboxed iframe.
 */
export function prepareBriefSrcDoc(html: string): string {
  const trimmed = html.trim();
  if (!trimmed) return wrapBriefFragment("");
  if (!/^<!DOCTYPE|^<html/i.test(trimmed)) {
    return wrapBriefFragment(trimmed);
  }

  // Prefer injecting into <head>; otherwise before </html> / at end.
  if (/<head[^>]*>/i.test(trimmed)) {
    return trimmed.replace(/<head([^>]*)>/i, `<head$1>${THEME_STYLE_TAG}`);
  }
  if (/<html[^>]*>/i.test(trimmed)) {
    return trimmed.replace(/<html([^>]*)>/i, `<html$1><head>${THEME_STYLE_TAG}</head>`);
  }
  return wrapBriefFragment(trimmed);
}

const US_SUMMARY_MACRO_LABEL_RE =
  /macro\s+(dashboard|risk\s*monitor|monitor)/i;

/** Drop the retired US /summary macro appendix from stored HTML. */
export function stripUsSummaryMacroHtml(html: string): string {
  let out = html;
  out = out.replace(
    /<hr[^>]*class=['"]section-divider['"][^>]*\/?>\s*<section[^>]*appendix-section[^>]*>[\s\S]*?Macro Risk Monitor[\s\S]*?<\/section>/gi,
    "",
  );
  out = out.replace(
    /<section[^>]*class=['"][^'"]*appendix-section[^'"]*['"][^>]*>[\s\S]*?Macro Risk Monitor[\s\S]*?<\/section>/gi,
    "",
  );
  out = out.replace(
    /<span[^>]*class=['"]pill['"][^>]*>\s*Macro monitor\s*<\/span>\s*/gi,
    "",
  );
  out = out.replace(
    /📊\s*Macro dashboard[\s\S]{0,300}?\(unavailable:[^)]*\)/gi,
    "",
  );
  return out;
}

export function stripUsSummaryMacroSlot(slot: BriefSlot): BriefSlot {
  if (slot.slot !== "summary") return slot;
  const html = slot.html ? stripUsSummaryMacroHtml(slot.html) : slot.html;
  const sections = (slot.sections || []).filter((section) => {
    const blob = `${section.heading || ""}\n${section.html_or_text || ""}`;
    return !US_SUMMARY_MACRO_LABEL_RE.test(blob);
  });
  const images = (slot.images || []).filter(
    (image) => !US_SUMMARY_MACRO_LABEL_RE.test(image.caption || ""),
  );
  return {
    ...slot,
    html,
    sections: slot.sections ? sections : undefined,
    images: slot.images ? images : undefined,
  };
}
