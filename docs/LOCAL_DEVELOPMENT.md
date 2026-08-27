# LOCAL DEVELOPMENT — BeBest

**Version**: 1.0  
**Date**: 2026-08-27  
**Verified on**: MacBook Air M4, macOS 15.5, 16 GB RAM

---

## 1. MACHINE REQUIREMENTS

| Requirement | Minimum | Current Machine |
|---|---|---|
| CPU | Apple Silicon M1+ | Apple M4 (10-core) |
| RAM | 16 GB | 16 GB |
| OS | macOS 12+ | macOS 15.5 (Sonoma) |
| Disk | 20 GB free | (check before starting) |

The local environment runs entirely on the Mac. No cloud services required for development.

---

## 2. INSTALLED SOFTWARE (VERIFIED 2026-08-27)

| Software | Version | Purpose | Install method |
|---|---|---|---|
| macOS | 15.5 | OS | — |
| Apple M4 (arm64) | — | Architecture | — |
| Node.js | 24.12.0 | Application runtime | Homebrew / nvm |
| npm | 11.6.2 | Package manager | Bundled with Node |
| Git | 2.39.5 | Version control | Apple CLT |
| Ollama | 0.30.3 | Local AI model runner | ollama.ai |
| OpenCode | 1.18.20 | Local coding agent | Homebrew |
| Claude Code | 2.1.119 | Architecture / review agent | npm -g |
| Python | 3.9.6 | Tooling scripts | Apple CLT / system |
| PostgreSQL | 16.11 (Homebrew) | Application database | Homebrew |
| Docker | NOT INSTALLED | — | Not required |
| Redis | NOT INSTALLED | — | Not required at this stage |

---

## 3. OLLAMA SETUP

Ollama runs the local AI models that power OpenCode and (eventually) the BeBest GEO engine during development.

### Starting Ollama

Ollama starts automatically as a background service on macOS after install. Verify:

```bash
curl http://localhost:11434
# Expected: "Ollama is running"
```

If not running:

```bash
ollama serve
```

### Verifying models

```bash
ollama list
curl -s http://localhost:11434/api/tags | python3 -m json.tool
```

### Pulling a model if missing

```bash
ollama pull qwen3:8b
ollama pull qwen2.5-coder:7b
```

---

## 4. AVAILABLE LOCAL MODELS (VERIFIED 2026-08-27)

| Model | Size | Context | Tool Calling | Best For |
|---|---|---|---|---|
| qwen3:8b | 8.2B | 40,960 tokens | **YES (confirmed)** | Reasoning, planning, architecture review |
| qwen2.5-coder:7b | 7.6B | 32,768 tokens | NO | Code generation, implementation |
| deepseek-coder:6.7b | 7B | 16,384 tokens | NO (API 400 error) | Code (fallback only) |
| llama3.1:8b | 8B | 131,072 tokens | Unknown | General tasks |
| mistral:latest | 7.2B | Unknown | Unknown | General tasks |

**Measured performance on M4 (qwen3:8b):** ~20 tokens/second

---

## 5. OPENCODE SETUP

OpenCode is the local coding agent. It uses Ollama models via the OpenAI-compatible API at `http://localhost:11434/v1`.

### Configuration file

`opencode.json` at repository root configures:
- Default model: `ollama/qwen3:8b`
- Base URL: `http://localhost:11434/v1`
- All four available models registered with context limits

### Running OpenCode

```bash
# Interactive TUI (recommended for coding sessions)
opencode

# Non-interactive, single prompt
opencode run --model ollama/qwen3:8b "your instruction here"

# With a different model
opencode run --model ollama/qwen2.5-coder:7b "write a TypeScript function..."
```

### Tool calling in OpenCode

OpenCode tools (read, write, edit, glob, bash) require the model to actually invoke them.

**Confirmed:** qwen3:8b invokes tools (read, write, bash) via OpenAI tool-calling API.  
**Not confirmed:** qwen2.5-coder:7b, deepseek-coder:6.7b — these describe actions in text but do not invoke tools via API.

**Critical: qwen3:8b is the only model confirmed to use filesystem tools.**

### Known issue: Qwen3 unsolicited writes

qwen3:8b may write to files when only asked to read them. The model is enthusiastic about executing tasks. Mitigate by:

1. Using explicit negative instructions: "DO NOT write or modify any files."
2. Reviewing all changes with `git diff` before committing.
3. Using `git checkout <file>` to revert any unintended writes.

**Always run `git diff` after any OpenCode session before committing.**

---

## 6. MODEL CONFIGURATION (OPENCODE)

Defined in `opencode.json`:

```json
{
  "model": "ollama/qwen3:8b",
  ...
}
```

To use a different model for a session, pass `--model`:

```bash
opencode run --model ollama/qwen2.5-coder:7b "implement the users table migration"
```

**Recommended model assignment:**

| Task | Model |
|---|---|
| Architecture decisions, planning | `qwen3:8b` |
| Code implementation (routine) | `qwen2.5-coder:7b` |
| File reading and reporting | `qwen3:8b` (tools required) |
| Debugging complex issues | `qwen3:8b` |
| Fallback if coder fails | `deepseek-coder:6.7b` |

---

## 7. POSTGRESQL SETUP

### Instance details (VERIFIED 2026-08-27)

| Property | Value |
|---|---|
| Version | PostgreSQL 16.11 (Homebrew) |
| Port | **5434** (NOT 5432 — multiple PG versions on this machine) |
| Data directory | `/Users/nilesh/bebest-pgdata` |
| Database name | `bebest` |
| User | `nilesh` |
| Password | none (trust auth) |
| Auth method | trust (pg_hba.conf) |
| Status | Running (started as process, not brew service) |

**Why port 5434?** The system also runs PostgreSQL 17 and 18 (EnterpriseDB installations) on port 5432. The BeBest development instance runs on 5434 to avoid conflict.

### Connecting

```bash
psql -h localhost -p 5434 -U nilesh -d bebest

# or using DATABASE_URL
psql "postgresql://nilesh@localhost:5434/bebest"
```

### Starting the database (if not running)

```bash
pg_ctl -D /Users/nilesh/bebest-pgdata -p 5434 start
# or
/opt/homebrew/bin/pg_ctl -D /Users/nilesh/bebest-pgdata -p 5434 start -l /Users/nilesh/bebest-pgdata/postgres.log
```

### Stopping the database

```bash
pg_ctl -D /Users/nilesh/bebest-pgdata stop
```

### Checking status

```bash
pg_isready -h localhost -p 5434
psql -h localhost -p 5434 -U nilesh -d bebest -c "SELECT version();"
```

### Existing database state (as of 2026-08-27)

The `bebest` database already contains 41 tables and the `pgboss` background job schema. This was set up prior to the documentation phase. The current schema diverges from `docs/06-database/SCHEMA.md` in some columns — Epic 1 should reconcile the actual schema with the documented target schema.

```bash
# List all tables
psql -h localhost -p 5434 -U nilesh -d bebest -c "\dt"

# List schemas
psql -h localhost -p 5434 -U nilesh -d bebest -c "\dn"
```

Key schemas:
- `public` — 41 application tables
- `pgboss` — background job queue (pg-boss library)

### Connection string for .env.local

```
DATABASE_URL=postgresql://nilesh@localhost:5434/bebest
```

---

## 8. REDIS SETUP

**Decision: Redis is NOT required at this development stage.**

Reason: The `pgboss` schema is already installed in the `bebest` database. pg-boss is a PostgreSQL-native background job queue (the npm package `pg-boss`). This handles background jobs without Redis.

The formal decision (D-O05 in DECISIONS.md) about queue system is still open, but pg-boss is already running. Redis would only be needed if BullMQ/Redis is chosen as the queue system in a future decision.

**Revisit Redis when:** D-O05 is formally decided in favor of BullMQ/Redis, or when cache layer requirements (D-O06) arise.

---

## 9. ENVIRONMENT VARIABLES

### Files

| File | Purpose | Committed? |
|---|---|---|
| `.env.example` | Template with all variable names, no real values | **YES** |
| `.env.local` | Your actual local secrets | **NO — gitignored** |
| `.env` | Production secrets | **NO — gitignored** |

### Setup

```bash
cp .env.example .env.local
# Then fill in any values needed for your current epic
```

For Epic 1 (Platform Foundation), you need:

```
DATABASE_URL=postgresql://nilesh@localhost:5434/bebest
NODE_ENV=development
PORT=3001
```

### Secrets that must never be committed

- API keys (OpenAI, Anthropic, Google, Perplexity, Resend, Airtable)
- JWT_SECRET and SESSION_SECRET
- Database passwords (currently empty for local dev)
- Any credential files

### Verifying .gitignore covers secrets

```bash
git check-ignore .env .env.local
# Expected output: both lines echoed = both are ignored
```

---

## 10. STARTING THE LOCAL STACK

As of 2026-08-27, there is no BeBest application server yet (no backend code). The local stack is:

```
1. PostgreSQL (already running as background process)
2. Ollama (already running as background process)
3. OpenCode (launch when starting a coding session)
```

### Verify stack is up

```bash
# PostgreSQL
pg_isready -h localhost -p 5434 && echo "PG OK"

# Ollama
curl -s http://localhost:11434 | grep -q "running" && echo "Ollama OK"

# Check models
ollama list
```

### Future stack (post-Epic 1)

Once the backend exists, the startup sequence will be:

```bash
# 1. PostgreSQL (already running)
# 2. Ollama (already running)
# 3. Backend API server
cd apps/api && npm run dev
# 4. Frontend dev server (when customer portal exists)
cd apps/web && npm run dev
# 5. OpenCode (for development)
opencode
```

A `Makefile` or `package.json` workspace script will be created in Epic 1 to unify these commands.

---

## 11. STOPPING THE LOCAL STACK

```bash
# PostgreSQL
pg_ctl -D /Users/nilesh/bebest-pgdata stop

# Ollama — kill the process if needed
pkill ollama

# Node processes — Ctrl+C in each terminal
```

---

## 12. RUNNING TESTS

**Status: NOT IMPLEMENTED**

No test framework exists. No `package.json`, no `vitest.config`, no `jest.config`.

Tests will be set up in Epic 1 (Platform Foundation) using Vitest.

When tests exist, they will run:

```bash
npm test              # unit tests
npm run test:int      # integration tests (requires live PG on port 5434)
npm run test:e2e      # end-to-end tests (requires full stack)
```

---

## 13. RUNNING THE BUILD

**Status: NOT IMPLEMENTED**

No build system exists for the application backend. The marketing site (HTML/CSS/JS) has no build step.

When the backend exists:

```bash
npm run build         # TypeScript → JavaScript
npm run type-check    # tsc --noEmit
npm run lint          # eslint
```

---

## 14. TROUBLESHOOTING

### PostgreSQL won't connect

```bash
# Check process is running
ps aux | grep postgres | grep 5434

# Check pg_isready
pg_isready -h localhost -p 5434

# Start if not running
/opt/homebrew/bin/pg_ctl -D /Users/nilesh/bebest-pgdata -p 5434 start -l /Users/nilesh/bebest-pgdata/postgres.log

# Check logs
tail -50 /Users/nilesh/bebest-pgdata/postgres.log
```

### Ollama not responding

```bash
# Check if running
curl http://localhost:11434

# Restart
pkill ollama && ollama serve &

# Check model is downloaded
ollama list | grep qwen3
```

### OpenCode tool calls not working

- **Only qwen3:8b supports tool calling** via the OpenAI-compatible API.
- If tools aren't being invoked, verify you're using `--model ollama/qwen3:8b`.
- If Ollama is slow, ensure no other heavy processes are running. M4 runs qwen3:8b at ~20 tok/s.

### OpenCode wrote to a file unexpectedly

```bash
git diff               # see what changed
git checkout <file>    # restore any file to last commit
git status             # verify restore
```

### Port 5432 vs 5434 confusion

The machine has THREE PostgreSQL instances:
- Port 5432: PostgreSQL 17 and 18 (system, `postgres` user, requires password)
- Port 5434: PostgreSQL 16 (BeBest development, `nilesh` user, trust auth)

Always use port 5434 for BeBest development.

---

## 15. CLAUDE CODE WORKFLOW

Claude Code (this tool) handles:

- Architecture decisions
- Documentation
- Security review
- Complex debugging
- Code review and quality gates
- Planning epics and acceptance criteria

Claude Code does NOT do:
- Routine implementation (that's OpenCode + Qwen)
- Long repetitive refactoring (that's OpenCode + Qwen)

**Workflow:**

```
You (product decisions)
  ↓
Claude Code (architecture + spec + review)
  ↓ hands off implementation spec
OpenCode + Qwen (implementation)
  ↓ produces code
Automated Tests (objective verification)
  ↓ passes
Claude Code (quality gate review)
  ↓ approved
Git commit → next epic
```

---

## 16. OPENCODE / QWEN WORKFLOW

### Starting a session

```bash
cd /Users/nilesh/Documents/GitHub/Cencrest-ventures
opencode
```

Select model: `ollama/qwen3:8b` for tool-using tasks.  
Select model: `ollama/qwen2.5-coder:7b` for pure code generation.

### Model selection guide

| Task | Command |
|---|---|
| Read a file and report | `opencode run --model ollama/qwen3:8b "Read X and tell me..."` |
| Write a new module | `opencode run --model ollama/qwen2.5-coder:7b "Write a TypeScript..."` |
| Debug a complex issue | `opencode run --model ollama/qwen3:8b "Debug this..."` |
| Database migration | `opencode run --model ollama/qwen2.5-coder:7b "Write migration SQL for..."` |

### Best practices

1. **Always specify the model explicitly** with `--model` to avoid surprises.
2. **State what NOT to do**: "DO NOT write or modify any files. Just read and report."
3. **Verify with git diff** before every commit: `git diff` / `git status`
4. **Never commit unreviewed changes** from a Qwen session.
5. **One epic at a time**: give Qwen a single well-scoped task per session.

---

## 17. SECURITY RULES

The following rules apply to ALL development on this machine:

1. **Never commit secrets.** `.env` and `.env.local` are gitignored. Verify with `git check-ignore .env.local`.
2. **Never put real credentials in `.env.example`.** Only variable names and comments.
3. **Never commit API keys** — OpenAI, Anthropic, Google, Perplexity, Resend, Airtable.
4. **Never commit database passwords** (there are none locally, but staging/prod will have them).
5. **Review all Qwen-generated code** before committing — the model may produce insecure patterns.
6. **Check for SSRF vectors** in any code that accepts URLs as input.
7. **Check for SQL injection** in any code that constructs queries with user input.
8. **Claude Code reviews all security-sensitive epics** before OpenCode implementation begins.

---

## 18. WHAT MUST REMAIN LOCAL

The following must NEVER leave the local machine:

- `/Users/nilesh/bebest-pgdata/` — local development database
- `.env.local` — local environment secrets
- Any Ollama model weights — these are large binary files in `~/.ollama/`

---

## 19. WHAT MUST NEVER BE COMMITTED

```
.env
.env.local
.env.development.local
node_modules/
dist/
.next/
*.log
*.pem
*.key
*.p12
credentials.json
serviceAccountKey.json
```

---

## 20. KNOWN LIMITATIONS

| # | Limitation | Impact | Resolution |
|---|---|---|---|
| L-01 | qwen3:8b is the only local model with tool calling | OpenCode tool use requires qwen3:8b | Use qwen2.5-coder:7b for code-only tasks via direct prompt |
| L-02 | qwen3:8b may write files when only reading was requested | Risk of unintended file modifications | Always run `git diff` after sessions; use explicit "DO NOT write" instructions |
| L-03 | No backend application code exists yet | Cannot run an API server | Epic 1 creates the backend skeleton |
| L-04 | No test framework exists | Cannot run `npm test` | Epic 1 sets up Vitest |
| L-05 | Local DB schema (41 tables) diverges from SCHEMA.md | Documentation may be out of sync | Epic 1 reconciles with Drizzle migrations |
| L-06 | D-O01 (backend language) not yet decided | Cannot finalize tech stack | Decide before Epic 1 starts |
| L-07 | Form submissions still lost (TD-001) | All marketing site leads lost | Fix urgently — independent of Epic 1 |
| L-08 | ~20 tok/s on M4 for 8B models | Long sessions take time | Acceptable for dev; use cloud models for large analysis tasks |
| L-09 | 16 GB RAM limits running >2 models simultaneously | Cannot run two 8B models at once | Run models sequentially; close others before loading new |
