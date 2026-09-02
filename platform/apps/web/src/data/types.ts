/**
 * Shapes the Epic 0 shell needs to render (org switcher, user menu). These
 * mirror what `platform/apps/api` will eventually return — kept here,
 * typed, so the fixtures in `fixtures.ts` and the real API responses next
 * epic can share a contract without the components changing.
 */

export interface Organization {
  id: string;
  name: string;
  slug: string;
  plan: "starter" | "growth" | "pro" | "agency" | "enterprise";
}

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  role: "owner" | "admin" | "member";
}
