import { describe, expect, it, afterEach } from 'vitest';

// Regression test for docs/epics/20-marketing-site-rebuild.md's "Non-
// negotiable: fix the CORS domain mismatch" — the production allowlist
// previously named `bebestwith.ai`, a different domain from the one the
// marketing site is actually deployed and canonicalized under
// (`bebestwithai.com`). Exercised via an OPTIONS preflight (Hono's `cors`
// middleware answers preflights itself, before any route handler or DB
// access runs), against the REAL production CORS config — never dev's
// permissive `*` — per the spec's explicit instruction.
//
// `app.ts` reads `process.env.NODE_ENV` at module-evaluation time (not
// per-request), so NODE_ENV must be set to 'production' BEFORE the dynamic
// import below.

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

afterEach(() => {
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
});

async function buildProdApp() {
  process.env.NODE_ENV = 'production';
  const { default: app } = await import('./app.js');
  return app;
}

describe('CORS — production allowlist', () => {
  it('allows a preflight from the real deployed marketing-site origin (bebestwithai.com)', async () => {
    const app = await buildProdApp();
    const res = await app.request('/api/apply', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://bebestwithai.com',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type',
      },
    });

    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://bebestwithai.com');
  });

  it('allows a preflight from the www subdomain and the app subdomain', async () => {
    const app = await buildProdApp();

    const www = await app.request('/api/apply', {
      method: 'OPTIONS',
      headers: { Origin: 'https://www.bebestwithai.com', 'Access-Control-Request-Method': 'POST' },
    });
    expect(www.headers.get('Access-Control-Allow-Origin')).toBe('https://www.bebestwithai.com');

    const appSub = await app.request('/api/apply', {
      method: 'OPTIONS',
      headers: { Origin: 'https://app.bebestwithai.com', 'Access-Control-Request-Method': 'POST' },
    });
    expect(appSub.headers.get('Access-Control-Allow-Origin')).toBe('https://app.bebestwithai.com');
  });

  it('does NOT allow the old, wrong domain (bebestwith.ai) any more — locks in the fix', async () => {
    const app = await buildProdApp();
    const res = await app.request('/api/apply', {
      method: 'OPTIONS',
      headers: { Origin: 'https://bebestwith.ai', 'Access-Control-Request-Method': 'POST' },
    });

    expect(res.headers.get('Access-Control-Allow-Origin')).not.toBe('https://bebestwith.ai');
  });
});
