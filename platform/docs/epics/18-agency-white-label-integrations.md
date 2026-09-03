# Epic 18 — Agency / White Label / Integrations (spec)

Written by: growth-strategist scoping pass. Consumed by: backend-architect, frontend-engineer. Depends on Epic 0 (orgs/RBAC), Epic 16 (Billing/entitlements), and conceptually touches every prior engine (an agency views the SAME data, scoped differently).

## Why this epic

`PRODUCT_VISION.md`'s Persona 3 (Agency Director) needs to "manage AI + SEO visibility for 10+ clients, white-label the reports" — a genuinely different access pattern (one login, many client orgs) from every epic built so far, which assumed one user belongs to one organization. This epic is where that assumption gets generalized, carefully, without weakening tenant isolation for everyone else.

## The agency model — additive, not a rewrite of Epic 0's tenancy

An agency is itself an `organizations` row (per Epic 0). Client relationships are a NEW `agency_clients` table: `agency_org_id`, `client_org_id`, `created_at` — an agency user with the right role gets read/write access to a client org's data ONLY through this explicit link, never by relaxing RLS itself. Concretely: a request "acting as" a client org still goes through the exact same `withOrgContext(clientOrgId, ...)` mechanism Epic 0 built — the only new logic is an authorization check ("does this agency user's org have an `agency_clients` link to this target org, at what role") gating which `organization_id` a request is allowed to assert, not a change to how RLS itself works. This preserves Epic 0's core invariant (RLS enforces the asserted org, nothing more) while adding legitimate cross-org access through an explicit, audited grant.

## White-labeling

`organizations.settings` (JSONB, already exists per Epic 0's schema) gains a documented `whiteLabel` shape: custom logo URL, custom domain (display-only for this build, no real DNS/custom-domain infra), custom report branding. Reports (Epic 15) and the public snapshot page (Epic 17) read this when rendering for a white-labeled client, falling back to default BeBest branding when unset.

## Integrations (`docs/10-seo/SEO_ENGINE.md`'s "Available Without Paid APIs" list)

Google Search Console / Bing Webmaster Tools connections — build the OAuth-connection data model (`integrations` table: `provider`, `organization_id`, `access_token` [encrypted at rest, never logged], `refresh_token`, `connected_at`, `status`) and the `SEODataProvider` slot Epic 4 already left open for a "customer-connected Search Console data (best)" source. **No real OAuth flow against live Google/Bing APIs** — this build makes no real external network calls; implement the connection UI/data model and a `MockSearchConsoleProvider` proving the `SEODataProvider` interface accepts a real-shaped provider, with the actual OAuth handshake clearly marked as the deployment-time integration point.

## Entitlements tie-in

`client_accounts` limit (Epic 16's `agency` tier: 20 per `docs/16-billing/BILLING_ARCHITECTURE.md`'s example limits) enforced via the same `checkUsageLimit` pattern every prior epic uses when an agency links a new client.

## API surface

- `POST /agency/clients` (link a client org — requires the client org to exist and an explicit consent/invitation step, not agencies silently claiming any org id).
- `GET /agency/clients` — list with per-client summary (AVS, SEO health — reusing Epic 7/4's real data, not a duplicate rollup table).
- `GET/PATCH /orgs/me/settings/white-label`.
- `POST /integrations/:provider/connect` (mock), `GET /integrations`.

## UI surface

An agency dashboard (client switcher — reuse Epic 0's org-switcher UI pattern, now backed by real `agency_clients` data instead of a fixture), white-label settings in Settings, an Integrations tab in Settings (connect/disconnect, connection status).

## End-to-end flow (qa-flow-tester must trace every step below, not just each table in isolation)

1. Link an agency to a client org → confirm the link requires the documented consent/invitation step (not a bare INSERT an agency can perform unilaterally against any org id) and is audit-logged.
2. Agency user switches to "acting as" the client → confirm every subsequent request is scoped via the client org's REAL `withOrgContext`, and that removing the `agency_clients` link immediately revokes access on the next request (no cached/stale access).
3. A user from a THIRD, unrelated org attempts the same "act as client" flow → confirm rejection (the authorization check, not RLS alone, is what's actually gating this — trace it in code).
4. Set white-label branding on a client org → confirm a generated report (Epic 15) and the public snapshot page (Epic 17) for that client render with the custom branding, and an org WITHOUT white-label settings still renders default branding.
5. Connect the mock Search Console integration → confirm Epic 4's `SEODataProvider` selection logic actually prefers it over `NullSEODataProvider` once connected (trace the provider-resolution code, don't just check the connection record exists).
6. Exceed the agency's `client_accounts` limit → confirm the same typed entitlement-error pattern as every other capped resource.
7. Tenant isolation check: confirm a client org's OWN direct users (not the agency) are unaffected by the agency link — they still see only their own org's data through the normal path.

## Definition of done

Standard DoD. A test proving revoking an `agency_clients` link immediately blocks a subsequent request that was previously authorized (not just that new links are checked).
