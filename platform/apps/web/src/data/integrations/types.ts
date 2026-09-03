/**
 * Epic 18 (Agency / White Label / Integrations) — `integrations` wire
 * shapes. Mirrors `apps/api/src/routes/integrations.ts`'s
 * `serializeIntegration` exactly. `config_enc` (the encrypted token blob)
 * is never returned by any route and has no field here.
 */

/** `integration_status` (Prisma enum). */
export type IntegrationStatus = "connected" | "disconnected" | "error";

/** `routes/integrations.ts`'s `PROVIDER_SLUGS` — the only supported value
 *  today is `google_search_console` (backs the real `MockSearchConsoleProvider`
 *  wired into Epic 4's `SEODataProvider` slot). Kept as a plain `string` in
 *  the return type below (not a union) because `GET /integrations` could in
 *  principle return a row for a provider no longer in the allowlist; the UI
 *  is driven by `SUPPORTED_PROVIDERS` for what it lets you *connect*. */
export interface Integration {
  id: string;
  provider: string;
  status: IntegrationStatus;
  connectedAt: string | null;
  disconnectedAt: string | null;
  lastSyncedAt: string | null;
}

export interface ProviderInfo {
  slug: string;
  label: string;
  description: string;
}

/** Only providers this build actually backs with a real (mocked)
 *  `SEODataProvider` — see `routes/integrations.ts`'s own "not done: Bing
 *  Webmaster Tools" note. Adding a slug here without a backend consumer
 *  would be exactly the "connection record exists but nothing ever reads
 *  it" gap the epic's end-to-end flow step 5 warns against. */
export const SUPPORTED_PROVIDERS: ProviderInfo[] = [
  {
    slug: "google_search_console",
    label: "Google Search Console",
    description: "Connects real-shaped keyword rankings and impressions into SEO Intelligence, preferred over the built-in estimate once connected.",
  },
];
