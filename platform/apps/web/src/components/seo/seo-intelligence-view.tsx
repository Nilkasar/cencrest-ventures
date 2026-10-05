"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { RefreshCw, UserRoundCog } from "lucide-react";
import { Button, EmptyState } from "@bebest/ui";
import { PageHeader } from "@/components/patterns/page-header";
import { PageStack, Reveal } from "@/components/patterns/motion";
import { SectionSkeleton } from "@/components/patterns/states";
import { useBrandProfile } from "@/hooks/use-brand-profile";
import { useCurrentOrg } from "@/lib/session-context";
import { TechnicalHealthSections, useSeoAnalysis } from "./technical-health-panel";
import { KeywordCoveragePanel } from "./keyword-coverage-panel";
import { OpportunitiesPanel } from "./opportunities-panel";

const TITLE = "SEO Intelligence";
const DESCRIPTION = "Where you stand in search: how well your pages are built, which keywords you cover, and the content worth creating next.";

/**
 * SEO Intelligence — "Where do I stand in search?"
 * (`docs/09-ux/CUSTOMER_JOURNEY.md`). Three independent blocks, each wired
 * straight to `data/seo/client.ts` (real `/brands/me/seo/*` routes):
 *
 *   1. Technical health — the hero: content score (with the findings
 *      behind it), page-score distribution, most-failed checks, pages
 *      worst-first with their checklist.
 *   2. Keyword coverage — groups and keywords, generated or manual.
 *   3. Content opportunities — server-ranked, scoring inputs one click away.
 *
 * Gated once on the brand profile existing (every block 404s the same way
 * without one) instead of three redundant empty states.
 */
export function SeoIntelligenceView() {
  const org = useCurrentOrg();
  const { profile, loading } = useBrandProfile(org?.id ?? "");
  const [opportunitiesRefreshKey, setOpportunitiesRefreshKey] = useState(0);
  const analysis = useSeoAnalysis();

  const bumpOpportunities = useCallback(() => setOpportunitiesRefreshKey((k) => k + 1), []);

  if (loading) {
    return (
      <>
        <PageHeader title={TITLE} description={DESCRIPTION} />
        <PageStack>
          <Reveal>
            <SectionSkeleton lines={5} titleWidth="w-36" />
          </Reveal>
          <Reveal>
            <SectionSkeleton lines={3} titleWidth="w-40" />
          </Reveal>
          <Reveal>
            <SectionSkeleton lines={4} titleWidth="w-44" />
          </Reveal>
        </PageStack>
      </>
    );
  }

  if (!profile || profile.status === "not_started") {
    return (
      <>
        <PageHeader title={TITLE} description={DESCRIPTION} />
        <EmptyState
          icon={<UserRoundCog size={20} />}
          title="Complete your brand profile first"
          description="SEO Intelligence scores your brand's crawled pages and generates keywords from its categories and use cases. Set those up in onboarding — it takes a few minutes."
          action={
            <Button variant="primary" size="sm" asChild>
              <Link href="/onboarding">Complete brand profile</Link>
            </Button>
          }
        />
      </>
    );
  }

  const canRerun = analysis.state.status === "ready" || analysis.state.status === "error";

  return (
    <>
      <PageHeader
        title={TITLE}
        description={DESCRIPTION}
        actions={
          canRerun ? (
            <Button variant="outline" size="sm" loading={analysis.running} onClick={() => void analysis.run()}>
              <RefreshCw size={13} aria-hidden="true" /> Re-run analysis
            </Button>
          ) : undefined
        }
      />
      <PageStack>
        <TechnicalHealthSections state={analysis.state} running={analysis.running} onRun={() => void analysis.run()} />
        <KeywordCoveragePanel onGenerated={bumpOpportunities} />
        <OpportunitiesPanel refreshKey={opportunitiesRefreshKey} />
      </PageStack>
    </>
  );
}
