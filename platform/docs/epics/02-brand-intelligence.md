# Epic 2 — Brand Intelligence (spec)

Written by: growth-strategist scoping pass. Consumed by: backend-architect (API + data), frontend-engineer (UI). Depends on Epic 0 (auth/orgs/RBAC/tenancy) and benefits from Epic 1 (CRM) existing, since a `brand` is created for a *customer* organization, and the natural on-ramp is "convert a lead → their org needs a brand profile."

## Why this epic, and why second

Every downstream engine (SEO, GEO, Opportunity, Content, Agents) operates on a `brand` — it's the row everything else foreign-keys to. `docs/09-ux/CUSTOMER_JOURNEY.md` Stage 3 (Activation/Onboarding) starts with exactly this: "confirm company name/website, add up to 5 competitors, select industry, add 3–5 use cases, add known brand claims" — that's this epic, manual data entry only, no crawling or AI yet (those are Epics 3+ and 6+). Shipping this unblocks onboarding as a real, usable flow even before the AI/SEO engines exist.

## Domain model (`docs/06-database/SCHEMA.md` §2, carried into `packages/database` — already ported/audited in Epic 0)

- `brands` — one (or more, for agencies) per organization: name, website, description, `industries[]`, `categories[]`, `markets[]`, `aliases[]` (names AI might use), positioning, `differentiators[]`, `primary_url`.
- `competitors` — linked to a `brand_id`, `priority` (1=primary/2=secondary/3=watch), aliases.
- `entities` — products/services/categories/concepts the brand should be associated with, typed via `schema_type` (schema.org type) — this is what GEO's "entity association gap" (Epic 8) will later check against.
- `use_cases` — who uses the product and why: industries, company sizes, pain points, solutions.
- `brand_claims` — factual claims + evidence + `confidence` (high/medium/low) + `verified` flag. This is the raw material for GEO's "citable facts" principle (`docs/11-geo/GEO_ENGINE.md`).

## Entitlements (`docs/16-billing/BILLING_ARCHITECTURE.md`)

`competitors_tracked` is plan-limited (free: 2, starter: 5, growth: 10, pro: 20, agency: per-client). Enforce via the `checkUsageLimit`/entitlement pattern from Epic 0's platform foundation — reject the 3rd competitor add on Free with a clear, specific error naming the limit and the upgrade path, not a generic 403. Number of `brands` per organization is itself an entitlement for agency/multi-client use (Epic 18) — for this epic, assume exactly one brand per organization and leave the multi-brand case as a documented `// MULTI-BRAND: see Epic 18` note rather than building it now.

## API surface

- `brands`: get/update (single brand per org for now — no list endpoint needed yet, `GET /brands/me` resolves from tenant context).
- `competitors`: list/create/update/delete, entitlement-checked on create.
- `entities`, `use_cases`, `brand_claims`: standard tenant-scoped CRUD, RBAC per `docs/08-security/SECURITY.md` (owner/admin/analyst can write; editor/viewer read-only — brand profile is strategic data, not day-to-day content).

## UI surface — this IS the onboarding flow from `docs/09-ux/CUSTOMER_JOURNEY.md` Stage 3, Step 2

A wizard, not a settings form: Welcome → Brand basics (name/website confirm) → Competitors (add up to plan limit, with a live counter) → Industry/category select → Use cases (add 3–5) → Brand claims (optional, add what you know) → Done screen ("Your AI Visibility Baseline will start once Epic 7 exists — for now, your profile is saved"). Every step must be individually saveable (a user who leaves mid-wizard and comes back should resume, not restart) — persist progress, don't hold it in unsaved client state.

## End-to-end flow (qa-flow-tester must trace every step below, not just each endpoint/screen in isolation)

1. A new organization with no brand yet opens the app — confirm they land in (or are clearly prompted into) the onboarding wizard, not a broken/empty Overview screen.
2. Wizard step "Brand basics" is saved (`PATCH /brands/me`) — confirm the user can close the tab and, on return, resume from this exact point (persisted per-step, not held in unsaved client state) rather than restarting.
3. Wizard step "Competitors": add competitors up to the plan's limit — confirm the live counter reflects the real entitlement value from the plan (not a hardcoded number), and that the `(limit + 1)`th add attempt is rejected server-side with a specific, actionable error, surfaced in the UI as a real message (not a silent failure or generic "error occurred").
4. Continue through "Industry/category", "Use cases" (add 3–5), and "Brand claims" — confirm each step's data round-trips: saved via API, then re-fetched and correctly re-populated in the UI on a fresh page load (not just visible because it's still in React state from the same session).
5. Wizard "Done" screen — confirm the brand profile is now visible and editable via the "Brand profile" tab on `/settings` (Epic 0's placeholder), i.e. the same data written by the wizard is readable from a completely different screen, not siloed to the wizard's own local state.
6. RBAC check: repeat step 3 (adding a competitor) as an `editor` or `viewer` and confirm the write is rejected server-side (per this epic's stated role restriction — brand profile is owner/admin/analyst write, not editor/viewer).
7. Tenant isolation check: a second organization must not see the first organization's brand, competitors, entities, use cases, or claims through any endpoint above.

## Definition of done

Same DoD checklist as Epic 1. Tenant isolation tests for all five tables. Entitlement enforcement test for the competitor limit (this is the first epic where an entitlement check is load-bearing — get the pattern right here since every later paid feature reuses it).
