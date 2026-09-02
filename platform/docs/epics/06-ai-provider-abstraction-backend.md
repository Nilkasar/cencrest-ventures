# Epic 6 — AI Provider Abstraction (backend)

Status: BUILT (no migration — this epic adds no schema, no database
connection, and no routes; see "What this epic explicitly does not touch"
below). Package: `platform/packages/ai-provider` (`@bebest/ai-provider`).

## What was built

A new workspace package, `@bebest/ai-provider`, implementing the exact
`AIProvider` interface from `docs/12-ai/AI_ARCHITECTURE.md` (repo root),
per `platform/docs/epics/06-ai-provider-abstraction.md`'s spec. Nothing
under `apps/api`, `apps/web`, or `packages/database` was modified — this
package has zero dependency on `@bebest/database` by design (see
`DECISIONS.md` in the package for why), so it is importable from `apps/api`
today and from a future worker/agent runtime later without either one
depending on the other.

### Interface (`src/types.ts`)

`AIProvider { name, model, complete(), extract<T>(), healthCheck() }`,
`CompletionRequest`/`CompletionResult`/`ExtractionRequest<T>`/
`ExtractionResult<T>` transcribed field-for-field from the architecture doc.
`CompletionRequest.promptVersion` is required; every concrete provider
calls a shared `assertPromptVersion()` guard before making any network
call, throwing `MissingPromptVersionError` if it's empty — enforced at one
checkpoint (`BaseAIProvider`), not duplicated five times.

### Providers (`src/providers/`)

- `OllamaProvider` — local dev default, `qwen3:8b`, no API key,
  `healthCheck()` hits `GET /api/tags`.
- `OpenAIProvider`, `AnthropicProvider`, `GoogleProvider`,
  `PerplexityProvider` — cloud, key-gated via constructor `apiKey` option.
  With no key: `healthCheck()` resolves `false` immediately (no network
  call attempted), `complete()`/`extract()` throw
  `ProviderNotConfiguredError` rather than making a doomed request.
- All five extend `BaseAIProvider` (`src/providers/base-provider.ts`),
  which implements `extract<T>()` once on top of the subclass's
  `complete()`: render → call → `parseAndValidateJson()` against the
  caller's schema → on mismatch, retry with a stricter prompt that echoes
  the validation failure and the schema back to the model. Default 2
  retries (3 total attempts) — see the package's `DECISIONS.md` for why
  "retries: 2" was read as 3 total attempts, not 2.
- Every provider takes an injectable `fetchImpl` (default: global
  `fetch`), which is how the test suite mocks HTTP per-provider without a
  network-mocking library or touching global state.
- `healthCheck()` never throws for any provider — every implementation
  wraps its probe in try/catch and returns `false` on any failure. Tested
  explicitly for all five (`*.test.ts` → "resolves false (never throws)"),
  per this epic's DoD requirement.

### Extraction schema discipline (`src/json.ts`)

`parseAndValidateJson<T>(raw, schema)` — extracts the most likely JSON
substring out of free-form model text (handles pure JSON, fenced
` ```json ` blocks, and JSON embedded in prose), parses it, and validates
against the caller's JSON Schema via `ajv` (`strict: false` — the schema is
caller-authored, arbitrary JSON Schema, not something this package
generates). Throws `JsonParseError` (nothing parseable at all) or
`SchemaValidationError` (parsed but doesn't match) — `extract<T>()` never
returns a value that hasn't been validated, which is ADR-004's actual
requirement ("LLMs extract observations; formulas compute scores" only
holds if malformed LLM output can never silently become an observation).

### Registry (`src/registry.ts`)

`AIProviderRegistry` with `DEFAULT_TASK_DEFAULTS` transcribed from
AI_ARCHITECTURE.md's routing table, with one explicit, documented departure:
`content.generation` is stored as the ordered chain `['openai', 'ollama']`
rather than the doc's bare string `'openai'`, because the epic spec calls
for actual fallback behavior ("openai-or-ollama-fallback"), which only an
ordered list (walked by `resolveAvailable()`) can express — see the
package's `DECISIONS.md` for the full reasoning. Two resolution methods,
matching the two real usage patterns this epic has to serve:

- `resolve(task, override?)` — returns every candidate as `AIProvider[]`,
  unfiltered by health. What `geo.query` needs (Epic 7 queries all 4 cloud
  assistants per query — fan-out, not "pick one").
- `resolveAvailable(task, override?)` — returns the first candidate whose
  `healthCheck()` resolves `true`, throwing `NoAvailableProviderError` if
  none are. What `content.generation`/`seo.analysis`/`extraction` need.

Priority order (override > task default > global default) matches
AI_ARCHITECTURE.md's "Provider Resolution" section exactly.

### Prompt system (`src/prompts/loader.ts`)

Implements the `{name}.v{version}.txt` file-naming convention under
`{baseDir}/{category}/` — `loadPromptTemplate()` (loads highest version by
default, or an explicit pinned one), `listPromptVersions()`,
`renderPrompt()` (`{{variable}}` substitution; throws
`MissingTemplateVariableError` naming every unfilled placeholder at once —
never silently ships a raw `{{...}}` into a real prompt), and
`promptVersionFor()` (formats the `"{name}.v{version}"` string a
`CompletionRequest.promptVersion` should carry). `baseDir` is a required
parameter, not a built-in default — this package does not create or own
`apps/api/prompts/**`; proving the convention is this epic's job, authoring
the actual GEO/SEO/content prompt text is domain work for Epics 7/11/12
(see package `DECISIONS.md`, "Prompt loader" section, for the explicit
scope line and why).

## Definition of done — verified

- ✅ Unit tests for the registry's routing logic (`src/registry.test.ts`,
  16 tests): task-default lookup, override priority, fan-out vs.
  fallback-to-first-healthy, `NoAvailableProviderError`,
  `ProviderNotRegisteredError`, a snapshot test pinning
  `DEFAULT_TASK_DEFAULTS` to the documented table.
- ✅ Unit tests for request/response shape validation, all against mocked
  HTTP: one test file per provider (`src/providers/*.test.ts`) asserting
  the exact outgoing request shape (URL, headers, body) and the mapped
  `CompletionResult`, plus `src/json.test.ts` (11 tests) for the
  extract/validate boundary and `src/providers/base-provider.test.ts`
  (5 tests) for the shared retry logic.
- ✅ `healthCheck()` tests asserting a provider with no configured key
  reports `false` cleanly rather than throwing — present for all four cloud
  providers, plus a "network failure → `false`, never throws" case for all
  five providers including Ollama.
- ✅ Zero real API keys or network calls required: every provider is
  constructed with a hand-rolled `fetchImpl` in every test; no `.env`,
  no `process.env` read anywhere in the package.

Full suite: **76 tests, 9 files, all passing** (`pnpm --filter
@bebest/ai-provider test`). `pnpm --filter @bebest/ai-provider typecheck`
and `lint` both pass clean. `pnpm typecheck` at the repo root also passes
for `@bebest/ai-provider`, `@bebest/database`, `@bebest/api`, `@bebest/ui`
(the pre-existing `@bebest/web` typecheck failures are unrelated CRM/
onboarding work-in-progress already present in the tree before this epic
started — not touched by, or a consequence of, this change).

## What this epic explicitly does not touch

- No `apps/api` changes — no routes, no composition root wiring real
  `process.env` API keys into an `AIProviderRegistry` instance. That's a
  small addition (a `createDefaultRegistry()`-shaped function) for
  whichever epic first needs to actually call a provider from a route
  (Epic 7).
- No `packages/database` changes, no `prisma migrate`/`db push`/`db pull`
  run, no write to `prompt_versions`/`ai_runs`/`ai_responses`. This package
  returns fully-formed results and gets out of the way; persisting them is
  the caller's job.
- No GEO query execution pipeline, no rate limiting/backoff across many
  calls (`ProviderRequestError.status` is surfaced so a caller CAN
  implement backoff, but a single `complete()`/`extract()` call does not
  retry HTTP failures itself — only schema-validation failures via
  `extract()`'s retry loop).
- No actual prompt template content authored (`apps/api/prompts/**` does
  not exist yet) — only the loader + convention + fixture-backed tests.
- No UI — this epic is backend-only per the task brief.

## For Epic 7 (and 11, 12) to pick up

1. Build a small composition root in `apps/api` (e.g.
   `src/lib/ai-registry.ts`) that reads `OPENAI_API_KEY`/
   `ANTHROPIC_API_KEY`/`GOOGLE_API_KEY`/`PERPLEXITY_API_KEY` from
   `process.env` and constructs one `AIProviderRegistry` for the app's
   lifetime — this package deliberately never reads `process.env` itself.
2. Author the actual prompt template files under `apps/api/prompts/{geo,
   seo,content,agents}/*.v{version}.txt` per the convention this package's
   `loadPromptTemplate()` already implements and tests.
3. Wire `CompletionResult`/`ExtractionResult` persistence to `ai_runs`/
   `ai_responses`/`prompt_versions` via `@bebest/database`'s
   `withOrgContext` — this package has no opinion on that, by design.
4. The GEO query pipeline (`docs/12-ai/AI_ARCHITECTURE.md`'s 5-stage
   PREPARE/QUEUE/EXECUTE/AGGREGATE/DELIVER flow) is entirely Epic 7's
   scope; this package supplies step "b. Call AI provider" and part of
   step "d. Extract observations", nothing else in that pipeline.
