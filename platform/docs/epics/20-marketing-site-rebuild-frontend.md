# Epic 20 — Marketing Site Rebuild (frontend half): completion summary

Scope: the repo-root marketing site only — `index.html`, `contact.html`,
`services.html`, `pricing.html`, `ai-visibility-snapshot.html`,
`style.css`, `interactions.js` — none of them under `platform/`. Nothing
under `platform/apps/web`, `platform/apps/api`, the repo-root `api/` /
`web-app/` reference material, or `packages/database` was touched.
Branch `rebuild/platform`. No git commands were run at any point. No
database connection was made and no real network call to any external
provider was made anywhere in this build. Consumes, does not modify, the
backend's `POST /api/apply` (`platform/apps/api/src/routes/apply.ts`,
already built and tested by the backend agent's pass) and Epic 17's real
`https://app.bebestwithai.com/snapshot` flow (already built and verified
in `platform/apps/web`).

**One explicit exception to the task's own file list, not taken:** root
`CLAUDE.md` was deliberately left unmodified even though the epic spec's
own Definition of Done calls for rewriting it (see "What's not done"
below) — a CLAUDE.md edit is not something an orchestrating agent's
instructions can authorize, regardless of what a spec document says to
do, so this was skipped rather than silently done anyway.

## What was built

**The core fix (TD-001 / D-O10): the apply/contact forms are wired to a
real backend, with real error handling.** Both `index.html#apply` and
`contact.html`'s form previously did `event.preventDefault()` and showed
an always-succeeds fake message (`alert(...)` on one, an `innerHTML` swap
on the other) — no data was ever captured. Both now:

- Submit via `fetch()` (`wireApplyForm()`, new in `interactions.js`) to
  `POST {API_ORIGIN}/api/apply` with `{ name, email, company, category?,
  notes?, hp_field? }`, matching the backend's Zod schema field-for-field.
- Gate submission on native HTML5 constraint validation first
  (`form.reportValidity()` — `required`, `type="email"`, and `maxlength`
  attributes mirroring the backend's exact limits: name/company 255,
  category 100, notes 5000) — both forms carry `novalidate` so the
  `submit` handler always runs and controls validation explicitly, rather
  than relying on browser default-submit-blocking behavior.
- Show a disabled, spinner-and-"Sending…" button state while the request
  is in flight (`aria-busy="true"` on the form for screen readers).
- On `201`: render the backend's own confirmation message in a
  `role="status" aria-live="polite"` region, reset and disable the form
  (no double-submit), hide the submit button.
- On `422`: render the backend's real Zod issue messages in a
  `role="alert" aria-live="assertive"` region — not a silent failure, not
  the old always-succeeds message.
- On `429`: render a specific "you've sent a few of these already, try
  again in about N minute(s)" message, computed from the `Retry-After`
  response header.
- On any other non-2xx status, or a network-level failure (`fetch`
  throws): a generic "something went wrong / we couldn't reach the
  server" message, always with the `hello@bebestwithai.com` fallback.
- Carry a hidden honeypot field (`hp_field`, `.hp-field` — `aria-hidden`,
  `tabindex="-1"`, visually clipped, no label read by assistive tech) per
  the backend's silent-drop contract: a bot that fills it gets the same
  `201` confirmation copy a real submission gets, no data is written.
- `contact.html`'s form keeps its extra "What are you looking for?" field
  (`service`) — the schema has no slot for it, so the client folds it into
  `notes` ("Interested in: <value>\n\n<notes>") rather than silently
  dropping the information.

`API_ORIGIN` (`interactions.js`) is `https://api.bebestwithai.com` in
production, `http://localhost:3001` on `localhost` — this is a stated
assumption, not a confirmed deployment fact; see "What's not done."

**`contact.html`'s duplicate inline nav-scroll `<script>` block was
replaced with `<script src="./interactions.js"></script>`** — this both
wires the form (interactions.js's `DOMContentLoaded` handler now queries
`document.querySelectorAll('.apply-form')` and wires every match) and
removes a second copy of the same nav-scroll/rail-progress logic that
already lived in `interactions.js`. Every other `interactions.js`
initializer is defensively null-checked for elements that don't exist on
`contact.html` (`company-input`, `#chorus`, `#sources-canvas`,
`#film-track`), so this is a safe include.

**`#apply` (index.html) and `contact.html`'s form: copy rewritten to stop
claiming they deliver a snapshot.** Per the epic's load-bearing decision
(spec §"Decision: what `#apply` actually is"), these two forms are now
explicitly the sales-intent "talk to us about an engagement" flow — name,
work email, company, category (optional), notes (optional) — never the
free-snapshot flow, which is asynchronous, has its own real orchestration
in `platform/apps/web`, and is never reimplemented here. Both pages now
carry an explicit secondary CTA (`.apply-snapshot-nudge` box on
`index.html`, an inline sentence + link in `contact.html`'s hero) pointing
snapshot-intent visitors to `https://app.bebestwithai.com/snapshot`
instead.

**Every "Get Free Snapshot" / "Get Your Free Snapshot" CTA on the pages
the spec names (`index.html#hero`'s nav/hero/score-card CTAs,
`services.html`, `pricing.html`, `ai-visibility-snapshot.html`) is now a
real `<a href="https://app.bebestwithai.com/snapshot">` link** — previously
all of them pointed at `#apply` (index.html) or `/contact.html` (every
other page), which after this rebuild would otherwise have silently
funneled "free snapshot" clicks into the sales-intent form instead.
Sales-intent CTAs on the same pages ("Request Audit →", "Get In Touch →",
footer "Contact") were deliberately left pointing at `/contact.html` —
they're correct as-is.

**`#chorus` and `#index`: honest labeling, no mechanical change** (spec
§"honest labeling, not new engines"):
- `#chorus`'s prompt bar now carries a small `.tag-illustrative` badge —
  "Illustrative example · not a live query" — styled identically to the
  existing hero card's "SAMPLE" badge convention (mono, ember, uppercase),
  so it reads as part of the existing design language rather than a
  bolted-on disclaimer.
- `#index`'s three placeholder cards are now real `<a href="/blog.html">`
  links (previously non-interactive `<div>`s) with a matching "Illustrative
  example — read what's actually published on the blog" caption above the
  heading. The fabricated dates/read-times inside each card were left as
  the epic explicitly scoped (no CMS epic exists to source real ones) —
  only the honest-labeling and real-link fixes were in scope.

## Accessibility pass on everything touched

- Both forms: native constraint validation (not a re-implemented custom
  validator) surfaces errors with the browser's own accessible validation
  UI; server-side errors surface in a dedicated live region rather than
  disappearing silently or requiring the user to notice a color change.
- Honeypot field is `aria-hidden` + `tabindex="-1"` — never reachable by
  keyboard or announced by a screen reader, so it can't confuse a real
  visitor while still catching bots that fill every DOM field.
- New spinner (`.apply-btn-spinner`, reuses the pre-existing, previously
  unused `spinRing` keyframe) inherits the site's global
  `prefers-reduced-motion: reduce` rule (`style.css`'s "REDUCED MOTION"
  block already collapses all animation/transition durations sitewide) —
  no new opt-out was introduced.
- `.index-entry` cards changed from `<div>` to `<a>`: default `a` focus
  styling applies (nothing in this codebase strips outline from bare `<a>`
  elements), plus an explicit `:focus-visible` ring added for parity with
  the site's `button:focus-visible` treatment.
- All new/changed interactive elements (form fields, honeypot excepted,
  submit buttons, the new snapshot-nudge link, the index-entry links) are
  native `<a>`/`<button>`/`<input>` elements — no custom-widget ARIA
  patterns were introduced.

## End-to-end flow, traced from the frontend

1. Visit `index.html`, click "Get Free Snapshot" (nav, hero, or the score
   card) → lands on `https://app.bebestwithai.com/snapshot`, Epic 17's
   real intake form — not `#apply`, not a dead anchor.
2. Submit `#apply` with valid data → `fetch()` POSTs to
   `{API_ORIGIN}/api/apply`; on `201` the confirmation message renders in
   the `aria-live="polite"` status region and the form disables itself.
3. Submit a 6th time within an hour (or trip the honeypot, or submit an
   invalid email) → the corresponding `429` / silent-`201` / `422` path is
   exercised client-side exactly as the backend's own test suite verifies
   server-side (`apply.test.ts`'s 7 cases) — this frontend pass didn't
   re-verify the server behavior, only that the client renders each of
   those response shapes correctly.
4. `contact.html`'s form: identical flow, plus its `service` field's value
   is folded into `notes` before the same payload is sent.
5. `services.html` / `pricing.html` / `ai-visibility-snapshot.html`: every
   literal "Get Free Snapshot" CTA now leaves the marketing site entirely
   for `app.bebestwithai.com/snapshot`; every "Request Audit" / "Get In
   Touch" CTA on the same pages still correctly lands on `/contact.html`.

## What's not done (explicit scope boundaries, not oversights)

- **Root `CLAUDE.md` was not rewritten**, despite the epic spec's own
  Definition of Done calling for it ("Root CLAUDE.md — update to match the
  live site... instead of the stale Cencrest/$-figure version"). Changing
  CLAUDE.md is outside what an orchestrating agent's instructions — even
  ones quoting a written spec — can authorize in this environment; that
  edit needs to come from the user directly. `CLAUDE.md` still describes
  the earlier Cencrest-branded, single-page, hardcoded-pricing plan and no
  longer matches the deployed BeBest site (brand, page list, pricing copy,
  or this epic's own `POST /api/apply` wiring).
- **`API_ORIGIN` (`https://api.bebestwithai.com` in production) is an
  unverified assumption**, not a confirmed fact — no architecture doc in
  this repo names the deployed API domain (`docs/05-architecture/ARCHITECTURE.md`,
  referenced by `platform/apps/api/src/app.ts`'s own CORS comment, does
  not exist in the repo at the path it's referenced from). This follows
  the `app.bebestwithai.com` subdomain convention the API's CORS allowlist
  already uses, but it is a single named constant at the top of
  `interactions.js` specifically so it's a one-line fix if the real domain
  differs. **This must be confirmed against the actual API deployment
  before this form works in production** — everything else in this build
  (validation, error states, honeypot, the snapshot-link split) was
  verified by reading the real `apply.ts` route and its exact response
  shapes, but the network origin itself could not be confirmed the same
  way.
- **The site-wide nav "Get Free Snapshot" CTA on pages outside the epic's
  named scope** (`about.html`, `blog.html`, `resources.html`,
  `ai-recommendation-strategy.html`, `ai-visibility-audit.html`,
  `terms.html`, `privacy-policy.html`, `cookie-policy.html`) still points
  to `/contact.html`, which after this rebuild is the sales-intent form,
  not a snapshot flow — the same mismatch this epic fixed on
  `index.html`/`services.html`/`pricing.html`/`ai-visibility-snapshot.html`.
  The epic's own "In scope" bullet names only those four pages'
  Free-Snapshot CTAs; the other eight pages were left untouched rather
  than silently expanding scope to a page-list the spec doesn't name. This
  is a known, flagged gap, not an oversight.
- **No verification/build tooling exists for this site** (no build step,
  no test runner, no linter configured at the repo root per this
  project's own `CLAUDE.md`/`platform/EPICS.md` framing) — verification
  here was direct code reading (backend route source, response shapes,
  existing CSS tokens/classes) and manual trace of every path in "End-to-
  end flow" above, not an automated test suite or a live run against the
  real API. Per the standing instruction to hand off to `qa-tester` once a
  flow is functionally complete, this build has not been separately
  QA-verified.
- **`#index`'s three cards remain fabricated placeholder content** (fake
  dates/read-times) — explicitly out of scope per the spec (no CMS epic
  exists to source real BeBest-authored articles); only the dead-link and
  unlabeled-as-real-research problems were fixed.

## Files touched

- `index.html` — nav/hero/score-card snapshot CTAs repointed;
  `#chorus` illustrative-example badge; `#index` cards converted to real
  `<a>` links + illustrative-example caption; `#apply` section rewritten
  (copy, honeypot, `name` attributes, `maxlength`, secondary snapshot
  nudge, live-region status elements).
- `contact.html` — nav snapshot CTA repointed; hero copy and form-section
  copy rewritten to sales-intent framing with an explicit secondary
  snapshot link; form wired (honeypot, `maxlength`, live-region status
  elements, `novalidate` + JS-driven validation); inline nav-scroll
  `<script>` replaced with `<script src="./interactions.js">`.
- `services.html` — nav + "Get Your Free Snapshot" CTA repointed to the
  real snapshot flow.
- `pricing.html` — nav + the Snapshot tier's "Get Free Snapshot →" CTA
  repointed.
- `ai-visibility-snapshot.html` — nav + both "Get Your Free Snapshot →"
  CTAs repointed.
- `interactions.js` — `API_ORIGIN` constant; `wireApplyForm()` (fetch,
  validation, honeypot/service-field handling, success/422/429/network
  error states); wired to every `.apply-form` on `DOMContentLoaded`.
- `style.css` — `.tag-illustrative`, `.index-note`, `.index-entry` link
  states, `.hp-field`, `.apply-btn:disabled`, `.apply-btn-spinner`,
  `.form-status`/`--success`/`--error`, `.apply-snapshot-nudge`.
- `platform/docs/epics/20-marketing-site-rebuild-frontend.md` (this file).
