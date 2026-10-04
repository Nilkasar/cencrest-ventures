"use client";

import { useCallback, useState } from "react";
import { Gauge, ListChecks, PieChart, Plus, Trophy, Users } from "lucide-react";
import { Button, EmptyState, Table, TableBody, TableHead, TableHeader, TableRow, useToast } from "@bebest/ui";
import { PageStack, Reveal } from "@/components/patterns/motion";
import { StatGrid, StatTile } from "@/components/patterns/stat-tile";
import { ResultCount, Toolbar } from "@/components/patterns/toolbar";
import { TableSkeleton, type SkeletonColumn } from "@/components/patterns/data-table";
import { ErrorPanel } from "@/components/patterns/error-panel";
import { typography } from "@/components/patterns/typography";
import { useBrandProfile } from "@/hooks/use-brand-profile";
import { useAsyncData } from "@/lib/use-async-data";
import { useCurrentOrg } from "@/lib/session-context";
import { addCompetitor, updateCompetitor, removeCompetitor, EntitlementError } from "@/lib/onboarding-client";
import { competitorLimitFor, isUnlimited } from "@/data/brand-constants";
import { getCompetitiveGaps, getShareOfVoice } from "@/data/competitive-intelligence/client";
import type { Competitor } from "@/data/types";
import { formatPercent } from "@/lib/format";
import { CompetitorDialog, type CompetitorFormValues } from "@/components/onboarding/competitor-dialog";
import { CompetitorRow } from "./competitor-row";
import { RankingPanel, ShareOfVoicePanel } from "./share-of-voice-panel";
import { CompetitiveGapPanel } from "./competitive-gap-panel";
import { GapFindingsPanel } from "./gap-findings-panel";

const COLUMNS: SkeletonColumn[] = [
  { header: "Competitor", cell: "entity" },
  { header: "Priority", cell: "badge" },
  { header: "Latest run", cell: "badge" },
  { header: "Score", cell: "number", align: "right" },
  { header: "vs. you", cell: "number", align: "right" },
  { header: "", cell: "meta" },
];

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Competitors — "How do I compare?" Answer first (rank, score, share of
 * voice, open gaps), then the two pictures behind it, then the tracked
 * list (each row runs its own check and opens its evidence page), then the
 * head-to-head and the classified gaps that feed Opportunities.
 *
 * Competitor CRUD reuses the onboarding client (same functions the wizard
 * and Settings call); everything else is `data/competitive-intelligence`.
 */
export function CompetitorsView() {
  const org = useCurrentOrg();
  const orgId = org?.id ?? "";
  const { profile, loading, error, reload, setProfile } = useBrandProfile(orgId);
  const { toast } = useToast();
  const gapsState = useAsyncData(() => getCompetitiveGaps(), []);
  const sovState = useAsyncData(() => getShareOfVoice(), []);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Competitor | undefined>(undefined);
  const [dialogError, setDialogError] = useState<string | undefined>(undefined);
  const [dialogSubmitting, setDialogSubmitting] = useState(false);
  const [removingId, setRemovingId] = useState<string | undefined>(undefined);

  const plan = org?.plan ?? "free";
  const limit = competitorLimitFor(plan);
  const competitors = profile?.competitors ?? [];
  const atLimit = competitors.length >= limit;
  const profileLoading = !org || loading;

  const reloadGaps = gapsState.reload;
  const reloadSov = sovState.reload;
  const refreshComparisons = useCallback(() => {
    reloadGaps();
    reloadSov();
  }, [reloadGaps, reloadSov]);

  function openAdd() {
    setEditing(undefined);
    setDialogError(undefined);
    setDialogOpen(true);
  }

  function openEdit(competitor: Competitor) {
    setEditing(competitor);
    setDialogError(undefined);
    setDialogOpen(true);
  }

  async function handleDialogSubmit(values: CompetitorFormValues) {
    setDialogSubmitting(true);
    setDialogError(undefined);
    try {
      const updated = editing ? await updateCompetitor(orgId, editing.id, values) : await addCompetitor(orgId, values);
      setProfile(updated);
      setDialogOpen(false);
      refreshComparisons();
    } catch (err) {
      setDialogError(err instanceof EntitlementError ? err.message : err instanceof Error ? err.message : "Something went wrong — try again.");
    } finally {
      setDialogSubmitting(false);
    }
  }

  async function handleRemove(competitor: Competitor) {
    if (!window.confirm(`Stop tracking ${competitor.name}? Their past runs stay in your history.`)) return;
    setRemovingId(competitor.id);
    try {
      const updated = await removeCompetitor(orgId, competitor.id);
      setProfile(updated);
      refreshComparisons();
      toast({ title: "Competitor removed", description: `${competitor.name} is no longer tracked.` });
    } catch (err) {
      toast({
        title: "Couldn't remove competitor",
        description: err instanceof Error ? err.message : "Something went wrong — try again.",
        variant: "danger",
      });
    } finally {
      setRemovingId(undefined);
    }
  }

  const addButton = (
    <Button variant="primary" size="sm" className="h-9" onClick={openAdd} disabled={atLimit} title={atLimit ? "Plan limit reached" : undefined}>
      <Plus size={14} aria-hidden="true" /> Add competitor
    </Button>
  );

  // Headline numbers — all from the API, across the whole comparison.
  const gaps = gapsState.status === "success" ? gapsState.data : null;
  const sov = sovState.status === "success" ? sovState.data : null;
  const gapById = new Map((gaps?.competitors ?? []).map((c) => [c.competitorId, c.competitiveGap]));
  const yourScore = gaps?.computed ? (gaps.brandRun?.aiVisibilityScore ?? null) : null;
  const measuredScores = (gaps?.competitors ?? []).filter((c) => c.run?.aiVisibilityScore != null).map((c) => c.run!.aiVisibilityScore!);
  const rank = yourScore !== null ? 1 + measuredScores.filter((s) => s > yourScore).length : null;
  const highGaps = gaps ? gaps.gaps.filter((g) => g.severity === "high").length : 0;
  const statsLoading = gapsState.status === "loading";

  return (
    <PageStack>
      {profileLoading && (
        <>
          <StatGrid>
            {["Your rank", "Your score", "Share of AI voice", "Open gaps"].map((label) => (
              <StatTile key={label} label={label} value="—" loading />
            ))}
          </StatGrid>
          <Reveal>
            <TableSkeleton columns={COLUMNS} rows={3} label="Loading competitors…" />
          </Reveal>
        </>
      )}

      {!profileLoading && error && (
        <Reveal>
          <ErrorPanel title="Competitors didn't load" message={error} onRetry={reload} />
        </Reveal>
      )}

      {!profileLoading && !error && competitors.length === 0 && (
        <Reveal>
          <EmptyState
            icon={<Users size={20} />}
            title="No competitors tracked yet"
            description={`Add the brands you lose deals to — up to ${isUnlimited(limit) ? "as many as you need" : limit} on your plan. Each one is asked the same questions as you, so you can see who AI recommends instead and why.`}
            action={addButton}
          />
        </Reveal>
      )}

      {!profileLoading && !error && competitors.length > 0 && (
        <>
          <StatGrid>
            <StatTile
              label="Your rank"
              icon={<Trophy size={13} />}
              loading={statsLoading}
              value={rank !== null ? `#${rank}` : "—"}
              muted={rank === null}
              hint={rank !== null ? `of ${measuredScores.length + 1} measured brands` : "Needs your baseline run"}
            />
            <StatTile
              label="Your score"
              icon={<Gauge size={13} />}
              loading={statsLoading}
              value={yourScore !== null ? yourScore.toFixed(1) : "—"}
              muted={yourScore === null}
              hint={measuredScores.length > 0 ? `Top competitor ${Math.max(...measuredScores).toFixed(1)}` : "AI Visibility Score"}
              href="/ai-visibility"
            />
            <StatTile
              label="Share of AI voice"
              icon={<PieChart size={13} />}
              loading={sovState.status === "loading"}
              value={sov && sov.totalMentions > 0 ? formatPercent(sov.yourSharePct) : "—"}
              muted={!sov || sov.totalMentions === 0}
              hint={sov && sov.totalMentions > 0 ? `${sov.yourMentions} of ${sov.totalMentions} mentions` : "No mentions yet"}
            />
            <StatTile
              label="Open gaps"
              icon={<ListChecks size={13} />}
              loading={statsLoading}
              value={gaps ? String(gaps.gaps.length) : "—"}
              muted={!gaps || gaps.gaps.length === 0}
              hint={highGaps > 0 ? `${highGaps} high severity` : "Where a competitor wins and you don't"}
            />
          </StatGrid>

          <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-12">
            <RankingPanel state={gapsState} className="lg:col-span-7" />
            <ShareOfVoicePanel state={sovState} className="lg:col-span-5" />
          </div>

          <Toolbar
            end={
              <>
                <ResultCount count={competitors.length} noun="competitor" />
                {addButton}
              </>
            }
          >
            <p className={typography.meta}>
              {capitalize(plan)} plan ·{" "}
              {isUnlimited(limit) ? "unlimited tracking" : atLimit ? `limit of ${limit} reached` : `${limit - competitors.length} of ${limit} slots left`}
            </p>
          </Toolbar>

          <Reveal>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Competitor</TableHead>
                  <TableHead className="hidden md:table-cell">Priority</TableHead>
                  <TableHead>Latest run</TableHead>
                  <TableHead className="text-right">Score</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">vs. you</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {competitors.map((competitor) => (
                  <CompetitorRow
                    key={competitor.id}
                    competitor={competitor}
                    gap={gapById.get(competitor.id) ?? null}
                    onEdit={openEdit}
                    onRemove={handleRemove}
                    removing={removingId === competitor.id}
                    onRunSettled={refreshComparisons}
                  />
                ))}
              </TableBody>
            </Table>
          </Reveal>

          <CompetitiveGapPanel competitors={competitors} state={gapsState} onRetry={gapsState.reload} />

          {gaps && <GapFindingsPanel gaps={gaps} />}
        </>
      )}

      <CompetitorDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        onSubmit={handleDialogSubmit}
        submitError={dialogError}
        submitting={dialogSubmitting}
      />
    </PageStack>
  );
}
