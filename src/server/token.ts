import { randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Session token for the local API.
 *
 * Minted fresh per `beacon serve` process and handed to clients out-of-band
 * (stdout and `~/.beacon/serve.json`, both owner-only). Binding to loopback is
 * NOT an auth boundary — any web page the user visits can fire requests at
 * 127.0.0.1 (CSRF / DNS rebinding) — so every request must present this token.
 */

export function mintToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Constant-time comparison; length mismatch short-circuits (not secret). */
export function verifyToken(presented: string | undefined, expected: string): boolean {
  if (!presented) return false;
  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
