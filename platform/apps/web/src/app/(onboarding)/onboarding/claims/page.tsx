"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2, FileCheck2, BadgeCheck } from "lucide-react";
import { Badge, Button, Card, CardContent, EmptyState, useToast } from "@bebest/ui";
import { useOnboarding } from "@/components/onboarding/onboarding-context";
import { ClaimDialog, type ClaimFormValues } from "@/components/onboarding/claim-dialog";
import { StepActions } from "@/components/onboarding/step-actions";
import { previousStepHref, nextStepHref } from "@/components/onboarding/steps";
import { addBrandClaim, updateBrandClaim, removeBrandClaim, markStepComplete } from "@/lib/onboarding-client";
import { CLAIM_CONFIDENCE_LABEL, CLAIM_CONFIDENCE_VARIANT } from "@/data/brand-constants";
import type { BrandClaim } from "@/data/types";

export default function ClaimsStep() {
  const router = useRouter();
  const { organizationId, profile, setProfile } = useOnboarding();
  const { toast } = useToast();
  const claims = profile!.brandClaims;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<BrandClaim | undefined>(undefined);
  const [dialogSubmitting, setDialogSubmitting] = useState(false);
  const [continuing, setContinuing] = useState(false);
  const [removingId, setRemovingId] = useState<string | undefined>(undefined);

  function openAdd() {
    setEditing(undefined);
    setDialogOpen(true);
  }

  function openEdit(claim: BrandClaim) {
    setEditing(claim);
    setDialogOpen(true);
  }

  async function handleDialogSubmit(values: ClaimFormValues) {
    setDialogSubmitting(true);
    try {
      const updated = editing
        ? await updateBrandClaim(organizationId, editing.id, values)
        : await addBrandClaim(organizationId, values);
      setProfile(updated);
      setDialogOpen(false);
    } catch (error) {
      toast({
        title: "Couldn't save claim",
        description: error instanceof Error ? error.message : "Something went wrong — try again.",
        variant: "danger",
      });
    } finally {
      setDialogSubmitting(false);
    }
  }

  async function handleRemove(claim: BrandClaim) {
    setRemovingId(claim.id);
    try {
      const updated = await removeBrandClaim(organizationId, claim.id);
      setProfile(updated);
    } catch (error) {
      toast({
        title: "Couldn't remove claim",
        description: error instanceof Error ? error.message : "Something went wrong — try again.",
        variant: "danger",
      });
    } finally {
      setRemovingId(undefined);
    }
  }

  async function handleContinue() {
    setContinuing(true);
    try {
      const updated = await markStepComplete(organizationId, "claims");
      setProfile(updated);
      router.push(nextStepHref("claims"));
    } finally {
      setContinuing(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <p className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-subtle-foreground">Step 5 of 5</p>
        <h1 className="font-display text-[22px] font-semibold text-foreground tracking-[-0.015em]">Brand claims</h1>
        <p className="text-[13.5px] leading-relaxed text-muted-foreground">
          Optional. Add what you already know — facts, numbers, certifications AI models could cite in your favor.
        </p>
      </div>

      <div className="flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-3">
        <p className="font-mono text-[13px] font-medium text-foreground">{claims.length} added</p>
        <Button variant="primary" size="sm" onClick={openAdd}>
          <Plus size={14} /> Add a claim
        </Button>
      </div>

      {claims.length === 0 ? (
        <EmptyState
          compact
          icon={<FileCheck2 size={18} />}
          title="No claims yet — and that's fine"
          description="You can always add these later from Settings. Skip ahead if nothing comes to mind right now."
          action={
            <Button variant="secondary" size="sm" onClick={openAdd}>
              <Plus size={14} /> Add a claim
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          {claims.map((claim) => (
            <Card key={claim.id}>
              <CardContent className="flex items-start justify-between gap-4">
                <div className="flex flex-col gap-2 min-w-0">
                  <p className="text-[13.5px] leading-relaxed text-foreground">{claim.claim}</p>
                  {claim.evidence && <p className="text-[12.5px] text-muted-foreground">{claim.evidence}</p>}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant={CLAIM_CONFIDENCE_VARIANT[claim.confidence]} size="sm">
                      {CLAIM_CONFIDENCE_LABEL.get(claim.confidence)} confidence
                    </Badge>
                    {claim.verified && (
                      <Badge variant="success" size="sm" className="gap-1">
                        <BadgeCheck size={11} /> Verified
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button variant="ghost" size="icon" aria-label="Edit claim" onClick={() => openEdit(claim)}>
                    <Pencil size={14} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Remove claim"
                    loading={removingId === claim.id}
                    onClick={() => handleRemove(claim)}
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

      <ClaimDialog open={dialogOpen} onOpenChange={setDialogOpen} editing={editing} onSubmit={handleDialogSubmit} submitting={dialogSubmitting} />

      <StepActions
        backHref={previousStepHref("claims")}
        continueLabel="Finish setup"
        submitting={continuing}
        onContinue={handleContinue}
      />
    </div>
  );
}
