# TESTING STRATEGY — BeBest

**Version**: 1.0  
**Date**: 2026-08-11

---

## PRINCIPLES

1. **Every epic has explicit acceptance criteria before implementation begins**
2. **No epic is COMPLETE without tests passing**
3. **Tenant isolation is always tested** — this is a non-negotiable quality gate
4. **AI extraction quality is measured, not assumed**
5. **Security tests are part of the test suite, not an afterthought**
6. **Billing logic is tested with known edge cases**

---

## TEST TYPES

### Unit Tests
- Individual functions and formulas
- Scoring formula calculations with known inputs/outputs
- Input validation logic
- Domain logic (brand intelligence, query generation)

### Integration Tests
- API endpoint behavior end-to-end (with real database)
- AI provider abstraction (using Ollama locally)
- Job queue processing
- Billing webhook handling
- Email delivery

### Tenant Isolation Tests (CRITICAL)
For every tenant-isolated resource, test:
1. User in Org A cannot read Org B's data
2. User in Org A cannot write to Org B's data
3. User in Org A cannot delete Org B's data
4. Background job for Org A cannot access Org B's data

This test category is a **hard quality gate** — no epic is COMPLETE without it passing for all new entities.

### Security Tests
- SQL injection prevention
- XSS prevention
- SSRF prevention (test with private IP ranges, localhost, metadata endpoints)
- Rate limiting enforcement
- CSRF protection
- Authentication bypass attempts
- Authorization: role-based access enforcement
- Prompt injection: malicious content in crawled pages
- Webhook signature verification

### Performance Tests
- API endpoint response time (P50, P95, P99)
- AI query runner throughput
- Website crawler rate limiting
- Database query time for large datasets
- Report generation time

### Accessibility Tests
- WCAG 2.1 AA compliance on all UI
- Screen reader compatibility
- Keyboard navigation
- Color contrast ratios
- Reduced motion support

### AI Evaluation Tests
See `/docs/12-ai/AI_ARCHITECTURE.md` for evaluation dataset specifications.

- Brand mention detection: precision, recall, F1
- Competitor detection: precision, recall, F1
- Sentiment classification: accuracy
- Citation extraction: precision, recall
- Recommendation detection: precision, recall

**Baseline accuracy targets** (to be confirmed once eval datasets are built):
- Brand mention detection: F1 > 0.90
- Competitor detection: F1 > 0.88
- Sentiment classification: accuracy > 0.82

### Billing Tests
- Subscription creation, upgrade, downgrade, cancellation
- Failed payment → grace period → downgrade flow
- Usage limit enforcement
- Entitlement enforcement per plan
- Webhook signature verification
- Customer data preservation on cancellation

### Agent Evaluation
- GEO Agent produces correct scores on test brand (compared to manual)
- SEO Agent identifies known technical issues on test site
- Content Agent draft passes quality checks on test brief
- Agent does NOT follow injected instructions in crawled content

---

## TEST ENVIRONMENTS

| Environment | Purpose | Database | AI Provider |
|---|---|---|---|
| Local | Developer testing | Local PostgreSQL | Ollama |
| CI | Automated tests | Ephemeral PostgreSQL | Ollama (or mocked) |
| Staging | Integration + E2E | Staging PostgreSQL | Real providers (test keys) |
| Production | — | Production PostgreSQL | Real providers |

---

## TEST DATA STRATEGY

- Use **test fixtures** for unit tests (deterministic, fast)
- Use **factory functions** for integration tests (generate realistic test data)
- Never use **production data** in tests
- Use **Ollama** for AI calls in tests (no cloud cost, deterministic enough for most tests)
- Maintain **labeled evaluation datasets** for AI accuracy measurement

---

## QUALITY GATE: DEFINITION OF DONE

An epic is COMPLETE when ALL of the following are true:

```
Code:
  [ ] All acceptance criteria are verifiably met
  [ ] Code reviewed by at least one other person (or self-reviewed if solo)
  [ ] No critical or high-severity linting errors
  
Tests:
  [ ] Unit tests written for all business logic
  [ ] Integration tests written for all API endpoints
  [ ] Tenant isolation tests pass for all new entities
  [ ] Security tests pass for all new endpoints
  [ ] No failing tests in CI

Security:
  [ ] SSRF protection verified (if URL input exists)
  [ ] Authentication checked on all new endpoints
  [ ] Authorization checked with correct roles
  [ ] Input validation present on all inputs

Documentation:
  [ ] API endpoints documented
  [ ] Database schema changes documented
  [ ] New configuration variables documented
  [ ] DECISIONS.md updated if architectural decisions were made
  [ ] TECHNICAL_DEBT.md updated if new debt was created

Operations:
  [ ] Error tracking configured for new failure modes
  [ ] Logging in place for critical paths
  [ ] Background job failures are observable
  
Project:
  [ ] Epic marked COMPLETE in PROJECT_STATUS.md
  [ ] Known limitations documented
  [ ] Next epic dependencies confirmed
```

---

## REGRESSION TESTING

Before every release, run the full regression suite:
- All unit tests
- All integration tests
- All tenant isolation tests
- All security tests
- Smoke test on staging environment
- Manual walkthrough of customer critical path

**Customer critical path** (Phase 5+):
1. Visit marketing site
2. Submit free snapshot request
3. Receive snapshot report (email + web)
4. Sign up for paid plan
5. Complete onboarding
6. View AI Visibility Score
7. View opportunities
8. Approve a recommendation
9. View results after re-measurement

---

## AI EVALUATION CADENCE

| When | Action |
|---|---|
| Before every prompt version change | Run full AI eval suite, compare to previous version |
| After every model update (provider) | Run full AI eval suite, flag regressions |
| Monthly | Run full AI eval suite, trend over time |
| Before any epic that modifies extraction | Run eval suite |

Regressions of > 5 points in any eval metric block deployment.
