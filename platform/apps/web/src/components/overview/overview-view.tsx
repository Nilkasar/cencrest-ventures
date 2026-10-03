"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Button, Card, CardContent, Skeleton } from "@bebest/ui";
import { useBrandProfile } from "@/hooks/use-brand-profile";
import { useCurrentOrg, useSession } from "@/lib/session-context";
import { useAsyncData } from "@/lib/use-async-data";
import { listAiRuns } from "@/data/ai-visibility/client";
import { getActionsOverview } from "@/data/actions/client";
import { listBrandMeasurements } from "@/data/measurement/client";
import { listOpportunities } from "@/data/opportunities/client";
import type { OpportunityStatus } from "@/data/opportunities/types";
import { listRecommendations } from "@/data/recommendations/client";
import { CompetitiveField } from "./competitive-field";
import { CrmPipeline } from "./crm-pipeline";
import { GrowthLoop } from "./growth-loop";
import { KpiStrip } from "./kpi-strip";
import { NextActionTile } from "./next-action-tile";
import { OpportunityMap } from "./opportunity-map";
import { staggerVariants, usePolledData } from "./primitives";
import { PulseFeed } from "./pulse-feed";
import { SeoHealthTile } from "./seo-health-tile";
import { SignalDeck } from "./signal-deck";
import { TrafficPanel } from "./traffic-panel";
import { VisibilityTrend } from "./visibility-trend";

/**
 * `docs/09-ux/CUSTOMER_JOURNEY.md`'s Overview Dashboard — "How am I doing?"
 * — rebuilt as a one-glance command center over the whole workspace. Every
 * number is read from an existing, org-scoped API route; nothing here is
 * fixture, sample or interpolated data. Reading order, top to bottom:
 *
 *   1. SignalDeck       AI Visibility Score, per-model signal, score anatomy
 *   2. KpiStrip         share of voice · open opportunities · approvals · lift
 *   3. VisibilityTrend  score history   |  CompetitiveField  your rank
 *   4. GrowthLoop       opportunities -> recommendations -> actions -> measured
 *   5. OpportunityMap   impact vs effort |  NextAction + PulseFeed
 *   6. TrafficPanel     GSC / GA4        |  SeoHealthTile    crawl issues + score
 *   7. CrmPipeline      internal ops workspace only (renders nothing elsewhere)
 *
 * Fetches shared by more than one widget are lifted here so each endpoint
 * is called once per visit (AI runs, opportunity/recommendation status
 * totals, the actions overview, measurements); single-consumer fetches live
 * in their widget. Every widget owns its own loading/error/empty state, so
 * one failing endpoint degrades one panel, never the page.
 *
 * Onboarding gate unchanged: a brand-new org sees ONE "set up your brand"
 * state instead of a dozen panels all asking for the same thing.
 */

const STATUSES: OpportunityStatus[] = ["new", "in_progress", "completed", "dismissed"];

async function countByStatus(fetchTotal: (status: OpportunityStatus) => Promise<number>): Promise<Record<OpportunityStatus, number>> {
  const totals = await Promise.all(STATUSES.map(fetchTotal));
  return Object.fromEntries(STATUSES.map((s, i) => [s, totals[i]!])) as Record<OpportunityStatus, number>;
}

export function OverviewView() {
  const { loading: sessionLoading } = useSession();
  const org = useCurrentOrg();
  const { profile, loading } = useBrandProfile(org?.id ?? "");

  if (sessionLoading || loading) return <OverviewSkeleton />;

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

  return <CommandCenter onboardingInProgress={profile.status === "in_progress"} />;
}

function CommandCenter({ onboardingInProgress }: { onboardingInProgress: boolean }) {
  // Polls every 8s only while the newest brand run is still queued/running,
  // so the hero dial, progress ring and trend update themselves the moment
  // a baseline lands — and goes quiet as soon as it has.
  const runs = usePolledData(
    () => listAiRuns(),
    [],
    (data) => {
      const latest = data.find((r) => r.competitorId === null);
      return latest && (latest.status === "queued" || latest.status === "running") ? 8000 : null;
    },
  );
  const oppCounts = useAsyncData(() => countByStatus(async (status) => (await listOpportunities({ status, limit: 1 })).pagination.total), []);
  const recCounts = useAsyncData(() => countByStatus(async (status) => (await listRecommendations({ status, limit: 1 })).pagination.total), []);
  const actions = useAsyncData(() => getActionsOverview(), []);
  const measurements = useAsyncData(() => listBrandMeasurements({ limit: 20 }), []);

  return (
    <motion.div className="@container flex flex-col gap-5" variants={staggerVariants} initial="hidden" animate="show">
      {onboardingInProgress && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3">
          <p className="text-[12.5px] text-muted-foreground">
            Brand onboarding is still in progress &mdash; finish it to unlock your first baseline run.
          </p>
          <Button asChild variant="outline" size="sm">
            <Link href="/onboarding">Resume onboarding</Link>
          </Button>
        </div>
      )}

      <SignalDeck runs={runs} />

      <KpiStrip oppCounts={oppCounts} actions={actions} measurements={measurements} />

      <div className="grid grid-cols-1 @4xl:grid-cols-12 gap-5">
        <VisibilityTrend runs={runs} className="@4xl:col-span-7" />
        <CompetitiveField className="@4xl:col-span-5" />
      </div>

      <GrowthLoop oppCounts={oppCounts} recCounts={recCounts} actions={actions} measurements={measurements} />

      <div className="grid grid-cols-1 @4xl:grid-cols-12 gap-5 items-start">
        <OpportunityMap className="@4xl:col-span-7 h-full" />
        <div className="@4xl:col-span-5 flex flex-col gap-5 min-w-0">
          <NextActionTile actions={actions} />
          <PulseFeed />
        </div>
      </div>

      <div className="grid grid-cols-1 @4xl:grid-cols-12 gap-5">
        <TrafficPanel className="@4xl:col-span-7" />
        <SeoHealthTile measurements={measurements} className="@4xl:col-span-5" />
      </div>

      <CrmPipeline />
    </motion.div>
  );
}

function OverviewSkeleton() {
  return (
    <div className="flex flex-col gap-5" aria-busy="true">
      <span className="sr-only">Loading your overview…</span>
      <Skeleton className="h-[420px] w-full rounded-xl" />
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[156px] rounded-xl" />
        ))}
      </div>
    </div>
  );
}
