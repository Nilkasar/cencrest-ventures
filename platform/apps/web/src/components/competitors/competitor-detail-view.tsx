"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ExternalLink, Pencil, Play, Radar, RefreshCw, Trash2, Users } from "lucide-react";
import { Button, EmptyState, useToast } from "@bebest/ui";
import { DetailHeader } from "@/components/patterns/page-header";
import { PageStack, Reveal } from "@/components/patterns/motion";
import { DetailSkeleton } from "@/components/patterns/states";
import { ErrorPanel } from "@/components/patterns/error-panel";
import { AiRunDetail } from "@/components/ai-visibility/ai-run-detail";
import { AiRunProgressPanel } from "@/components/ai-visibility/ai-run-progress-panel";
import { AiRunFailedPanel } from "@/components/ai-visibility/ai-run-failed-panel";
import { AiRunHistoryTable, ScoreTrendPanel, completedSeries } from "@/components/ai-visibility/ai-run-history";
import { RunStatusBadge } from "@/components/ai-visibility/status-badges";
import { ScoreHeroSkeleton, type PreviousScore } from "@/components/ai-visibility/score-panel";
import { CompetitorDialog, type CompetitorFormValues } from "@/components/onboarding/competitor-dialog";
import { useBrandProfile } from "@/hooks/use-brand-profile";
import { useCompetitorAiRun } from "@/hooks/use-competitor-ai-run";
import { useAsyncData } from "@/lib/use-async-data";
import { useCurrentOrg } from "@/lib/session-context";
import { EntitlementError, removeCompetitor, updateCompetitor } from "@/lib/onboarding-client";
import { getCompetitiveGaps, getCompetitorMovement, listCompetitorAiRuns } from "@/data/competitive-intelligence/client";
import { formatRelativeTime } from "@/lib/format";
import { CompetitiveGapPanel } from "./competitive-gap-panel";
import { CompetitorRunStartError } from "./competitor-run-start-error";
import { MovementValue } from "./movement-panel";
import { GapValue, PriorityBadge, displayDomain, initials } from "./status-badges";

/**
 * One competitor's evidence page — "how do they compare, and why?" The
 * same score → formula → raw-answer surface as AI Visibility, pointed at
 * this competitor's own runs, plus the head-to-head against you and their
 * run-over-run movement (fetched on open; there's no proactive alert feed
 * until the scheduled Competitor Agent ships).
 */
export function CompetitorDetailView({ competitorId }: { competitorId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const org = useCurrentOrg();
  const orgId = org?.id ?? "";
  const { profile, loading, error, reload, setProfile } = useBrandProfile(orgId);
  const { state, starting, startError, start, reload: reloadRun } = useCompetitorAiRun(competitorId);

  const [viewingRunId, setViewingRunId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>(undefined);
  const [dialogSubmitting, setDialogSubmitting] = useState(false);
  const [removing, setRemoving] = useState(false);

  const latestRun = state.status === "ready" ? state.run : null;
  const runKey = latestRun ? `${latestRun.id}:${latestRun.status}` : state.status;
  const history = useAsyncData(() => listCompetitorAiRuns(competitorId), [competitorId, runKey]);
  const movement = useAsyncData(() => getCompetitorMovement(competitorId), [competitorId, runKey]);
  const gapsState = useAsyncData(() => getCompetitiveGaps(), [runKey]);

  const competitor = profile?.competitors.find((c) => c.id === competitorId);

  if (!org || loading) return <DetailSkeleton label="Loading competitor…" />;

  if (error) {
    return (
      <>
        <DetailHeader backHref="/competitors" backLabel="Competitors" title="Competitor" />
        <ErrorPanel title="Competitor didn't load" message={error} onRetry={reload} />
      </>
    );
  }

  if (!competitor) {
    return (
      <EmptyState
        icon={<Users size={20} />}
        title="Competitor not found"
        description="It may have been removed from tracking. Its past runs aren't shown once it's no longer tracked."
        action={
          <Button asChild variant="primary">
            <Link href="/competitors">
              <ArrowLeft size={14} aria-hidden="true" /> Back to competitors
            </Link>
          </Button>
        }
      />
    );
  }

  const runs = history.status === "success" ? history.data : [];
  const inFlight = latestRun !== null && (latestRun.status === "queued" || latestRun.status === "running");
  const effectiveRunId = viewingRunId ?? latestRun?.id ?? null;
  const viewingLatest = effectiveRunId === latestRun?.id;
  const displayedRun = viewingLatest ? latestRun : (runs.find((r) => r.id === effectiveRunId) ?? null);

  const series = completedSeries(runs);
  const displayedIndex = displayedRun ? series.findIndex((s) => s.run.id === displayedRun.id) : -1;
  const prev = displayedIndex > 0 ? series[displayedIndex - 1] : displayedIndex === -1 ? series[series.length - 1] : undefined;
  const previous: PreviousScore | null = prev && prev.run.id !== displayedRun?.id ? { score: prev.v, completedAt: prev.run.completedAt! } : null;

  const gaps = gapsState.status === "success" ? gapsState.data : null;
  const gapEntry = gaps?.competitors.find((c) => c.competitorId === competitorId) ?? null;

  async function handleStart() {
    setViewingRunId(null);
    await start();
  }

  async function handleEdit(values: CompetitorFormValues) {
    if (!competitor) return;
    setDialogSubmitting(true);
    setDialogError(undefined);
    try {
      setProfile(await updateCompetitor(orgId, competitor.id, values));
      setDialogOpen(false);
    } catch (err) {
      setDialogError(err instanceof EntitlementError ? err.message : err instanceof Error ? err.message : "Something went wrong — try again.");
    } finally {
      setDialogSubmitting(false);
    }
  }

  async function handleRemove() {
    if (!competitor) return;
    if (!window.confirm(`Stop tracking ${competitor.name}? Their past runs stay in your history.`)) return;
    setRemoving(true);
    try {
      await removeCompetitor(orgId, competitor.id);
      toast({ title: "Competitor removed", description: `${competitor.name} is no longer tracked.` });
      router.push("/competitors");
    } catch (err) {
      setRemoving(false);
      toast({
        title: "Couldn't remove competitor",
        description: err instanceof Error ? err.message : "Something went wrong — try again.",
        variant: "danger",
      });
    }
  }

  return (
    <>
      <DetailHeader
        backHref="/competitors"
        backLabel="Competitors"
        leading={
          <span className="flex size-12 items-center justify-center rounded-full bg-surface font-mono text-[14px] font-medium text-muted-foreground" aria-hidden="true">
            {initials(competitor.name)}
          </span>
        }
        title={competitor.name}
        badges={
          <>
            <PriorityBadge priority={competitor.priority} size="md" />
            {latestRun && <RunStatusBadge status={latestRun.status} size="md" />}
          </>
        }
        subtitle={
          competitor.websiteUrl ? (
            <a
              href={competitor.websiteUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-sm hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {displayDomain(competitor.websiteUrl)}
              <ExternalLink size={12} aria-hidden="true" />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          ) : undefined
        }
        meta={[
          { label: "Score", value: latestRun?.aiVisibilityScore != null ? latestRun.aiVisibilityScore.toFixed(1) : "—" },
          { label: "vs. you", value: <GapValue gap={gapEntry?.competitiveGap ?? null} /> },
          { label: "Movement", value: <MovementValue state={movement} /> },
          {
            label: "Last run",
            value: latestRun ? (latestRun.completedAt ? formatRelativeTime(latestRun.completedAt) : "In progress") : "Never",
          },
        ]}
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={handleRemove} loading={removing}>
              <Trash2 size={14} aria-hidden="true" /> Stop tracking
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setDialogError(undefined);
                setDialogOpen(true);
              }}
            >
              <Pencil size={14} aria-hidden="true" /> Edit
            </Button>
            {latestRun && (
              <Button variant="primary" size="sm" loading={starting} disabled={inFlight} onClick={handleStart}>
                <RefreshCw size={14} aria-hidden="true" /> {inFlight ? "Running" : "Run again"}
              </Button>
            )}
          </>
        }
      />

      <PageStack>
        {startError !== null && (
          <Reveal>
            <CompetitorRunStartError error={startError} />
          </Reveal>
        )}

        {state.status === "loading" && (
          <Reveal>
            <ScoreHeroSkeleton />
          </Reveal>
        )}

        {state.status === "error" && (
          <Reveal>
            <ErrorPanel title="Runs didn't load" message={state.error.message} onRetry={reloadRun} />
          </Reveal>
        )}

        {state.status === "empty" && (
          <Reveal>
            <EmptyState
              icon={<Radar size={20} />}
              title={`${competitor.name} hasn't been measured yet`}
              description="A check asks AI assistants your active query set and reads every answer for this competitor — the same run you get, so the comparison is fair. It takes about 30–60 minutes in the background."
              action={
                <Button variant="primary" loading={starting} onClick={handleStart}>
                  <Play size={14} aria-hidden="true" /> Run first check
                </Button>
              }
            />
          </Reveal>
        )}

        {latestRun && inFlight && viewingLatest && <AiRunProgressPanel run={latestRun} subject={competitor.name} />}

        {latestRun && latestRun.status === "failed" && viewingLatest && (
          <Reveal>
            <AiRunFailedPanel run={latestRun} retrying={starting} onRetry={handleStart} />
          </Reveal>
        )}

        {!viewingLatest && displayedRun && (
          <Reveal>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface px-4 py-2.5" role="status">
              <p className="text-[12.5px] text-muted-foreground">Viewing an earlier run, not the latest.</p>
              <Button variant="ghost" size="sm" onClick={() => setViewingRunId(null)}>
                Back to latest
              </Button>
            </div>
          </Reveal>
        )}

        {displayedRun && <AiRunDetail key={displayedRun.id} run={displayedRun} previous={previous} subject={competitor.name} />}

        {latestRun && (
          <CompetitiveGapPanel competitors={[competitor]} state={gapsState} onRetry={gapsState.reload} lockedCompetitorId={competitor.id} />
        )}

        {runs.length > 0 && (
          <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-12">
            <ScoreTrendPanel runs={runs} className="lg:col-span-7" />
            <AiRunHistoryTable runs={runs} viewingRunId={effectiveRunId ?? ""} onView={setViewingRunId} className="lg:col-span-5" />
          </div>
        )}
      </PageStack>

      <CompetitorDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={competitor}
        onSubmit={handleEdit}
        submitError={dialogError}
        submitting={dialogSubmitting}
      />
    </>
  );
}
