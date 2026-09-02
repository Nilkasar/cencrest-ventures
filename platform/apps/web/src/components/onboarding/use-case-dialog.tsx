"use client";

import { useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Textarea,
} from "@bebest/ui";
import { TagInput } from "./tag-input";
import { PillMultiSelect } from "./pill-multiselect";
import { COMPANY_SIZE_OPTIONS } from "@/data/brand-constants";
import type { UseCase } from "@/data/types";

export interface UseCaseFormValues {
  title: string;
  industries: string[];
  companySizes: string[];
  painPoints: string[];
  solution: string;
}

interface UseCaseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: UseCase;
  onSubmit: (values: UseCaseFormValues) => Promise<void>;
  submitting?: boolean;
}

const EMPTY_FORM: UseCaseFormValues = { title: "", industries: [], companySizes: [], painPoints: [], solution: "" };

/** Outer wrapper — see `CompetitorDialog` for why the form itself is a
 *  separately keyed component with no reset effect. */
export function UseCaseDialog({ open, onOpenChange, editing, onSubmit, submitting }: UseCaseDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <UseCaseDialogForm
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

function UseCaseDialogForm({
  editing,
  onCancel,
  onSubmit,
  submitting,
}: {
  editing?: UseCase;
  onCancel: () => void;
  onSubmit: (values: UseCaseFormValues) => Promise<void>;
  submitting?: boolean;
}) {
  const [form, setForm] = useState<UseCaseFormValues>(() =>
    editing
      ? {
          title: editing.title,
          industries: editing.industries,
          companySizes: editing.companySizes,
          painPoints: editing.painPoints,
          solution: editing.solution,
        }
      : EMPTY_FORM,
  );
  const [errors, setErrors] = useState<{ title?: string; solution?: string; companySizes?: string }>({});

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const nextErrors: typeof errors = {};
    if (!form.title.trim()) nextErrors.title = "Give this use case a short title.";
    if (!form.solution.trim()) nextErrors.solution = "Describe how you solve it.";
    if (form.companySizes.length === 0) nextErrors.companySizes = "Select at least one company size.";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    await onSubmit(form);
  }

  return (
    <form onSubmit={handleSubmit}>
      <DialogHeader>
        <DialogTitle>{editing ? "Edit use case" : "Add a use case"}</DialogTitle>
        <DialogDescription>Who uses you, and why — this is what AI models need to match a question to you.</DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-4">
        <Input
          label="Title"
          placeholder="Real-time shipment tracking for manufacturers"
          value={form.title}
          onChange={(event) => setForm({ ...form, title: event.target.value })}
          error={errors.title}
          autoFocus
        />
        <PillMultiSelect
          label="Company sizes"
          options={COMPANY_SIZE_OPTIONS}
          value={form.companySizes}
          onChange={(companySizes) => setForm({ ...form, companySizes })}
          error={errors.companySizes}
        />
        <TagInput
          label="Industries"
          description="Optional — which industries this use case is most common in."
          placeholder="Type an industry and press Enter"
          value={form.industries}
          onChange={(industries) => setForm({ ...form, industries })}
        />
        <TagInput
          label="Pain points"
          description="Optional — what's frustrating before they find you."
          placeholder="Type a pain point and press Enter"
          value={form.painPoints}
          onChange={(painPoints) => setForm({ ...form, painPoints })}
        />
        <Textarea
          label="Solution"
          placeholder="How you solve it, in a sentence or two."
          value={form.solution}
          onChange={(event) => setForm({ ...form, solution: event.target.value })}
          error={errors.solution}
          rows={2}
        />
      </div>

      <DialogFooter>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" size="sm" loading={submitting}>
          {editing ? "Save changes" : "Add use case"}
        </Button>
      </DialogFooter>
    </form>
  );
}
