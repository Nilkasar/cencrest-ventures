# TECHNICAL DEBT — BeBest

**Version**: 1.0  
**Date**: 2026-08-11

Items are ordered by severity. Each item includes: what it is, why it matters, and when to fix it.

---

## SEVERITY: CRITICAL (Fix Before Production Traffic)

### TD-001: Apply Form Has No Backend
**What**: The apply form on index.html fires `alert()` on submit. No data is captured, stored, or emailed.  
**Why it matters**: Every lead who fills out the form is permanently lost.  
**Fix**: Wire form to email delivery (Resend) + CRM/Airtable. This is 2-4 hours of work.  
**When**: Immediately — before any paid promotion or active outreach.

### TD-002: No Error Tracking
**What**: There is no error tracking on the marketing site or in any backend code.  
**Why it matters**: JavaScript errors in hero-film.js, interactions.js, etc. silently fail. When users report issues, there is no data.  
**Fix**: Add Sentry or equivalent.  
**When**: Phase 1.

### TD-003: No Analytics
**What**: No page view tracking, no event tracking, no conversion tracking.  
**Why it matters**: Cannot measure which pages convert, which CTAs work, which traffic sources matter.  
**Fix**: Add Vercel Analytics (built-in, free) + Plausible or PostHog for event tracking.  
**When**: Phase 1 (Vercel Analytics can be enabled today at zero cost).

---

## SEVERITY: HIGH (Fix in Phase 1)

### TD-004: Duplicated HTML Across 14 Pages
**What**: All 14 HTML pages share identical navigation, header, and footer markup — manually duplicated. Any change requires editing 14 files.  
**Why it matters**: Maintenance overhead scales linearly with page count. Design inconsistencies creep in.  
**Fix options**: (a) Keep static HTML, use a build script to inject shared components; (b) Adopt a framework (Next.js, Astro) when building the customer portal.  
**When**: Phase 1 or when first implementing a sitewide design change.

### TD-005: Forms Have No Server-Side Validation
**What**: Contact form and apply form rely entirely on browser-native validation (`required` attribute). When a backend is added, there is no server-side validation layer.  
**Why it matters**: API endpoints that accept form submissions must validate on the server. Browser validation is trivially bypassed.  
**Fix**: Implement server-side validation with clear error responses when wiring the form backend.  
**When**: Phase 1 (form backend).

### TD-006: No CSP, No Security Headers on Marketing Site
**What**: The Vercel-deployed marketing site has no Content-Security-Policy or other security headers.  
**Why it matters**: XSS vulnerabilities in third-party scripts (analytics, fonts) could affect site visitors.  
**Fix**: Add CSP and other security headers via Vercel configuration.  
**When**: Phase 1.

### TD-007: No Reduced-Motion Support for Canvas Animations
**What**: hero-film.js, clouds.js, and source-field.js run complex continuous animations regardless of user preference.  
**Why it matters**: Users with vestibular disorders or motion sensitivity may experience nausea. `prefers-reduced-motion` is a standard accessibility requirement.  
**Fix**: Check `window.matchMedia('(prefers-reduced-motion: reduce)')` in each animation controller and disable or reduce motion accordingly.  
**When**: Phase 1 (accessibility baseline).

### TD-008: Canvas Content Is Not Accessible
**What**: The hero film canvas, source field canvas, and clouds canvas render visually important content that is invisible to screen readers.  
**Why it matters**: WCAG 2.1 requires non-text content to have text alternatives.  
**Fix**: Add `aria-hidden="true"` to all canvases + add text alternatives describing what each animation communicates.  
**When**: Phase 1.

---

## SEVERITY: MEDIUM (Fix by Phase 3)

### TD-009: Hardcoded Demo Data in Visualizations
**What**: The signals section (competitor bars), source field (340 hardcoded nodes), and hero card (3%, 68% values) use hardcoded fictional data.  
**Why it matters**: Makes the site feel less credible to technical buyers who understand that "Northwind" and "Delta Rail" are invented.  
**Fix**: Replace with real anonymized customer data once first customers exist. Alternatively, label clearly as "SAMPLE INDUSTRY DATA."  
**When**: Before first paid customer lands on the site.

### TD-010: Chorus Section Shows Static Content
**What**: The chorus section (AI model responses) uses a typewriter animation on pre-written static text. It is not fetching real AI responses.  
**Why it matters**: This is the most critical demo moment on the homepage — it should reflect real data to be credible.  
**Fix**: Either (a) replace with real responses curated from actual runs, or (b) implement live demo queries (complex, adds latency).  
**When**: Phase 3 (AI Visibility MVP) — use real responses from BeBest's own product dogfooding.

### TD-011: Monolithic style.css (65KB)
**What**: All styles are in a single 65KB CSS file loaded on every page, including styles for sections not on that page.  
**Why it matters**: Minor performance issue now; maintenance problem as site grows.  
**Fix**: When adopting a framework (Next.js, Astro), use CSS modules or component scoping. Not worth refactoring the static site manually.  
**When**: When adopting frontend framework for customer portal.

### TD-012: No Image Optimization
**What**: band.png (810KB) is loaded eagerly on every page visit.  
**Why it matters**: Large image impacts LCP (Core Web Vitals) and mobile load time.  
**Fix**: Convert to WebP/AVIF, use `<img loading="lazy">` where appropriate, use Next.js Image optimization when adopting framework.  
**When**: Phase 4 (before SEO optimization makes sense).

### TD-013: hero-film.js Not Loaded in index.html
**What**: According to the audit, `hero-film.js` is NOT referenced in the current `index.html` (but `clouds.js`, `source-field.js`, and `interactions.js` are). `interactions.js` references `window.HeroFilm` — if the script isn't loaded, this silently fails.  
**Why it matters**: The 8-act cinematic scroll experience may not be running.  
**Fix**: Verify and reconcile. If hero-film is intended, load it. If not, remove the reference in interactions.js.  
**When**: Immediately (verify in browser that the experience works as intended).

### TD-014: RAF Loops May Not Clean Up Properly
**What**: hero-film.js, clouds.js, source-field.js use `requestAnimationFrame` loops. Cleanup on navigation or page hide may not be comprehensive.  
**Why it matters**: Memory leaks on single-page-app navigation (if framework is adopted). Unnecessary CPU usage on background tabs.  
**Fix**: Verify IntersectionObserver and visibilitychange handlers properly cancel RAF loops. Add `cancelAnimationFrame` in cleanup paths.  
**When**: When adopting frontend framework.

---

## SEVERITY: LOW (Deferred)

### TD-015: design-bible.html Not Linked from Navigation
**What**: The design system documentation page exists but is not accessible from the main nav.  
**Why it matters**: Minor — it's an internal document.  
**Fix**: Either link from a "Design" section for public transparency, or move to /docs/ directory.  
**When**: Whenever convenient.

### TD-016: session.md Is Nearly Empty
**What**: session.md was created as a session log but contains minimal content.  
**Why it matters**: Minor — documentation gap.  
**Fix**: Either populate with session notes or remove.  
**When**: When documentation is next reviewed.

### TD-017: .gitignore Only Has .vercel
**What**: The gitignore file only excludes `.vercel`. No node_modules, .env, .DS_Store, etc.  
**Why it matters**: Currently fine since there is no Node.js backend. Will cause issues in Phase 1.  
**Fix**: Expand .gitignore when adding backend code.  
**When**: Phase 1.

---

## DEBT SUMMARY

| Severity | Count | Fix Phase |
|---|---|---|
| Critical | 3 | Immediately / Phase 1 |
| High | 5 | Phase 1 |
| Medium | 6 | Phase 1–4 |
| Low | 3 | Deferred |
| **Total** | **17** | |
