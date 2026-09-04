"use client";

import Link from "next/link";
import { Button, Card, CardContent } from "@bebest/ui";
import { useBrandProfile } from "@/hooks/use-brand-profile";
import { currentOrganization } from "@/data/fixtures";
import { AiVisibilityTile } from "./ai-visibility-tile";
import { SeoHealthTile } from "./seo-health-tile";
import { OpportunitiesTile } from "./opportunities-tile";
import { NextActionTile } from "./next-action-tile";
import { StatTileSkeleton } from "./stat-tile";

/**
 * `docs/09-ux/CUSTOMER_JOURNEY.md`'s Overview Dashboard — "How am I doing?"
 * — the first "Workspace" destination and the app's de facto landing
 * screen. A pure aggregation of four already-built, already-VERIFIED
 * epics' own real data, exactly the four the journey doc's own "Overview
 * Dashboard" bullet list names:
 *
 *   - AI Visibility Score (with trend)  -> `AiVisibilityTile`  (Epic 7)
 *   - SEO Health Score (with trend)     -> `SeoHealthTile`     (Epic 4)
 *   - Active opportunities count        -> `OpportunitiesTile` (Epic 9)
 *   - Next recommended action           -> `NextActionTile`    (Epics 10/13)
 *
 * No new backend concept, no fixture layer: every tile calls straight
 * through to its epic's own real `data/*\/client.ts` (see each tile's own
 * doc comment for exactly which function). This view owns only the ONE
 * decision none of those four screens has to make on their own: whether
 * the organization has even completed brand onboarding at all — same
 * `useBrandProfile` gate `seo-intelligence-view.tsx` already establishes,
 * reused verbatim rather than re-implemented, so a genuinely brand-new org
 * sees ONE clear "set up your brand" empty state instead of four
 * independently-broken-looking tiles all asking for the same thing.
 *
 * Once onboarding is complete, the four tiles render unconditionally —
 * deliberately NOT gated behind "has a baseline run finished yet," because
 * that single boolean would hide real, legitimate partial progress (e.g. a
 * brand that's run AI Visibility but not SEO yet, or vice versa). Each tile
 * instead owns its own honest loading/error/empty sub-state, matching the
 * per-section pattern `SeoIntelligenceView`'s own three independent panels
 * already use.
 */
export function OverviewView() {
  const { profile, loading } = useBrandProfile(currentOrganization.id);

  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <StatTileSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (!profile || profile.status === "not_started") {
    return (
      <Card>
        <CardContent className="p-10 flex flex-col items-center text-center gap-3">
          <p className="font-display text-[17px] font-semibold text-foreground">Set up your brand to get started</p>
          <p className="text-[13.5px] text-muted-foreground max-w-[440px]">
            Your Overview fills in once onboarding is done: confirm your brand, add competitors, then run your AI
            Visibility baseline (about 20&ndash;60 minutes, most of it in the background &mdash; you can leave and
            come back).
          </p>
          <Button variant="primary" size="sm" asChild>
            <Link href="/onboarding">Start onboarding</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {profile.status === "in_progress" && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3">
          <p className="text-[12.5px] text-muted-foreground">
            Brand onboarding is still in progress &mdash; finish it to unlock your first baseline run.
          </p>
          <Button asChild variant="outline" size="sm">
            <Link href="/onboarding">Resume onboarding</Link>
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <AiVisibilityTile />
        <SeoHealthTile />
        <OpportunitiesTile />
        <NextActionTile />
      </div>
    </div>
  );
}
