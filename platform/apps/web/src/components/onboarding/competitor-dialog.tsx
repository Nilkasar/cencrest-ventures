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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@bebest/ui";
import { TagInput } from "./tag-input";
import { COMPETITOR_PRIORITY_OPTIONS } from "@/data/brand-constants";
import type { Competitor, CompetitorPriority } from "@/data/types";
import { normalizeUrl } from "@/lib/onboarding-client";

export interface CompetitorFormValues {
  name: string;
  websiteUrl: string;
  priority: CompetitorPriority;
  aliases: string[];
}

interface CompetitorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present when editing an existing row; absent when adding. */
  editing?: Competitor;
  onSubmit: (values: CompetitorFormValues) => Promise<void>;
  /** Surfaced inline (e.g. the entitlement-limit message) rather than as a
   *  toast — the user needs to read it before deciding what to do next. */
  submitError?: string;
  submitting?: boolean;
}

const EMPTY_FORM: CompetitorFormValues = { name: "", websiteUrl: "", priority: 2, aliases: [] };

/**
 * Outer wrapper only — no form state lives here. `CompetitorDialogForm`
 * below is remounted (via `key`) every time the dialog opens, so its
 * `useState` initializer re-derives fresh values from `editing` with no
 * effect required (React's own recommended pattern for "reset state when
 * an input changes" — see https://react.dev/learn/you-might-not-need-an-effect).
 */
export function CompetitorDialog({ open, onOpenChange, editing, onSubmit, submitError, submitting }: CompetitorDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <CompetitorDialogForm
          key={open ? (editing?.id ?? "new") : "closed"}
          editing={editing}
          onCancel={() => onOpenChange(false)}
          onSubmit={onSubmit}
          submitError={submitError}
          submitting={submitting}
        />
      </DialogContent>
    </Dialog>
  );
}

function CompetitorDialogForm({
  editing,
  onCancel,
  onSubmit,
  submitError,
  submitting,
}: {
  editing?: Competitor;
  onCancel: () => void;
  onSubmit: (values: CompetitorFormValues) => Promise<void>;
  submitError?: string;
  submitting?: boolean;
}) {
  const [form, setForm] = useState<CompetitorFormValues>(() =>
    editing
      ? { name: editing.name, websiteUrl: editing.websiteUrl, priority: editing.priority, aliases: editing.aliases }
      : EMPTY_FORM,
  );
  const [errors, setErrors] = useState<{ name?: string; websiteUrl?: string }>({});

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const nextErrors: typeof errors = {};
    if (!form.name.trim()) nextErrors.name = "Enter a name.";
    if (!form.websiteUrl.trim()) {
      nextErrors.websiteUrl = "Enter a website.";
    } else if (!normalizeUrl(form.websiteUrl)) {
      nextErrors.websiteUrl = "Enter a valid website, e.g. competitor.com.";
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    await onSubmit({ ...form, websiteUrl: normalizeUrl(form.websiteUrl) ?? form.websiteUrl });
  }

  return (
    <form onSubmit={handleSubmit}>
      <DialogHeader>
        <DialogTitle>{editing ? "Edit competitor" : "Add a competitor"}</DialogTitle>
        <DialogDescription>We&apos;ll track how often AI assistants recommend them instead of you.</DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-4">
        <Input
          label="Name"
          placeholder="Competitor Inc."
          value={form.name}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
          error={errors.name}
          autoFocus
        />
        <Input
          label="Website"
          placeholder="competitor.com"
          value={form.websiteUrl}
          onChange={(event) => setForm({ ...form, websiteUrl: event.target.value })}
          error={errors.websiteUrl}
        />
        <div className="flex flex-col gap-1.5">
          <label className="text-[12.5px] font-medium text-foreground">Priority</label>
          <Select
            value={String(form.priority)}
            onValueChange={(value) => setForm({ ...form, priority: Number(value) as CompetitorPriority })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COMPETITOR_PRIORITY_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={String(option.value)}>
                  {option.label} — {option.description}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <TagInput
          label="Aliases"
          description="Optional — other names this competitor goes by."
          placeholder="Type a name and press Enter"
          value={form.aliases}
          onChange={(aliases) => setForm({ ...form, aliases })}
        />

        {submitError && (
          <p role="alert" className="rounded-md border border-danger/30 bg-danger-muted px-3 py-2.5 text-[12.5px] leading-relaxed text-danger">
            {submitError}
          </p>
        )}
      </div>

      <DialogFooter>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" size="sm" loading={submitting}>
          {editing ? "Save changes" : "Add competitor"}
        </Button>
      </DialogFooter>
    </form>
  );
}
