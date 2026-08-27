# SECURITY ARCHITECTURE — BeBest

**Version**: 1.0  
**Date**: 2026-08-11

---

## THREAT MODEL

### Assets to Protect
1. Customer data (brand intelligence, AI responses, competitive data)
2. Credentials (API keys, database passwords, OAuth secrets)
3. Billing data (card info managed by payment provider, not us)
4. Customer website content ingested by crawler
5. AI query results (competitive intelligence, citations)
6. CRM data (contacts, deals, communications)

### Threat Actors
1. **External attacker** — attempts unauthorized access, data theft, injection
2. **Malicious customer** — attempts to access other tenants' data
3. **Malicious website owner** — crafts website to poison crawler or extract data via SSRF
4. **Compromised customer account** — attacker with valid credentials
5. **AI prompt injection** — malicious content in AI responses or customer websites designed to manipulate system behavior

---

## AUTHENTICATION

### Method
- **Primary**: Email magic link (passwordless) — simpler, no password storage
- **Secondary**: OAuth (Google, GitHub) for faster onboarding
- **Session**: JWT with short expiry (15 minutes) + refresh token (7 days, rotation on use)

### Session Security
- HttpOnly, Secure, SameSite=Strict cookies for session token
- Session tokens stored in database (for revocation)
- Logout invalidates all tokens server-side
- Concurrent session limit: UNDECIDED (recommend 5)

### Token Standards
- JWT signed with RS256 (asymmetric)
- Claims: `sub` (user ID), `org` (organization ID), `role`, `iat`, `exp`
- No sensitive data in JWT payload

---

## AUTHORIZATION / RBAC

### Roles

| Role | Scope | Permissions |
|---|---|---|
| `owner` | Organization | Full access including billing, member management, deletion |
| `admin` | Organization | Full access except billing and org deletion |
| `analyst` | Organization | Read all intelligence, create/edit own content, no publishing |
| `editor` | Organization | Read intelligence, create/edit content, approve own drafts |
| `viewer` | Organization | Read-only access to dashboards and reports |
| `system` | Internal | Background jobs, agents (no human login) |
| `super_admin` | Platform | BeBest staff only — cross-org access for support |

### Permission Matrix (key operations)

| Action | owner | admin | analyst | editor | viewer |
|---|---|---|---|---|---|
| View intelligence | ✓ | ✓ | ✓ | ✓ | ✓ |
| Create brand profile | ✓ | ✓ | ✓ | ✗ | ✗ |
| Run AI analysis | ✓ | ✓ | ✓ | ✗ | ✗ |
| Create content draft | ✓ | ✓ | ✓ | ✓ | ✗ |
| Approve content | ✓ | ✓ | ✗ | ✓ (own) | ✗ |
| Publish content | ✓ | ✓ | ✗ | ✗ | ✗ |
| Manage integrations | ✓ | ✓ | ✗ | ✗ | ✗ |
| Manage billing | ✓ | ✗ | ✗ | ✗ | ✗ |
| Manage team | ✓ | ✓ | ✗ | ✗ | ✗ |
| Delete organization | ✓ | ✗ | ✗ | ✗ | ✗ |
| Autonomous actions | ✓ (if enabled) | ✓ (if enabled) | ✗ | ✗ | ✗ |

### Enforcement
- Authorization checked in API middleware before business logic
- Never rely on client-sent role — always read from database
- Role changes logged in audit trail

---

## TENANT ISOLATION

### Database Level
```sql
-- Row-Level Security on all tenant tables
ALTER TABLE [table] ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON [table]
  USING (organization_id = current_setting('app.current_org')::uuid);

-- Set org context on every DB connection
SET app.current_org = '[org_id]';
```

### Application Level
- API middleware validates JWT, extracts `org` claim
- Sets `app.current_org` in database session before every query
- Organization ID validated against user's memberships

### Testing Tenant Isolation
- Integration test: Create two orgs, create data in each, verify org A cannot read org B's data
- This test is a quality gate — no epic is COMPLETE without it passing

---

## INPUT VALIDATION

### All User Input
- Type validation (string, number, enum) — server-side, not client-side
- Length limits enforced
- Encoding validated (UTF-8)
- SQL injection: use parameterized queries / ORM only, never string interpolation
- XSS: HTML-encode all user content before rendering; CSP header on all pages

### URL Input (customer website URLs)
SSRF is the critical threat. Any URL input that causes a server-side HTTP request must be protected.

```
ALLOWED:
  - Public routable IP addresses
  - Standard HTTP/HTTPS schemes
  - Ports 80, 443

BLOCKED:
  - 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16 (private RFC1918)
  - 127.0.0.0/8 (loopback)
  - 169.254.0.0/16 (link-local, cloud metadata)
  - ::1, fc00::/7 (IPv6 private)
  - file://, ftp://, gopher://, other non-HTTP schemes
  - Internal hostnames (localhost, *.internal, *.local)
```

Implement DNS rebinding protection: resolve hostname before request, re-validate after DNS resolution.

### AI Response Content
AI responses are UNTRUSTED. Before processing:
1. Limit response size (reject responses > configured max)
2. Strip any HTML/script tags from stored text
3. Detect prompt injection patterns (attempts to override system instructions)
4. Log injection attempts

### Crawler Input
Customer websites are UNTRUSTED. Crawler must:
1. Validate URL before crawl (SSRF protection)
2. Limit crawl depth (max 3 levels)
3. Limit total pages per crawl (max 500)
4. Limit crawl rate (max 2 req/sec)
5. Respect robots.txt
6. Strip and sanitize all extracted HTML
7. Detect and reject extremely large pages (>5MB)

---

## API SECURITY

### Rate Limiting

| Endpoint Type | Limit | Window |
|---|---|---|
| Public (unauthenticated) | 30 requests | 1 minute |
| Auth endpoints | 5 attempts | 15 minutes |
| Free Snapshot | 1 request | 1 hour per IP |
| Authenticated general | 120 requests | 1 minute |
| AI query endpoints | 10 requests | 1 minute (also bounded by plan) |
| Admin endpoints | 30 requests | 1 minute |

### Security Headers (all responses)
```
Content-Security-Policy: default-src 'self'; ...
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(), microphone=(), camera=()
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

### CSRF Protection
- All state-changing requests require valid CSRF token
- CSRF token tied to session, rotated after use
- Double-submit cookie pattern for SPA endpoints

---

## SECRETS MANAGEMENT

### Rules
1. No secrets in code — ever
2. No secrets in version control — `.gitignore` must include all env files
3. All secrets in environment variables (Vercel environment, local `.env.local`)
4. Production secrets rotated on team member departure
5. API keys scoped to minimum required permissions

### Required Secrets
- `DATABASE_URL` — PostgreSQL connection string
- `JWT_PRIVATE_KEY` — RS256 signing key
- `JWT_PUBLIC_KEY` — RS256 verification key
- `SESSION_SECRET` — Session cookie signing
- `OPENAI_API_KEY` — Optional (AI provider)
- `ANTHROPIC_API_KEY` — Optional (AI provider)
- `GOOGLE_AI_API_KEY` — Optional (AI provider)
- `PERPLEXITY_API_KEY` — Optional (AI provider)
- `SMTP_*` — Email delivery credentials
- `STRIPE_SECRET_KEY` — Billing (when implemented)
- `STRIPE_WEBHOOK_SECRET` — Billing webhook verification

---

## AUDIT LOGGING

All privileged and sensitive actions are logged:

```
{
  "timestamp": "ISO8601",
  "actor_id": "user_uuid",
  "actor_role": "admin",
  "organization_id": "org_uuid",
  "action": "content.publish",
  "resource_type": "content_draft",
  "resource_id": "draft_uuid",
  "ip_address": "x.x.x.x",
  "user_agent": "...",
  "result": "success | failure",
  "details": {}
}
```

Logs are immutable (append-only). Logs are retained for minimum 90 days.

Actions that ALWAYS generate audit log:
- Authentication (login, logout, failed login)
- Role changes
- Billing changes
- Publishing content
- Autonomous agent actions
- API key creation/rotation/deletion
- Organization deletion
- Settings changes
- Data export

---

## AUTONOMOUS AGENT SECURITY

Agents (GEO Agent, SEO Agent, Growth Agent) operate under strict constraints:

1. Agents run as `system` role — never as a user
2. Every agent action is logged to audit trail
3. Agents cannot:
   - Change billing
   - Change security settings
   - Access other organizations
   - Send unapproved external communication
   - Publish without human approval (unless Level 3/4 explicitly enabled)
4. Agent prompt injection: treat AI responses as data, not as instructions
5. Tool use by agents is bounded: each tool has a permission list

---

## BILLING SECURITY

1. Never store raw card numbers — payment provider (Stripe) handles PCI
2. Webhook signatures verified before processing billing events
3. Billing state changes require `owner` role
4. Subscription upgrades/downgrades logged to audit trail
5. Failed payment handling: grace period → downgrade, never delete data

---

## DEPENDENCY SECURITY

- Lock file committed (`package-lock.json` or `pnpm-lock.yaml`)
- Automated dependency vulnerability scanning (Dependabot or equivalent)
- No dependencies without clear provenance
- Review all dependencies before adding
- Regular security audits

---

## KNOWN CURRENT SECURITY ISSUES

| Issue | Severity | Status |
|---|---|---|
| Apply form has no backend — data lost | HIGH | Mitigation: wire form before public promotion |
| No analytics — cannot detect attacks | MEDIUM | Fix in Phase 1 |
| No CSP headers on marketing site | MEDIUM | Add in Phase 1 |
| No rate limiting on marketing site | LOW | Add in Phase 1 |
| Canvas animations may be DoS vector (mobile) | LOW | Add reduced-motion guard |
