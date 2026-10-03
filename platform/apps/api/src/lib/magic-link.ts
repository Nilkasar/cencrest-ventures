import { db } from '@bebest/database';
import { generateOpaqueToken } from './tokens.js';
import type { EmailSender } from './email.js';

export const MAGIC_LINK_TTL_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Creates a single-use magic-link token for `email` and emails the sign-in
 * link. The ONE implementation behind both `POST /api/auth/magic-link` (a
 * person asking for their own link) and Epic 22's
 * `POST /api/platform/users/:id/magic-link` (BeBest staff sending one to a
 * user) — so the token format, TTL, hashing and link shape can never drift
 * between the two.
 *
 * Only the SHA-256 hash is stored; the raw token exists only in the email.
 * Written through the request role (`db`): `magic_link_tokens` has no RLS,
 * and the Platform role (`bebest_platform`) is deliberately not granted
 * INSERT on it.
 */
export async function issueMagicLink(emailSender: EmailSender, email: string): Promise<void> {
  const { token, hash } = generateOpaqueToken(32);
  const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_MS);

  await db.magic_link_tokens.create({
    data: { email, token_hash: hash, expires_at: expiresAt },
  });

  const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
  await emailSender.sendMagicLink({
    to: email,
    magicLinkUrl: `${appUrl}/auth/magic-link/verify?token=${token}`,
  });
}
