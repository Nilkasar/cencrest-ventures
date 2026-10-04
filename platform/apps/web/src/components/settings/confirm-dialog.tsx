"use client";

import { useState, type ReactNode } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bebest/ui";

/**
 * A real confirmation dialog for destructive or consequential actions
 * (remove a member, revoke a grant, disconnect a source, change plan) —
 * replaces `window.confirm`, which can't be styled, can't say what happens
 * next, and blocks the main thread.
 *
 * Controlled: the caller owns `open` (usually "the item pending
 * confirmation" in state). `onConfirm` may be async; the confirm button
 * shows a spinner until it settles, and the dialog closes on success.
 * Failures are the caller's to report (toast), and the dialog closes
 * either way so the page behind it shows the fresh state.
 *
 * Candidate for `components/patterns/` — kept here because that folder is
 * outside this page group's scope.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  tone = "danger",
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  /** `danger` for anything that removes access or data; `primary` otherwise. */
  tone?: "danger" | "primary";
  onConfirm: () => Promise<void> | void;
  children?: ReactNode;
}) {
  const [pending, setPending] = useState(false);

  async function handleConfirm() {
    setPending(true);
    try {
      await onConfirm();
    } finally {
      setPending(false);
      onOpenChange(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
        <DialogFooter>
          <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button type="button" variant={tone} size="sm" onClick={handleConfirm} loading={pending}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
