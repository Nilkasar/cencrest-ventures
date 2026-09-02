import { randomBytes, createHash } from 'node:crypto';

/**
 * Shared opaque-token helper for every "generate a random token, store
 * only its hash, hand the raw value to the caller once" flow: magic
 * links, invitations, password-reset tokens (not used yet — no password
 * auth in Epic 0 — but the pattern is identical), and refresh tokens
 * (see jwt.ts, which re-exports these two functions under its own names
 * for call-site clarity).
 */
export function generateOpaqueToken(bytes = 32): { token: string; hash: string } {
  const token = randomBytes(bytes).toString('hex');
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
