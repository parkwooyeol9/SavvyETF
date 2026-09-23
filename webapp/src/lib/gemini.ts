/**
 * Thin Gemini generateContent helper (JSON response).
 * Env: GEMINI_API_KEY or GOOGLE_API_KEY, optional GEMINI_MODEL.
 */

const GEMINI_API_ROOT =
  "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_MODEL = "gemini-2.5-flash";

export function geminiApiKey(): string {
  return (
    process.env.GEMINI_API_KEY?.trim() ||
    process.env.GOOGLE_API_KEY?.trim() ||
    ""
  );
}

export function geminiConfigured(): boolean {
  return Boolean(geminiApiKey());
}

function geminiModel(): string {
  return process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
}

function parseJsonLoose(text: string): unknown {
  let t = text.trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  }
  return JSON.parse(t);
}

export async function callGeminiJson(
  prompt: string,
  opts?: { temperature?: number; timeoutMs?: number },
): Promise<unknown> {
  const apiKey = geminiApiKey();
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");

  const url = `${GEMINI_API_ROOT}/${geminiModel()}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(
    () => ctrl.abort(),
    opts?.timeoutMs ?? 90_000,
  );
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: ctrl.signal,
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: opts?.temperature ?? 0.3,
          responseMimeType: "application/json",
        },
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Gemini HTTP ${res.status}: ${body.slice(0, 300)}`);
    }
    const payload = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const parts = payload.candidates?.[0]?.content?.parts || [];
    const text = parts.map((p) => p.text || "").join("");
    if (!text) throw new Error("Gemini returned empty text");
    return parseJsonLoose(text);
  } finally {
    clearTimeout(timer);
  }
}
