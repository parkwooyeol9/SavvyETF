import { timingSafeEqual } from "crypto";

export function secretsEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  try {
    return timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

/** Bearer WEB_INGEST_SECRET — same secret used by /api/ingest. */
export function authorizeIngest(request: Request): boolean {
  const secret = process.env.WEB_INGEST_SECRET?.trim();
  if (!secret) return false;
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return false;
  return secretsEqual(token, secret);
}
