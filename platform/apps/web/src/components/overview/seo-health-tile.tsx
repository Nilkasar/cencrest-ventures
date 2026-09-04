import { Search } from "lucide-react";
import { StatTile } from "./stat-tile";

/**
 * "How am I doing?" tile #2 — SEO Health Score. Deliberately NOT wired to a
 * fetch: `apps/api/src/routes/seo.ts` has no `GET` for `seo_analyses` at
 * all — only `POST /brands/me/seo/analyze`, which always computes a fresh
 * score and returns it inline, once, with nothing persisted for a later
 * read (confirmed against the real route file, not assumed). That's the
 * exact gap `technical-health-panel.tsx`'s own doc comment already names:
 * "there is no GET history route for seo_analyses... a page reload goes
 * back to idle until analyze is run again. That is a real gap in the
 * backend's literal API surface, not a frontend shortcut."
 *
 * This tile does not paper over that by silently POSTing `/analyze` on
 * every Overview page load (a mutating, non-idempotent call with real cost
 * — re-scores every crawled page and writes fresh rows — is never an
 * acceptable side effect of just looking at a dashboard), and it does not
 * fabricate a number from stale client state either. It tells the truth:
 * there is nothing to show here yet, and sends the user to the one place
 * that can produce a fresh number, honoring the same "explain why it's
 * empty, say what to do, make it one click away" rule every other empty
 * state in this app follows.
 *
 * Once Epic 4's backend grows a persisted brand-level read route, this tile
 * is a straight swap to a `useAsyncData` fetch exactly like
 * `AiVisibilityTile`'s — no reshaping of the surrounding grid needed.
 */
export function SeoHealthTile() {
  return (
    <StatTile href="/seo-intelligence" eyebrow="SEO Health" icon={<Search size={13} />}>
      <p className="font-mono text-[22px] font-semibold text-muted-foreground leading-none">—</p>
      <p className="text-[12px] text-muted-foreground mt-2 leading-relaxed">
        Run (or re-run) your Page Analysis Checklist in SEO Intelligence to see this score.
      </p>
    </StatTile>
  );
}
