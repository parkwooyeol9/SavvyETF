import type { MetadataRoute } from "next";

const AI_CRAWLERS = [
  "GPTBot",
  "ClaudeBot",
  "anthropic-ai",
  "CCBot",
  "Google-Extended",
  "PerplexityBot",
  "Bytespider",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", disallow: "/api/" },
      { userAgent: AI_CRAWLERS, disallow: "/" },
    ],
  };
}
