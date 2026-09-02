"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2, Target } from "lucide-react";
import { Badge, Button, Card, CardContent, EmptyState, useToast } from "@bebest/ui";
import { useOnboarding } from "@/components/onboarding/onboarding-context";
import { UseCaseDialog, type UseCaseFormValues } from "@/components/onboarding/use-case-dialog";
import { StepActions } from "@/components/onboarding/step-actions";
import { previousStepHref, nextStepHref } from "@/components/onboarding/steps";
import { addUseCase, updateUseCase, removeUseCase, markStepComplete } from "@/lib/onboarding-client";
import { COMPANY_SIZE_LABEL } from "@/data/brand-constants";
import type { UseCase } from "@/data/types";

const MIN_USE_CASES = 3;
const MAX_USE_CASES = 5;

export default function UseCasesStep() {
  const router = useRouter();
  const { organizationId, profile, setProfile } = useOnboarding();
  const { toast } = useToast();
  const useCases = profile!.useCases;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<UseCase | undefined>(undefined);
  const [dialogSubmitting, setDialogSubmitting] = useState(false);
  const [stepError, setStepError] = useState<string | undefined>(undefined);
  const [continuing, setContinuing] = useState(false);
  const [removingId, setRemovingId] = useState<string | undefined>(undefined);

  const atLimit = useCases.length >= MAX_USE_CASES;

  function openAdd() {
    setEditing(undefined);
    setDialogOpen(true);
  }

  function openEdit(useCase: UseCase) {
    setEditing(useCase);
    setDialogOpen(true);
  }

  async function handleDialogSubmit(values: UseCaseFormValues) {
    setDialogSubmitting(true);
    try {
      const updated = editing
        ? await updateUseCase(organizationId, editing.id, values)
        : await addUseCase(organizationId, values);
      setProfile(updated);
      setDialogOpen(false);
      setStepError(undefined);
    } catch (error) {
      toast({
        title: "Couldn't save use case",
        description: error instanceof Error ? error.message : "Something went wrong — try again.",
        variant: "danger",
      });
    } finally {
      setDialogSubmitting(false);
    }
  }

  async function handleRemove(useCase: UseCase) {
    setRemovingId(useCase.id);
    try {
      const updated = await removeUseCase(organizationId, useCase.id);
      setProfile(updated);
    } catch (error) {
      toast({
        title: "Couldn't remove use case",
        description: error instanceof Error ? error.message : "Something went wrong — try again.",
        variant: "danger",
      });
    } finally {
      setRemovingId(undefined);
    }
  }

  async function handleContinue() {
    if (useCases.length < MIN_USE_CASES) {
      setStepError(`Add at least ${MIN_USE_CASES} use cases (you have ${useCases.length}) — this is what maps buying questions to you.`);
      return;
    }
    setStepError(undefined);
    setContinuing(true);
    try {
      const updated = await markStepComplete(organizationId, "use-cases");
      setProfile(updated);
      router.push(nextStepHref("use-cases"));
    } finally {
      setContinuing(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <p className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-subtle-foreground">Step 4 of 5</p>
        <h1 className="font-display text-[22px] font-semibold text-foreground tracking-[-0.015em]">Use cases</h1>
        <p className="text-[13.5px] leading-relaxed text-muted-foreground">
          Add 3–5 ways customers use you. These map directly to the buying questions AI models get asked.
        </p>
      </div>

      <div className="flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-3">
        <p className="font-mono text-[13px] font-medium text-foreground">
          {useCases.length} of {MIN_USE_CASES}–{MAX_USE_CASES} added
        </p>
        <Button variant="primary" size="sm" onClick={openAdd} disabled={atLimit}>
          <Plus size={14} /> Add a use case
        </Button>
      </div>

      {useCases.length === 0 ? (
        <EmptyState
          compact
          icon={<Target size={18} />}
          title="No use cases yet"
          description="Start with the one you'd explain first on a sales call."
          action={
            <Button variant="secondary" size="sm" onClick={openAdd}>
              <Plus size={14} /> Add a use case
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          {useCases.map((useCase) => (
            <Card key={useCase.id}>
              <CardContent className="flex items-start justify-between gap-4">
                <div className="flex flex-col gap-2 min-w-0">
                  <p className="font-medium text-[14px] text-foreground">{useCase.title}</p>
                  <p className="text-[13px] leading-relaxed text-muted-foreground">{useCase.solutions.join(" · ")}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {useCase.companySizes.map((size) => (
                      <Badge key={size} variant="neutral" size="sm">
                        {COMPANY_SIZE_LABEL.get(size) ?? size}
                      </Badge>
                    ))}
                    {useCase.industries.map((industry) => (
                      <Badge key={industry} variant="outline" size="sm">
                        {industry}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button variant="ghost" size="icon" aria-label={`Edit ${useCase.title}`} onClick={() => openEdit(useCase)}>
                    <Pencil size={14} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${useCase.title}`}
                    loading={removingId === useCase.id}
                    onClick={() => handleRemove(useCase)}
                    className="text-danger hover:bg-danger-muted hover:text-danger"
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {stepError && (
        <p role="alert" className="rounded-md border border-danger/30 bg-danger-muted px-3 py-2.5 text-[12.5px] leading-relaxed text-danger">
          {stepError}
        </p>
      )}

      <UseCaseDialog open={dialogOpen} onOpenChange={setDialogOpen} editing={editing} onSubmit={handleDialogSubmit} submitting={dialogSubmitting} />

      <StepActions backHref={previousStepHref("use-cases")} submitting={continuing} onContinue={handleContinue} />
    </div>
  );
}
