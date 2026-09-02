import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { requestId } from './middleware/request-id.js';
import { requestLogger } from './middleware/logger.js';
import { publicRateLimit } from './middleware/rate-limit.js';
import health from './routes/health.js';
import { createAuthRoutes } from './routes/auth.js';
import orgs from './routes/orgs.js';
import { ConsoleEmailSender } from './lib/email.js';
import type { AppEnv } from './types/context.js';

const app = new Hono<AppEnv>();

// Security headers — matches docs/08-security/SECURITY.md's required
// header list exactly.
app.use(
  '*',
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      frameAncestors: ["'none'"],
    },
    xFrameOptions: 'DENY',
    xContentTypeOptions: 'nosniff',
    referrerPolicy: 'strict-origin-when-cross-origin',
    permissionsPolicy: { geolocation: [], microphone: [], camera: [] },
    strictTransportSecurity: 'max-age=31536000; includeSubDomains',
  }),
);

app.use(
  '*',
  cors({
    origin:
      process.env.NODE_ENV === 'production'
        ? ['https://app.bebestwith.ai', 'https://bebestwith.ai', 'https://www.bebestwith.ai']
        : '*',
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
  }),
);

app.use('*', requestId);
app.use('*', requestLogger);

// Baseline public rate limit on everything (SECURITY.md: "Public
// (unauthenticated): 30 requests / 1 minute"). Routes needing a stricter
// or authenticated-aware limit apply their own on top — Hono runs
// middleware in registration order, so the more specific limiter still
// executes and can reject before the handler runs.
app.use('*', publicRateLimit);

app.route('/api/health', health);
app.route('/api/auth', createAuthRoutes(new ConsoleEmailSender()));
app.route('/api/orgs', orgs);

app.notFound((c) => c.json({ error: 'Not found' }, 404));

app.onError((err, c) => {
  const requestIdValue = (() => {
    try {
      return c.get('requestId');
    } catch {
      return undefined;
    }
  })();
  console.error(
    JSON.stringify({
      level: 'error',
      requestId: requestIdValue,
      msg: err.message,
      stack: err.stack,
    }),
  );
  return c.json({ error: 'Internal server error' }, 500);
});

export default app;
