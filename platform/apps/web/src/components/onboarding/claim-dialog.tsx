"use client";

import { useState } from "react";
import { BadgeCheck } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  cn,
} from "@bebest/ui";
import { CLAIM_CONFIDENCE_OPTIONS } from "@/data/brand-constants";
import type { BrandClaim, ClaimConfidence } from "@/data/types";

export interface ClaimFormValues {
  claim: string;
  evidence: string;
  confidence: ClaimConfidence;
  verified: boolean;
}

interface ClaimDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: BrandClaim;
  onSubmit: (values: ClaimFormValues) => Promise<void>;
  submitting?: boolean;
}

const EMPTY_FORM: ClaimFormValues = { claim: "", evidence: "", confidence: "medium", verified: false };

/** Outer wrapper — see `CompetitorDialog` for why the form itself is a
 *  separately keyed component with no reset effect. */
export function ClaimDialog({ open, onOpenChange, editing, onSubmit, submitting }: ClaimDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <ClaimDialogForm
          key={open ? (editing?.id ?? "new") : "closed"}
          editing={editing}
          onCancel={() => onOpenChange(false)}
          onSubmit={onSubmit}
          submitting={submitting}
        />
      </DialogContent>
    </Dialog>
  );
}

function ClaimDialogForm({
  editing,
  onCancel,
  onSubmit,
  submitting,
}: {
  editing?: BrandClaim;
  onCancel: () => void;
  onSubmit: (values: ClaimFormValues) => Promise<void>;
  submitting?: boolean;
}) {
  const [form, setForm] = useState<ClaimFormValues>(() =>
    editing ? { claim: editing.claim, evidence: editing.evidence, confidence: editing.confidence, verified: editing.verified } : EMPTY_FORM,
  );
  const [error, setError] = useState<string | undefined>(undefined);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!form.claim.trim()) {
      setError("Enter the claim itself.");
      return;
    }
    setError(undefined);
    await onSubmit(form);
  }

  return (
    <form onSubmit={handleSubmit}>
      <DialogHeader>
        <DialogTitle>{editing ? "Edit brand claim" : "Add a brand claim"}</DialogTitle>
        <DialogDescription>
          A fact worth citing — a number, a certification, a guarantee. This becomes evidence AI models can quote.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-4">
        <Textarea
          label="Claim"
          placeholder="Real-time GPS tracking on 100% of loads"
          value={form.claim}
          onChange={(event) => setForm({ ...form, claim: event.target.value })}
          error={error}
          rows={2}
          autoFocus
        />
        <Textarea
          label="Evidence"
          description="Optional — where this can be verified (a page, a report, a certification body)."
          placeholder="northwindlogistics.example/tracking"
          value={form.evidence}
          onChange={(event) => setForm({ ...form, evidence: event.target.value })}
          rows={2}
        />
        <div className="flex flex-col gap-1.5">
          <label className="text-[12.5px] font-medium text-foreground">Confidence</label>
          <Select value={form.confidence} onValueChange={(value) => setForm({ ...form, confidence: value as ClaimConfidence })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CLAIM_CONFIDENCE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label} — {option.description}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <button
          type="button"
          aria-pressed={form.verified}
          onClick={() => setForm({ ...form, verified: !form.verified })}
          className={cn(
            "flex items-center gap-2 self-start rounded-md border px-3 py-1.5 text-[12.5px] font-medium transition-colors duration-150",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            form.verified
              ? "border-success/40 bg-success-muted text-success"
              : "border-border bg-surface-raised text-muted-foreground hover:border-border-strong hover:text-foreground",
          )}
        >
          <BadgeCheck size={14} /> {form.verified ? "Marked as verified" : "Mark as verified"}
        </button>
      </div>

      <DialogFooter>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" size="sm" loading={submitting}>
          {editing ? "Save changes" : "Add claim"}
        </Button>
      </DialogFooter>
    </form>
  );
}
