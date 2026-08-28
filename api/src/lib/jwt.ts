import { SignJWT, jwtVerify } from 'jose'
import { randomBytes, createHash } from 'crypto'

const secret = new TextEncoder().encode(
  process.env.JWT_SECRET ?? 'dev-secret-change-in-production-min-32-chars',
)

export interface JwtPayload {
  sub: string   // user id
  email: string
  iat?: number
  exp?: number
}

export async function signAccessToken(payload: Omit<JwtPayload, 'iat' | 'exp'>): Promise<string> {
  return new SignJWT({ email: payload.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(secret)
}

export async function verifyAccessToken(token: string): Promise<JwtPayload> {
  const { payload } = await jwtVerify(token, secret)
  return { sub: payload.sub as string, email: payload['email'] as string }
}

export function generateRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(40).toString('hex')
  const hash = createHash('sha256').update(token).digest('hex')
  return { token, hash }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function refreshTokenExpiry(): Date {
  return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
}
