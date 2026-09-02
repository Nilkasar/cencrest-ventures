/**
 * JWT issuance/verification — ported and hardened from api/src/lib/jwt.ts.
 *
 * Deviations from the old implementation (see apps/api DECISIONS.md for the
 * full list):
 *   - RS256 (asymmetric) instead of HS256. docs/08-security/SECURITY.md
 *     requires RS256 explicitly. HS256 uses one shared secret for both
 *     signing and verifying, which means every service that needs to
 *     VERIFY a token (e.g. a future separate worker/service) also has to
 *     hold the same secret that can MINT tokens. RS256 lets us hand out
 *     the public key freely for verification while only the API process
 *     holds the private signing key.
 *   - 15-minute access token expiry (SECURITY.md) — the old code also used
 *     15m, unchanged.
 *   - Refresh tokens are DB-backed, rotating, 7 days (SECURITY.md) — the
 *     old code used 30 days with no explicit rotation-on-use enforcement
 *     wired into a session table. This implementation stores a
 *     `session_id` alongside the refresh token hash so a refresh always
 *     rotates within the same session lineage and old tokens are revoked,
 *     not just left to expire.
 *   - The access token payload intentionally does NOT include `role`. This
 *     is a deliberate deviation from the literal claim list in
 *     SECURITY.md ("Claims: sub, org, role, iat, exp") — see
 *     apps/api/DECISIONS.md. Including a role claim invites exactly the
 *     mistake SECURITY.md's own RBAC section forbids ("Never rely on
 *     client-sent role — always read from database"). `org` is kept as a
 *     hint for which tenant to resolve context for; the role is always
 *     re-read from `memberships` by `tenant-context` middleware.
 */

import { SignJWT, jwtVerify, importPKCS8, importSPKI, type CryptoKey } from 'jose';
import { generateOpaqueToken, hashToken } from './tokens.js';

export { hashToken };

const ALG = 'RS256';
const ACCESS_TOKEN_TTL = '15m';
export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface AccessTokenPayload {
  sub: string; // user id
  email: string;
  org: string | null; // active organization id, if one has been selected
}

export interface VerifiedAccessToken extends AccessTokenPayload {
  iat: number;
  exp: number;
}

let cachedPrivateKey: CryptoKey | null = null;
let cachedPublicKey: CryptoKey | null = null;

/**
 * Keys are loaded lazily (not at module import time) so that importing this
 * module in a test file never requires real keys to be present — only
 * actually signing/verifying a token does. Set `JWT_PRIVATE_KEY` /
 * `JWT_PUBLIC_KEY` to PEM-encoded RSA keys (see README.md for how to
 * generate a dev pair).
 */
async function getPrivateKey(): Promise<CryptoKey> {
  if (cachedPrivateKey) return cachedPrivateKey;
  const pem = process.env.JWT_PRIVATE_KEY;
  if (!pem) {
    throw new Error(
      'JWT_PRIVATE_KEY is not set. Generate an RSA keypair (see apps/api/README.md) and set it in your environment.',
    );
  }
  cachedPrivateKey = await importPKCS8(pem.replace(/\\n/g, '\n'), ALG);
  return cachedPrivateKey;
}

async function getPublicKey(): Promise<CryptoKey> {
  if (cachedPublicKey) return cachedPublicKey;
  const pem = process.env.JWT_PUBLIC_KEY;
  if (!pem) {
    throw new Error(
      'JWT_PUBLIC_KEY is not set. Generate an RSA keypair (see apps/api/README.md) and set it in your environment.',
    );
  }
  cachedPublicKey = await importSPKI(pem.replace(/\\n/g, '\n'), ALG);
  return cachedPublicKey;
}

/** Test-only hook: lets unit tests inject an in-memory keypair instead of
 * reading from the environment. Never called from application code. */
export function __setKeysForTesting(privateKey: CryptoKey | null, publicKey: CryptoKey | null): void {
  cachedPrivateKey = privateKey;
  cachedPublicKey = publicKey;
}

export async function signAccessToken(payload: AccessTokenPayload): Promise<string> {
  const key = await getPrivateKey();
  return new SignJWT({ email: payload.email, org: payload.org })
    .setProtectedHeader({ alg: ALG })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_TTL)
    .sign(key);
}

export class InvalidAccessTokenError extends Error {
  constructor(cause?: unknown) {
    super('Invalid or expired access token');
    this.name = 'InvalidAccessTokenError';
    this.cause = cause;
  }
}

export async function verifyAccessToken(token: string): Promise<VerifiedAccessToken> {
  const key = await getPublicKey();
  try {
    const { payload } = await jwtVerify(token, key, { algorithms: [ALG] });
    return {
      sub: payload.sub as string,
      email: payload['email'] as string,
      org: (payload['org'] as string | null) ?? null,
      iat: payload.iat as number,
      exp: payload.exp as number,
    };
  } catch (err) {
    throw new InvalidAccessTokenError(err);
  }
}

/** A fresh, unguessable refresh token plus the SHA-256 hash that gets
 * stored in the database. The raw `token` is returned to the client ONCE
 * and never stored — only `hash` is persisted (SCHEMA.md: "hashed, never
 * store raw"). */
export function generateRefreshToken(): { token: string; hash: string } {
  return generateOpaqueToken(40);
}

export function refreshTokenExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + REFRESH_TOKEN_TTL_MS);
}
