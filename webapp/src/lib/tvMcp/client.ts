import { TV_MCP_URL } from "@/lib/tvMcp/oauth";

const PROTOCOL_VERSION = "2025-06-18";
const REQUEST_TIMEOUT_MS = 25_000;

export class TvAuthError extends Error {}

export class TvToolError extends Error {
  constructor(
    message: string,
    readonly rateLimited = false,
  ) {
    super(message);
  }
}

type JsonRpcResponse = {
  id?: number | string | null;
  result?: unknown;
  error?: { code?: number; message?: string };
};

type ToolResult = {
  content?: Array<{ type?: string; text?: string }>;
  structuredContent?: unknown;
  isError?: boolean;
};

function parseSse(text: string): JsonRpcResponse[] {
  const out: JsonRpcResponse[] = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) continue;
    try {
      out.push(JSON.parse(data) as JsonRpcResponse);
    } catch {
      // Non-JSON SSE payloads (keep-alives) are ignored.
    }
  }
  return out;
}

function unwrapToolResult(name: string, result: ToolResult): unknown {
  let payload: unknown = result.structuredContent;
  if (payload === undefined) {
    const text = (result.content || [])
      .filter((c) => c.type === "text" && typeof c.text === "string")
      .map((c) => c.text)
      .join("");
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }
  const obj = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
  const errText =
    result.isError || obj?.success === false
      ? String(obj?.error ?? (typeof payload === "string" ? payload : "tool error"))
      : "";
  if (errText) {
    const rateLimited = /\b429\b|rate.?limit/i.test(errText);
    throw new TvToolError(
      rateLimited
        ? `TradingView 요청 한도에 걸렸습니다 (${name}). 잠시 후 다시 시도하세요.`
        : `${name}: ${errText.slice(0, 240)}`,
      rateLimited,
    );
  }
  return payload;
}

/** One MCP session (initialize → tools/call…) against the TradingView server. */
export class TvMcpSession {
  private sessionId: string | null = null;
  private nextId = 1;
  private initialized = false;

  constructor(private readonly accessToken: string) {}

  private async post(body: Record<string, unknown>): Promise<JsonRpcResponse | null> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    if (this.initialized) headers["MCP-Protocol-Version"] = PROTOCOL_VERSION;
    if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;

    const res = await fetch(TV_MCP_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (res.status === 401 || res.status === 403) {
      throw new TvAuthError("TradingView 인증이 만료되었습니다. 다시 연결하세요.");
    }
    const sid = res.headers.get("mcp-session-id");
    if (sid) this.sessionId = sid;
    if (res.status === 202 || !("id" in body)) return null;
    if (res.status === 429) {
      throw new TvToolError("TradingView 요청 한도에 걸렸습니다. 잠시 후 다시 시도하세요.", true);
    }
    if (!res.ok) {
      throw new TvToolError(`TradingView MCP HTTP ${res.status}`);
    }

    const contentType = res.headers.get("content-type") || "";
    const text = await res.text();
    const messages = contentType.includes("text/event-stream")
      ? parseSse(text)
      : [JSON.parse(text) as JsonRpcResponse];
    return messages.find((m) => m.id === body.id) || messages[messages.length - 1] || null;
  }

  private async ensureInitialized() {
    if (this.initialized) return;
    const init = await this.post({
      jsonrpc: "2.0",
      id: this.nextId++,
      method: "initialize",
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "savvyetf-operator", version: "1.0" },
      },
    });
    if (init?.error) throw new TvToolError(`initialize: ${init.error.message || "failed"}`);
    this.initialized = true;
    await this.post({ jsonrpc: "2.0", method: "notifications/initialized" });
  }

  async call<T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    await this.ensureInitialized();
    const res = await this.post({
      jsonrpc: "2.0",
      id: this.nextId++,
      method: "tools/call",
      params: { name, arguments: args },
    });
    if (!res) throw new TvToolError(`${name}: empty response`);
    if (res.error) throw new TvToolError(`${name}: ${res.error.message || "error"}`);
    return unwrapToolResult(name, (res.result || {}) as ToolResult) as T;
  }

  async close() {
    if (!this.sessionId) return;
    try {
      await fetch(TV_MCP_URL, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Mcp-Session-Id": this.sessionId,
          "MCP-Protocol-Version": PROTOCOL_VERSION,
        },
        cache: "no-store",
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      // Servers may not support explicit session teardown.
    }
  }
}
