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
import { QUERY_CATEGORIES, type QueryCategory, type QueryIntentType, type QueryPriority } from "@/data/query-universe/types";
import { CATEGORY_INTENT_TYPE, INTENT_TYPE_LABEL, PRIORITY_LABEL, QUERY_CATEGORY_META } from "@/data/query-universe/constants";
import type { NewQueryInput } from "@/data/query-universe/client";

const INTENT_TYPES: QueryIntentType[] = ["informational", "commercial", "comparison", "transactional"];
const PRIORITIES: QueryPriority[] = [1, 2, 3];

interface AddQueryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-selects the category when opened from that category's own section
   *  header, so adding a missing query there takes one fewer click. */
  defaultCategory: QueryCategory;
  onSubmit: (values: NewQueryInput) => Promise<void>;
  submitError?: string;
  submitting?: boolean;
}

/**
 * The "add missing ones" half of the review-and-curate screen. Remounted
 * (via `key` in the parent) each time it opens so its state resets to
 * `defaultCategory` with no effect required — same pattern as Epic 2's
 * `CompetitorDialog`.
 */
export function AddQueryDialog({ open, onOpenChange, defaultCategory, onSubmit, submitError, submitting }: AddQueryDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <AddQueryForm
          defaultCategory={defaultCategory}
          onCancel={() => onOpenChange(false)}
          onSubmit={onSubmit}
          submitError={submitError}
          submitting={submitting}
        />
      </DialogContent>
    </Dialog>
  );
}

function AddQueryForm({
  defaultCategory,
  onCancel,
  onSubmit,
  submitError,
  submitting,
}: {
  defaultCategory: QueryCategory;
  onCancel: () => void;
  onSubmit: (values: NewQueryInput) => Promise<void>;
  submitError?: string;
  submitting?: boolean;
}) {
  const [text, setText] = useState("");
  const [category, setCategory] = useState<QueryCategory>(defaultCategory);
  const [intentType, setIntentType] = useState<QueryIntentType>(CATEGORY_INTENT_TYPE[defaultCategory]);
  const [priority, setPriority] = useState<QueryPriority>(2);
  const [textError, setTextError] = useState<string | undefined>(undefined);

  function handleCategoryChange(next: QueryCategory) {
    setCategory(next);
    // Re-suggest the intent type for the new category — still overridable,
    // this is a starting point, not a locked mapping.
    setIntentType(CATEGORY_INTENT_TYPE[next]);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!text.trim()) {
      setTextError("Enter the question a buyer would ask.");
      return;
    }
    setTextError(undefined);
    await onSubmit({ text: text.trim(), category, intentType, priority });
  }

  return (
    <form onSubmit={handleSubmit}>
      <DialogHeader>
        <DialogTitle>Add a query</DialogTitle>
        <DialogDescription>A question this brand should show up for, but the generator missed.</DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-4">
        <Input
          label="Query"
          placeholder="e.g. best freight visibility software for 3PLs"
          value={text}
          onChange={(event) => setText(event.target.value)}
          error={textError}
          autoFocus
        />
        <div className="flex flex-col gap-1.5">
          <label className="text-[12.5px] font-medium text-foreground">Category</label>
          <Select value={category} onValueChange={(value) => handleCategoryChange(value as QueryCategory)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {QUERY_CATEGORIES.map((cat) => (
                <SelectItem key={cat} value={cat}>
                  {QUERY_CATEGORY_META[cat].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-[12.5px] font-medium text-foreground">Intent type</label>
            <Select value={intentType} onValueChange={(value) => setIntentType(value as QueryIntentType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INTENT_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {INTENT_TYPE_LABEL[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[12.5px] font-medium text-foreground">Priority</label>
            <Select value={String(priority)} onValueChange={(value) => setPriority(Number(value) as QueryPriority)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRIORITIES.map((p) => (
                  <SelectItem key={p} value={String(p)}>
                    {PRIORITY_LABEL[p]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

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
          Add query
        </Button>
      </DialogFooter>
    </form>
  );
}
