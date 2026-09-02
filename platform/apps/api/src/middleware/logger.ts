import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../types/context.js';

/**
 * Structured JSON request logging. One line per request, to stdout, so any
 * log aggregator (Vercel, Datadog, etc.) can parse it without a custom
 * grok pattern. Must run AFTER `requestId` (reads `c.get('requestId')`).
 *
 * Deliberately does not log request/response bodies — those can contain
 * PII or secrets (magic-link tokens, refresh tokens). Add explicit,
 * field-level logging in a handler if a specific value needs to be
 * observable, never a blanket body dump.
 */
export const requestLogger: MiddlewareHandler<AppEnv> = async (c, next) => {
  const start = Date.now();

  await next();

  const durationMs = Date.now() - start;
  const line = {
    level: c.res.status >= 500 ? 'error' : c.res.status >= 400 ? 'warn' : 'info',
    requestId: c.get('requestId'),
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    durationMs,
    timestamp: new Date().toISOString(),
  };

  // eslint-disable-next-line no-console -- this IS the logging transport
  console.log(JSON.stringify(line));
};
