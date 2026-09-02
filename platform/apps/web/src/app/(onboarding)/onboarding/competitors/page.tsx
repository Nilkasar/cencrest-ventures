"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Pencil, Users } from "lucide-react";
import {
  Badge,
  Button,
  EmptyState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useToast,
} from "@bebest/ui";
import { useOnboarding } from "@/components/onboarding/onboarding-context";
import { CompetitorDialog, type CompetitorFormValues } from "@/components/onboarding/competitor-dialog";
import { StepActions } from "@/components/onboarding/step-actions";
import { previousStepHref, nextStepHref } from "@/components/onboarding/steps";
import { addCompetitor, updateCompetitor, removeCompetitor, markStepComplete, EntitlementError } from "@/lib/onboarding-client";
import { competitorLimitFor, isUnlimited, COMPETITOR_PRIORITY_LABEL, COMPETITOR_PRIORITY_VARIANT } from "@/data/brand-constants";
import { currentOrganization } from "@/data/fixtures";
import type { Competitor } from "@/data/types";

export default function CompetitorsStep() {
  const router = useRouter();
  const { organizationId, profile, setProfile } = useOnboarding();
  const { toast } = useToast();
  const plan = currentOrganization.plan;
  const limit = competitorLimitFor(plan);
  const competitors = profile!.competitors;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Competitor | undefined>(undefined);
  const [dialogError, setDialogError] = useState<string | undefined>(undefined);
  const [dialogSubmitting, setDialogSubmitting] = useState(false);
  const [stepError, setStepError] = useState<string | undefined>(undefined);
  const [continuing, setContinuing] = useState(false);
  const [removingId, setRemovingId] = useState<string | undefined>(undefined);

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
        ? await updateCompetitor(organizationId, editing.id, values)
        : await addCompetitor(organizationId, plan, values);
      setProfile(updated);
      setDialogOpen(false);
    } catch (error) {
      if (error instanceof EntitlementError) {
        setDialogError(error.message);
      } else {
        setDialogError(error instanceof Error ? error.message : "Something went wrong — try again.");
      }
    } finally {
      setDialogSubmitting(false);
    }
  }

  async function handleRemove(competitor: Competitor) {
    setRemovingId(competitor.id);
    try {
      const updated = await removeCompetitor(organizationId, competitor.id);
      setProfile(updated);
      toast({ title: "Competitor removed", description: `${competitor.name} is no longer tracked.` });
    } catch (error) {
      toast({
        title: "Couldn't remove competitor",
        description: error instanceof Error ? error.message : "Something went wrong — try again.",
        variant: "danger",
      });
    } finally {
      setRemovingId(undefined);
    }
  }

  async function handleContinue() {
    if (competitors.length === 0) {
      setStepError("Add at least one competitor to continue — this is the core of your competitive intelligence.");
      return;
    }
    setStepError(undefined);
    setContinuing(true);
    try {
      const updated = await markStepComplete(organizationId, "competitors");
      setProfile(updated);
      router.push(nextStepHref("competitors"));
    } finally {
      setContinuing(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <p className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-subtle-foreground">Step 2 of 5</p>
        <h1 className="font-display text-[22px] font-semibold text-foreground tracking-[-0.015em]">Competitors</h1>
        <p className="text-[13.5px] leading-relaxed text-muted-foreground">
          Who do you lose to in an AI answer? Add up to your plan&apos;s limit — you can adjust this anytime.
        </p>
      </div>

      <div className="flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-3">
        <div className="flex flex-col gap-0.5">
          <p className="font-mono text-[13px] font-medium text-foreground">
            {competitors.length} {isUnlimited(limit) ? "" : `of ${limit}`} tracked
          </p>
          <p className="text-[12px] text-muted-foreground">
            {capitalize(plan)} plan {isUnlimited(limit) ? "· unlimited (per-client)" : `· ${limit - competitors.length} remaining`}
          </p>
        </div>
        <Button variant="primary" size="sm" onClick={openAdd} disabled={atLimit}>
          <Plus size={14} /> Add a competitor
        </Button>
      </div>

      {competitors.length === 0 ? (
        <EmptyState
          compact
          icon={<Users size={18} />}
          title="No competitors yet"
          description="Add the companies AI models mention instead of you — we'll trace every gap to its source later."
          action={
            <Button variant="secondary" size="sm" onClick={openAdd}>
              <Plus size={14} /> Add a competitor
            </Button>
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Website</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {competitors.map((competitor) => (
              <TableRow key={competitor.id}>
                <TableCell className="font-medium">{competitor.name}</TableCell>
                <TableCell className="text-muted-foreground">{competitor.websiteUrl.replace(/^https?:\/\//, "")}</TableCell>
                <TableCell>
                  <Badge variant={COMPETITOR_PRIORITY_VARIANT[competitor.priority]} size="sm">
                    {COMPETITOR_PRIORITY_LABEL[competitor.priority]}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-1">
                    <Button variant="ghost" size="icon" aria-label={`Edit ${competitor.name}`} onClick={() => openEdit(competitor)}>
                      <Pencil size={14} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${competitor.name}`}
                      loading={removingId === competitor.id}
                      onClick={() => handleRemove(competitor)}
                      className="text-danger hover:bg-danger-muted hover:text-danger"
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {stepError && (
        <p role="alert" className="rounded-md border border-danger/30 bg-danger-muted px-3 py-2.5 text-[12.5px] leading-relaxed text-danger">
          {stepError}
        </p>
      )}

      <CompetitorDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        onSubmit={handleDialogSubmit}
        submitError={dialogError}
        submitting={dialogSubmitting}
      />

      <StepActions backHref={previousStepHref("competitors")} submitting={continuing} onContinue={handleContinue} />
    </div>
  );
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
