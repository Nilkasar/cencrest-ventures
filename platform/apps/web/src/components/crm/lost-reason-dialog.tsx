"use client";

import { useState } from "react";
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input } from "@bebest/ui";

/**
 * The one way a deal moves to Lost — from the board (drag or "Move to"
 * menu) and from the deal page alike — so a reason is always captured
 * first. The reason goes into the stage-change audit log.
 */
export function LostReasonDialog({
  open,
  dealTitle,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  /** Shown in the description so it's clear which deal is being closed. */
  dealTitle?: string | null;
  onCancel: () => void;
  /** Resolves once the move has been handed off; the dialog closes after. */
  onConfirm: (reason: string) => Promise<void> | void;
}) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function close() {
    setReason("");
    onCancel();
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = reason.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      await onConfirm(trimmed);
      setReason("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Why was this lost?</DialogTitle>
            <DialogDescription>
              {dealTitle ? `Moving “${dealTitle}” to Lost. ` : ""}
              The reason is recorded in the audit log and shown on the deal.
            </DialogDescription>
          </DialogHeader>
          <Input
            label="Lost reason"
            placeholder="e.g. Went with an incumbent agency"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            autoFocus
            required
          />
          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" variant="danger" size="sm" loading={submitting} disabled={!reason.trim()}>
              Mark lost
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
