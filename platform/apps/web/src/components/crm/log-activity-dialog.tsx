"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  useToast,
} from "@bebest/ui";
import { logActivity } from "@/data/crm/client";
import { currentUser } from "@/data/fixtures";
import type { ActivityType } from "@/data/crm/types";

const TYPE_LABEL: Record<Extract<ActivityType, "note" | "email" | "call">, string> = {
  note: "Note",
  email: "Email",
  call: "Call",
};

/**
 * Logs a note/email/call against a lead, an account, or (via `dealId`) a
 * deal — the one write path every detail screen shares. `metadata.dealId`
 * is how a deal-scoped note attaches without a separate activities table,
 * per the domain model in `docs/epics/01-crm.md`.
 */
export function LogActivityDialog({
  leadId,
  organizationId,
  dealId,
  onLogged,
  triggerLabel = "Log activity",
}: {
  leadId?: string;
  organizationId?: string;
  dealId?: string;
  onLogged: () => void;
  triggerLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<ActivityType>("note");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  function reset() {
    setType("note");
    setSubject("");
    setBody("");
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!subject.trim()) return;
    setSubmitting(true);
    try {
      await logActivity({
        leadId,
        organizationId,
        dealId,
        type,
        subject: subject.trim(),
        body: body.trim(),
        actor: { id: currentUser.id, name: currentUser.name },
      });
      toast({ title: "Activity logged", variant: "success" });
      setOpen(false);
      reset();
      onLogged();
    } catch {
      toast({ title: "Couldn't log that activity", description: "Try again in a moment.", variant: "danger" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          <Plus size={14} /> {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Log activity</DialogTitle>
            <DialogDescription>Adds a timestamped entry to this record&apos;s history.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="activity-type">Type</Label>
              <Select value={type} onValueChange={(value) => setType(value as ActivityType)}>
                <SelectTrigger id="activity-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(TYPE_LABEL) as (keyof typeof TYPE_LABEL)[]).map((value) => (
                    <SelectItem key={value} value={value}>
                      {TYPE_LABEL[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Input
              label="Subject"
              placeholder="e.g. Discovery call"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              autoFocus
              required
            />
            <Textarea
              label="Details"
              rows={3}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="What happened, what's next"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="sm" loading={submitting} disabled={!subject.trim()}>
              Log activity
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
