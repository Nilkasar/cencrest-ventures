"use client";

import { useState } from "react";
import { Plus, Users } from "lucide-react";
import { Button, EmptyState, Skeleton, SkeletonText, useToast } from "@bebest/ui";
import { PageHeader } from "@/components/patterns/page-header";
import { ErrorPanel } from "@/components/patterns/error-panel";
import { useBrandProfile } from "@/hooks/use-brand-profile";
import { useAsyncData } from "@/lib/use-async-data";
import { useCurrentOrg } from "@/lib/session-context";
import { addCompetitor, updateCompetitor, removeCompetitor, EntitlementError } from "@/lib/onboarding-client";
import { competitorLimitFor, isUnlimited } from "@/data/brand-constants";
import { getCompetitiveGaps } from "@/data/competitive-intelligence/client";
import type { Competitor } from "@/data/types";
import { CompetitorDialog, type CompetitorFormValues } from "@/components/onboarding/competitor-dialog";
import { CompetitorCard } from "./competitor-card";
import { ShareOfVoicePanel } from "./share-of-voice-panel";
import { CompetitiveGapPanel } from "./competitive-gap-panel";
import { GapFindingsPanel } from "./gap-findings-panel";
import { MovementPanel } from "./movement-panel";

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Epic 8 — Competitive Intelligence's "Competitors" screen
 * (`docs/09-ux/CUSTOMER_JOURNEY.md`: "How do I compare?"). Calls
 * `platform/apps/api`'s real routes from the first line, no fixture layer:
 * competitor CRUD reuses Epic 2's already-real `onboarding-client.ts`
 * (the same functions the onboarding wizard and Settings panel call),
 * everything else goes through `data/competitive-intelligence/client.ts`.
 *
 * `getCompetitiveGaps()` is fetched once here and shared by
 * `CompetitiveGapPanel` and `GapFindingsPanel` — both need the identical
 * response, so lifting the fetch avoids requesting it twice.
 */
export function CompetitorsView() {
  const org = useCurrentOrg();
  const orgId = org?.id ?? "";
  const { profile, loading, error, reload, setProfile } = useBrandProfile(orgId);
  const { toast } = useToast();
  const gapsState = useAsyncData(() => getCompetitiveGaps(), []);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Competitor | undefined>(undefined);
  const [dialogError, setDialogError] = useState<string | undefined>(undefined);
  const [dialogSubmitting, setDialogSubmitting] = useState(false);
  const [removingId, setRemovingId] = useState<string | undefined>(undefined);

  const plan = org?.plan ?? "free";
  const limit = competitorLimitFor(plan);
  const competitors = profile?.competitors ?? [];
  const atLimit = competitors.length >= limit;

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
      const updated = editing
        ? await updateCompetitor(orgId, editing.id, values)
        : await addCompetitor(orgId, values);
      setProfile(updated);
      setDialogOpen(false);
    } catch (err) {
      setDialogError(err instanceof EntitlementError ? err.message : err instanceof Error ? err.message : "Something went wrong — try again.");
    } finally {
      setDialogSubmitting(false);
    }
  }

  async function handleRemove(competitor: Competitor) {
    setRemovingId(competitor.id);
    try {
      const updated = await removeCompetitor(orgId, competitor.id);
      setProfile(updated);
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
    <Button variant="primary" size="sm" onClick={openAdd} disabled={atLimit}>
      <Plus size={14} /> Add a competitor
    </Button>
  );

  return (
    <>
      <PageHeader
        eyebrow="Intelligence"
        title="Competitors"
        description="How do I compare? Competitor AI Visibility Scores, share of AI voice, per-intent gaps, and movement — all measured, not guessed."
        actions={!loading && !error && competitors.length > 0 ? addButton : undefined}
      />

      {loading && (
        <div className="flex flex-col gap-4">
          {[0, 1].map((i) => (
            <div key={i} className="rounded-xl border border-border bg-surface-raised p-5">
              <Skeleton className="h-4 w-40 mb-4" />
              <SkeletonText lines={2} />
            </div>
          ))}
        </div>
      )}

      {!loading && error && <ErrorPanel message={error} onRetry={reload} />}

      {!loading && !error && competitors.length === 0 && (
        <EmptyState
          icon={<Users size={20} />}
          eyebrow="Competitors"
          title="No competitors tracked yet"
          description={`Add up to ${isUnlimited(limit) ? "an unlimited number of" : limit} competitors to see how often AI recommends them instead of you, and where each gap comes from.`}
          action={addButton}
        />
      )}

      {!loading && !error && competitors.length > 0 && (
        <div className="flex flex-col gap-6">
          <div className="flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-3">
            <div className="flex flex-col gap-0.5">
              <p className="font-mono text-[13px] font-medium text-foreground">
                {competitors.length} {isUnlimited(limit) ? "" : `of ${limit}`} tracked
              </p>
              <p className="text-[12px] text-muted-foreground">
                {capitalize(plan)} plan {isUnlimited(limit) ? "· unlimited (per-client)" : `· ${Math.max(limit - competitors.length, 0)} remaining`}
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-4">
            {competitors.map((competitor) => (
              <CompetitorCard
                key={competitor.id}
                competitor={competitor}
                onEdit={openEdit}
                onRemove={handleRemove}
                removing={removingId === competitor.id}
              />
            ))}
          </div>

          <ShareOfVoicePanel />

          <CompetitiveGapPanel competitors={competitors} state={gapsState} onRetry={gapsState.reload} />

          {gapsState.status === "success" && gapsState.data !== null && <GapFindingsPanel gaps={gapsState.data} />}

          <MovementPanel competitors={competitors} />
        </div>
      )}

      <CompetitorDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        onSubmit={handleDialogSubmit}
        submitError={dialogError}
        submitting={dialogSubmitting}
      />
    </>
  );
}
