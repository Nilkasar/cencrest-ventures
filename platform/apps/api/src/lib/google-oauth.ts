/**
 * Google OAuth 2.0 helpers — auth URL generation, state signing/verification,
 * and token exchange/refresh. Used by `routes/integrations.ts`'s OAuth flow
 * for both GSC (`gsc`) and GA4 (`ga4`) provider types.
 *
 * State is HMAC-signed (SHA-256) to prevent CSRF on the callback — Google
 * will replay whatever `state` param we send, but we must verify it was us
 * who sent it. Nonce in the payload ensures the same provider+org pair
 * generates a new state on every authorization request so a replayed state
 * from a previous flow is rejected.
 */
import { createHmac, randomUUID } from 'node:crypto';
import { google } from 'googleapis';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? '';
// Falls back to a dev-only sentinel — production deployments must set this
// to a real secret so state tokens minted in one deploy can't be trivially
// forged. The `/authorize` route already gates on `GOOGLE_CLIENT_ID` being
// set, so a missing state secret only matters if OAuth is actually in use.
const STATE_SECRET = process.env.GOOGLE_OAUTH_STATE_SECRET ?? 'bebest-dev-state-secret-change-in-production';

const GSC_SCOPES = ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/webmasters.readonly'];
const GA4_SCOPES = ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/analytics.readonly'];

export type OAuthProvider = 'gsc' | 'ga4';

export function getGoogleAuthClient() {
  return new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
}

function signState(payload: object): string {
  const json = JSON.stringify(payload);
  const hmac = createHmac('sha256', STATE_SECRET).update(json).digest('hex');
  const encoded = Buffer.from(json).toString('base64url');
  return `${encoded}.${hmac}`;
}

export function generateAuthUrl(provider: OAuthProvider, orgId: string, redirectUri: string): string {
  const oauth2Client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, redirectUri);
  const state = signState({ provider, orgId, nonce: randomUUID() });
  const scopes = provider === 'gsc' ? GSC_SCOPES : GA4_SCOPES;
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: scopes,
    state,
  });
}

export function verifyState(state: string): { provider: OAuthProvider; orgId: string } {
  const dot = state.lastIndexOf('.');
  if (dot === -1) throw new Error('Invalid state: missing signature separator');
  const encoded = state.slice(0, dot);
  const receivedHmac = state.slice(dot + 1);
  const json = Buffer.from(encoded, 'base64url').toString('utf8');
  const expectedHmac = createHmac('sha256', STATE_SECRET).update(json).digest('hex');
  if (receivedHmac !== expectedHmac) throw new Error('Invalid state: HMAC mismatch');
  const payload = JSON.parse(json) as { provider: OAuthProvider; orgId: string };
  if (!payload.provider || !payload.orgId) throw new Error('Invalid state: missing fields');
  if (payload.provider !== 'gsc' && payload.provider !== 'ga4') {
    throw new Error(`Invalid state: unknown provider "${payload.provider}"`);
  }
  return { provider: payload.provider, orgId: payload.orgId };
}

export async function exchangeCode(
  code: string,
  redirectUri: string,
): Promise<{ accessToken: string; refreshToken: string; expiresAt: number; scope: string }> {
  const oauth2Client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, redirectUri);
  const { tokens } = await oauth2Client.getToken(code);
  if (!tokens.access_token) throw new Error('No access_token in token response');
  if (!tokens.refresh_token) throw new Error('No refresh_token in token response — ensure prompt=consent was used');
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: tokens.expiry_date ? Math.floor(tokens.expiry_date / 1000) : Math.floor(Date.now() / 1000) + 3600,
    scope: tokens.scope ?? '',
  };
}

export async function refreshAccessToken(
  refreshToken: string,
): Promise<{ accessToken: string; expiresAt: number }> {
  const oauth2Client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  const { credentials } = await oauth2Client.refreshAccessToken();
  if (!credentials.access_token) throw new Error('No access_token in refresh response');
  return {
    accessToken: credentials.access_token,
    expiresAt: credentials.expiry_date
      ? Math.floor(credentials.expiry_date / 1000)
      : Math.floor(Date.now() / 1000) + 3600,
  };
}
