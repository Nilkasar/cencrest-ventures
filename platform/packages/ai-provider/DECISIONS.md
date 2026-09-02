# @bebest/ai-provider — decisions

Spec source: `platform/docs/epics/06-ai-provider-abstraction.md`, whose
interface is a verbatim contract from `docs/12-ai/AI_ARCHITECTURE.md`
(repo root). This lists every place an implementation choice was needed
beyond what those two documents specify literally, and why.

## Why a separate package, not `apps/api/src/lib/ai-provider.ts`

ADR-003 is "no application code may import an AI provider SDK directly" —
that only holds monorepo-wide if the abstraction lives somewhere every app
can depend on. `apps/api` needs it (Epic 7+ routes); the eventual GEO/SEO/
Growth agents (Epic 12) are a separate runtime context and need the exact
same interface. A package under `packages/` with zero dependency on
`@bebest/database` or `@bebest/api` is the only shape that serves both
without either one importing the other.

## No dependency on `@bebest/database`

Deliberate, not an oversight. This package never writes a `prompt_versions`
row, never touches `ai_runs`/`ai_responses`, and has no notion of
`organizationId`/RLS at all. `docs/12-ai/AI_ARCHITECTURE.md`'s pipeline step
"c. Store raw response immediately" is the CALLER's job (Epic 7's job,
specifically) — this package returns a fully-formed `CompletionResult`/
`ExtractionResult<T>` and gets out of the way. Keeping this package
persistence-free is what makes "unit tests against mocked HTTP, zero
database, zero API keys" true by construction rather than by discipline.

## `FetchLike` dependency injection instead of mocking global `fetch`

Every provider takes an optional `fetchImpl` constructor option (default:
global `fetch`). This was chosen over intercepting `globalThis.fetch` with
`vi.spyOn`/`msw` because:
- It makes "no real network calls in tests" true at the type level — a test
  that forgets to configure a fake transport gets real `fetch`, which is
  the opposite of what we want, but it's at least visible/loud (a real
  network error) rather than silently mocked.
- Actually mocking `globalThis.fetch` per test file is exactly the kind of
  shared-mutable-global-state pattern that causes cross-test bleed if a
  `restoreAllMocks()` is forgotten somewhere. Constructor injection has no
  such failure mode — each `new OpenAIProvider({ fetchImpl })` is fully
  isolated.
- It costs nothing in production: omitting `fetchImpl` gets the real
  `fetch`, unchanged behavior.

## `extract<T>()` implemented once, in `BaseAIProvider`, not per-provider

The interface doesn't require this — each provider could implement
`extract()` independently. Doing it once in a shared base class means the
retry-until-schema-valid logic (ADR-004) is identical across all five
providers and is tested once (`providers/base-provider.test.ts`) against a
fake transport, rather than five times with subtly different retry
behavior. Every concrete provider implements only `complete()` and
`healthCheck()`.

## `retries` semantics: total attempts = `retries + 1`

AI_ARCHITECTURE.md's `ExtractionRequest<T>.retries` doc-comment says
"retry if output doesn't match schema (default: 2)". The field is literally
named `retries`, so this implementation reads it as "2 retries after the
first attempt" → 3 total attempts by default, not "2 attempts total".
Documented explicitly in `types.ts` and asserted in
`base-provider.test.ts` ("defaults to 2 retries (3 total attempts)") so the
interpretation is pinned down in a test, not just a comment, in case a
later epic reads this differently.

## `content.generation` task default: `['openai', 'ollama']`, not the bare
string `'openai'` from the doc's pseudocode

AI_ARCHITECTURE.md's example `taskDefaults` table literally writes:
```
'content.generation': 'openai',  // or ollama if no key
```
The epic spec (`06-ai-provider-abstraction.md`) is more explicit: *"
`content.generation` → openai-or-ollama-fallback"*. A bare string can't
express a fallback; only an ordered array can. `DEFAULT_TASK_DEFAULTS`
therefore stores `['openai', 'ollama']`, and
`AIProviderRegistry.resolveAvailable()` is the method that actually walks
that list and returns the first provider whose `healthCheck()` is `true` —
making the doc's parenthetical comment real behavior instead of aspirational
prose. `geo.query`, `seo.analysis`, and `extraction` are transcribed as-is.

## Two resolution methods, not one, on `AIProviderRegistry`

- `resolve(task, override?)` — returns every candidate as `AIProvider[]`,
  unfiltered by health. This is what `geo.query` needs: Epic 7's pipeline
  is supposed to query all four cloud assistants per query, not "the first
  one that works" — fan-out, not fallback.
- `resolveAvailable(task, override?)` — walks the same candidate list and
  returns the first one whose `healthCheck()` resolves `true`, throwing
  `NoAvailableProviderError` if none are. This is what `content.generation`,
  `seo.analysis`, and `extraction` want: exactly one usable provider.

Collapsing these into one method would force every caller to either accept
an array when they wanted one provider, or accept a single provider when
they needed to fan out — both wrong for one of the two real use cases this
epic exists to serve.

A provider name listed in a task's candidates but never `providers: {...}`-
registered is silently skipped by `resolveAvailable()` (not a thrown
`ProviderNotRegisteredError`) — a deployment with no `PERPLEXITY_API_KEY`
at all shouldn't have to also edit the routing table just to avoid a crash
on `content.generation`. `resolve()` (fan-out) still throws in that case,
because `geo.query` genuinely needs to know a provider it was told to query
doesn't exist, rather than silently querying fewer than the intended set.

## Health checks that hit real endpoints, chosen per provider

- **Ollama** → `GET /api/tags` (lists local models — cheap, doesn't load
  a model into memory).
- **OpenAI** → `GET /v1/models` (standard "is this key valid" probe).
- **Anthropic** → `GET /v1/models` (same idea; requires
  `anthropic-version` header like every other Anthropic call).
- **Google** → `GET /v1beta/models?key=...` (Gemini's key travels as a
  query param, not a header, for every endpoint including this one).
- **Perplexity** → no publicly documented "list models"/health endpoint
  exists, so `healthCheck()` sends the cheapest real completion it can
  (`max_tokens: 1`, prompt `"ping"`) as a connectivity+auth probe. This is
  the one provider where a health check has a (negligible) real cost in
  production; documented here so nobody is surprised by it later.

Every `healthCheck()` wraps its request in try/catch and returns `false` on
ANY failure (network error, non-2xx, thrown exception) — never propagates
an exception. This is tested explicitly for all five providers
(`*.test.ts`, "resolves false (never throws)" cases) because the epic's DoD
calls it out as a specific, checked requirement.

## JSON extraction: `ajv` for schema validation, a hand-rolled candidate
extractor for pulling JSON out of prose

`ExtractionRequest.schema` is typed as a plain `JSONSchema` object (not a
Zod schema or similar) to match the verbatim contract — `extract<T>()` has
to validate an arbitrary caller-supplied JSON Schema document, which is
exactly `ajv`'s job (`strict: false` because we don't want to also enforce
Ajv's schema-authoring lint rules on schemas this package didn't write).

Real model output is rarely *pure* JSON even when asked for it directly —
` ```json ... ``` ` fences and a leading/trailing sentence are the common
cases. `json.ts#extractJsonCandidate` tries, in order: the whole trimmed
string as-is → a fenced code block → the substring between the first
`{`/`[` and the last matching `}`/`]`. This is deliberately NOT a full
JSON-in-text parser (no bracket-balance tracking) — good enough for the
model behaviors actually observed, and if it picks the wrong substring the
next `JSON.parse` simply fails and the extraction retries with a stricter
instruction, which is the correct failure mode anyway (ADR-004: never let
malformed output become a wrong observation, even from an imperfect
extractor).

## Prompt loader: file convention implemented and tested; no domain prompt
content authored in this epic

`prompts/loader.ts` implements exactly the file-naming/versioning
convention from AI_ARCHITECTURE.md (`{name}.v{version}.txt` under
`{baseDir}/{category}/`) as a generic, `baseDir`-parameterized utility —
this package has no built-in default directory, and does NOT create or own
`apps/api/prompts/**`. The convention is proven with fixture files under
`src/prompts/__fixtures__/` used only by `loader.test.ts`.

This is a deliberate scope line: authoring the actual GEO/SEO/content
prompt text (`brand-query.v1.0.txt` and friends, with real prompt
engineering) is domain work that belongs to the epics that consume it
(7/11/12), which also own deciding where under `apps/api/` those files
live and how a route wires `promptVersionFor()`'s output into a
`CompletionRequest`. This epic's job was proving the mechanism works, not
writing the prompts.

## `MissingTemplateVariableError` fails loud on any unfilled `{{placeholder}}`

`renderPrompt()` throws (naming every missing variable at once) rather than
leaving `{{unfilled}}` literally in the rendered string. A prompt sent to an
LLM with a raw, unsubstituted placeholder is malformed input by this
codebase's own principle ("AI/crawled content always treated as untrusted
data" cuts both ways — what we SEND has to be well-formed too), and a
silent pass-through would be indistinguishable from a caller correctly
using a literal `{{` in prose.

## What a real deployment still has to wire up (not this epic's job)

- Reading `OPENAI_API_KEY`/`ANTHROPIC_API_KEY`/`GOOGLE_API_KEY`/
  `PERPLEXITY_API_KEY` from `process.env` and constructing the
  `AIProviderRegistry` with them — that's `apps/api`'s composition root
  (a small `createDefaultRegistry()`-shaped function in that app, not in
  this package, which has zero `process.env` reads by design so it stays
  usable from any runtime, including a future worker process with a
  different env var naming scheme).
- Persisting `CompletionResult`/`ExtractionResult` to `ai_runs`/
  `ai_responses`/`prompt_versions` (Epic 7).
- Rate limiting / exponential backoff across many calls to the same
  provider (AI_ARCHITECTURE.md's "Rate Limiting Strategy" table) — this
  package makes one call per `complete()`/`extract()` invocation and
  surfaces `ProviderRequestError.status` so a caller CAN implement backoff,
  but doesn't retry HTTP-level failures itself (only schema-validation
  failures, via `extract()`'s retry).
- Authoring the actual prompt template files (see above).
