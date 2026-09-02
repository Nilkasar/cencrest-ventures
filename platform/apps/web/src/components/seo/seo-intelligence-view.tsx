"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { Card, CardContent, Skeleton, Button } from "@bebest/ui";
import { useBrandProfile } from "@/hooks/use-brand-profile";
import { currentOrganization } from "@/data/fixtures";
import { TechnicalHealthPanel } from "./technical-health-panel";
import { KeywordCoveragePanel } from "./keyword-coverage-panel";
import { OpportunitiesPanel } from "./opportunities-panel";

/**
 * Top-level orchestrator for the SEO Intelligence screen ("Where do I stand
 * in search?" — `docs/09-ux/CUSTOMER_JOURNEY.md`). Three independent
 * sections, each wired straight to `data/seo/client.ts` (real
 * `/brands/me/seo/*` routes, no fixture layer):
 *
 *   1. Technical health — score + drill-down to page-level issues.
 *   2. Keyword coverage — keyword_groups/keywords, generated or manual.
 *   3. Opportunities — server-sorted by score, evidence one click away.
 *
 * Gated on the brand profile existing at all (same check
 * `components/website/website-intelligence-view.tsx` implicitly relies on
 * via `useBrandProfile`) — every section below 404s the same documented way
 * without a brand, so this avoids showing three redundant "complete your
 * brand profile" empty states at once.
 */
export function SeoIntelligenceView() {
  const { profile, loading } = useBrandProfile(currentOrganization.id);
  const [opportunitiesRefreshKey, setOpportunitiesRefreshKey] = useState(0);

  const bumpOpportunities = useCallback(() => setOpportunitiesRefreshKey((k) => k + 1), []);

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-32 w-full rounded-xl" />
      </div>
    );
  }

  if (!profile || profile.status === "not_started") {
    return (
      <Card>
        <CardContent className="p-10 flex flex-col items-center text-center gap-3">
          <p className="font-display text-[17px] font-semibold text-foreground">Complete your brand profile first</p>
          <p className="text-[13.5px] text-muted-foreground max-w-[440px]">
            SEO Intelligence scores your brand&rsquo;s crawled pages and generates keywords from its categories and
            use cases — set those up in onboarding first.
          </p>
          <Button variant="primary" size="sm" asChild>
            <Link href="/onboarding">Complete brand profile</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <TechnicalHealthPanel />
      <KeywordCoveragePanel onGenerated={bumpOpportunities} />
      <OpportunitiesPanel refreshKey={opportunitiesRefreshKey} />
    </div>
  );
}
