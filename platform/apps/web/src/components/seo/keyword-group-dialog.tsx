"use client";

import { useState } from "react";
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input } from "@bebest/ui";

interface KeywordGroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "rename";
  initialName?: string;
  onSubmit: (name: string) => Promise<void>;
  submitError?: string;
  submitting?: boolean;
}

/** Create-or-rename a keyword group — same one-field-form shape
 *  `add-query-dialog.tsx` uses, remounted via `key` in the parent each time
 *  it opens so its state resets cleanly. */
export function KeywordGroupDialog({
  open,
  onOpenChange,
  mode,
  initialName = "",
  onSubmit,
  submitError,
  submitting,
}: KeywordGroupDialogProps) {
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | undefined>(undefined);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setError("Give this group a name.");
      return;
    }
    setError(undefined);
    await onSubmit(name.trim());
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{mode === "create" ? "New keyword group" : "Rename group"}</DialogTitle>
            <DialogDescription>
              {mode === "create"
                ? "A topic cluster to hold keywords you add or import manually."
                : "This only changes the group's name — its keywords are unaffected."}
            </DialogDescription>
          </DialogHeader>
          <Input
            label="Group name"
            placeholder="e.g. Freight visibility"
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={error ?? submitError}
            autoFocus
          />
          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="sm" loading={submitting}>
              {mode === "create" ? "Create group" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
