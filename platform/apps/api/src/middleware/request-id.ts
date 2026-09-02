import type { MiddlewareHandler } from 'hono';
import { randomUUID } from 'node:crypto';
import type { AppEnv } from '../types/context.js';

/**
 * Every request gets a request id — from the caller's `X-Request-Id`
 * header if present (useful for correlating a client-generated id across
 * services), otherwise a fresh UUID. Always echoed back on the response so
 * a caller can find this exact request in logs.
 */
export const requestId: MiddlewareHandler<AppEnv> = async (c, next) => {
  const id = c.req.header('x-request-id') ?? randomUUID();
  c.set('requestId', id);
  c.header('x-request-id', id);
  await next();
};
