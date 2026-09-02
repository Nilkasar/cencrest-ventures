import { z } from 'zod';

/**
 * A URL that is well-formed AND restricted to http(s). This is deliberately
 * NOT SSRF protection (no DNS resolution, no private-IP/redirect checks) —
 * that class of defense matters when the server itself fetches the URL
 * (Epic 3's crawler), not when it's only stored as a display field a human
 * typed in during onboarding. Rejecting `javascript:`/`data:`/etc. schemes
 * here is basic input hygiene for a value that will eventually be rendered
 * as a link in `apps/web`, nothing more.
 */
export const httpUrlSchema = z
  .string()
  .trim()
  .max(500)
  .refine(
    (value) => {
      try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
      } catch {
        return false;
      }
    },
    { message: 'Must be a valid http(s) URL' },
  );
