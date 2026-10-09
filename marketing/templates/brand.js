// brand.js — the ONLY file edited to point every template at BeBest.
//
// SOURCING RULE (MARKETING-STUDIO.md §0 and this repo's own rule): every string and
// number below must trace to something true. Sources are cited inline. Nothing here
// is estimated, rounded up, or illustrative-pretending-to-be-measured — the same rule
// that governs `SnapshotSamplePreview` in the product (platform/apps/web).
//
// NOT YET TRUE OF THIS FILE: `window.HERO` and the per-feature `target` coordinates
// need real captured screens (marketing/shots/*_screen.png). See BEBEST-MARKETING.md
// §"Screens" — the dashboard screens need a live database, which is still blocked.
window.BRAND = {
  name: 'BeBest',
  url: 'BEBESTWITHAI.COM',
  logo: '../../assets/logo-mark-light.png',    // the repo's own light mark (for dark poster grounds)
  status: 'Free AI Visibility Snapshot — bebestwithai.com',   // true: the Snapshot is live and free (pricing.html)

  // Palette: the live site's tokens, verbatim from style.css :root.
  ink: '#0A0E18',        // --ink
  cream: '#F2EEE6',      // --paper
  dark: '#06080F',       // --pitch
  grad: ['#D9B87C', '#C2A067', '#C2410C'],     // --ember → --ember-2 → --ember-r (rust)
  accent: '#D9B87C',     // --ember ("marks machine speech")
  warn: '#C0705C',       // --danger
  gold: '#D9B87C',       // --ember

  // Fonts: style.css --fd / --fs. The Google Fonts <link> in each template must match.
  fontDisplay: 'Fraunces', fontUI: 'Inter',

  appHeader: 130,        // the BeBest top bar in the 780-wide /snapshot capture (65 CSS px @2x)
};

// One entry per feature. Every title/sub below describes something the shipped platform
// actually does (platform/apps/web/src/app/(app)/*); `screen` names the route to capture.
//  plan: '' | 'FREE' | 'PREMIUM' — only FREE is claimed, because it is the only tier
//  whose contents pricing.html publishes. The Audit/Monitoring tiers are "priced on
//  request", so no feature is labelled PREMIUM until that page says which tier owns it.
//
// ONLY `snapshot` HAS A REAL SCREEN TODAY (marketing/shots/snapshot_screen.png, captured
// from the running app at 390 CSS px @2x). The four below it are written and ready but
// their screens are blocked: every dashboard route renders loading skeletons without a
// live database. Capture them, then uncomment — do not ship a poster built on a skeleton.
window.FEATURES = [
  { key: 'snapshot', screen: 'snapshot', sy: 130, target: [150, 760], bg: '#0A0E18', ink: '#F2EEE6', acc: '#D9B87C', plan: 'FREE',
    title: 'Ask four AI models<br>who they recommend.',
    sub: 'A real, computed sample across ChatGPT, Claude, Gemini and Perplexity — free, no card.',
    note: 'no card,<br>no mock-ups' },

  /* BLOCKED ON A LIVE DATABASE — see BEBEST-MARKETING.md §Screens
  { key: 'overview', screen: 'overview', sy: 96, target: [220, 360], bg: '#0A0E18', ink: '#F2EEE6', acc: '#D9B87C', plan: '',
    title: 'Your AI Visibility<br>Score, one number.',
    sub: 'How often ChatGPT, Claude, Gemini and Perplexity name you in category buying questions.',
    note: 'four models,<br>one score' },

  { key: 'ai-visibility', screen: 'ai-visibility', sy: 96, target: [220, 360], bg: '#131829', ink: '#F2EEE6', acc: '#D9B87C', plan: 'FREE',
    title: 'Per model,<br>not an average.',
    sub: 'The score broken out by model, so you can see which assistant is skipping you.',
    note: 'ChatGPT · Claude<br>Gemini · Perplexity' },

  { key: 'competitors', screen: 'competitors', sy: 96, target: [220, 360], bg: '#0A0E18', ink: '#F2EEE6', acc: '#D9B87C', plan: 'FREE',
    title: 'Who AI recommends<br>instead of you.',
    sub: 'The brands winning the answers in your category, and how far ahead of you they are.',
    note: 'the gap,<br>measured' },

  { key: 'opportunities', screen: 'opportunities', sy: 96, target: [220, 360], bg: '#131829', ink: '#F2EEE6', acc: '#C2410C', plan: '',
    title: 'What to fix first.',
    sub: 'Prioritised moves drawn from what the run actually found — not a generic checklist.',
    note: 'evidence first,<br>then advice' },
  */
];

// Giant-number + face-off posters.
//
// LEFT DELIBERATELY UNFILLED. The kit's rule is that these numbers come from the
// product's own code; this repo's rule is that invented numbers are never shown as
// measurement. BeBest has no clients yet, so there is no measured score, no average
// uplift and no case-study figure to put here. Two honest options, both needing a
// decision from the owner before any poster ships:
//   (a) the AUDIT SCOPE arithmetic — 1,400+ prompts × 4 models ≈ 5,600 AI calls per
//       audit (pricing.html states the prompt count and the model count);
//   (b) the QUERY-REUSE MEASUREMENT in VERTICAL_STRATEGY.md — 82% / 53% / 24% / 0%,
//       produced by running the real query generator and counting identical strings.
// (b) is the only *measured* number BeBest currently owns. Pick one, then fill this in.
window.HERO = null;

// Carousel B (surprise) + end cards. The offer is the real one from pricing.html.
window.LAUNCH = {
  offer: 'The AI Visibility Snapshot is free.',
  offerFine: 'No card. Delivered in 24 hours (pricing.html). The Snapshot samples 20–50 '
    + 'queries per model across 4 models (docs/09-ux/CUSTOMER_JOURNEY.md); the full '
    + '1,400+ prompt run is the paid Audit.',
  hint1: { emoji: '🔎', title: 'A category buying question', badge: 'asked to 4 models',
    amount: 'you: not named', line: 'We ask the questions your buyers ask.' },
  hint2: { label: 'AI VISIBILITY SCORE', value: '— / 100', extra: 'your own measured number',
    line: 'Then we show you who got named instead.' },
};
