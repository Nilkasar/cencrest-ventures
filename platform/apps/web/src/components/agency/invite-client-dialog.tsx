"use client";

import { useState } from "react";
import { Handshake } from "lucide-react";
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
  useToast,
} from "@bebest/ui";
import {
  CannotLinkSelfError,
  ClientLimitReachedError,
  ClientOrgNotFoundError,
  LinkAlreadyExistsError,
  inviteAgencyClient,
} from "@/data/agency/client";
import type { AgencyClientLink, AgencyClientRole } from "@/data/agency/types";

const ROLE_OPTIONS: { value: AgencyClientRole; label: string; description: string }[] = [
  { value: "viewer", label: "Viewer", description: "Read-only access to this client's data." },
  { value: "analyst", label: "Analyst", description: "Can act on opportunities and content, not billing or settings." },
  { value: "admin", label: "Admin", description: "Full access to this client's org, same as their own admin." },
];

/**
 * `POST /agency/clients` — invites a client org by slug. Never creates an
 * active link (always `status: "pending"`, per the epic's "not agencies
 * silently claiming any org id" requirement) — the client org's own admin
 * must accept via the "Agencies managing us" tab before anything is
 * visible cross-org.
 */
export function InviteClientDialog({ onInvited }: { onInvited: (link: AgencyClientLink) => void }) {
  const [open, setOpen] = useState(false);
  const [slug, setSlug] = useState("");
  const [role, setRole] = useState<AgencyClientRole>("viewer");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const { toast } = useToast();

  function reset() {
    setSlug("");
    setRole("viewer");
    setError(undefined);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = slug.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setError(undefined);
    try {
      const link = await inviteAgencyClient({ clientOrgSlug: trimmed, role });
      toast({
        title: "Invitation sent",
        description: `${link.clientOrgName ?? trimmed} needs to accept before you can access their data.`,
        variant: "success",
      });
      setOpen(false);
      reset();
      onInvited(link);
    } catch (err) {
      if (
        err instanceof ClientOrgNotFoundError ||
        err instanceof CannotLinkSelfError ||
        err instanceof LinkAlreadyExistsError ||
        err instanceof ClientLimitReachedError
      ) {
        setError(err.message);
      } else {
        setError("Couldn't send that invitation — try again.");
      }
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
        <Button variant="primary" size="sm">
          <Handshake size={14} /> Invite a client
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Invite a client organization</DialogTitle>
            <DialogDescription>
              They&apos;ll need to accept from their own Settings before you can view or act on their data — this
              never grants access unilaterally.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <Input
              label="Client organization slug"
              placeholder="acme-co"
              value={slug}
              onChange={(event) => setSlug(event.target.value)}
              error={error}
              autoFocus
              required
            />
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="agency-role">Access level</Label>
              <Select value={role} onValueChange={(value) => setRole(value as AgencyClientRole)}>
                <SelectTrigger id="agency-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[12px] text-muted-foreground">
                {ROLE_OPTIONS.find((opt) => opt.value === role)?.description}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="sm" loading={submitting} disabled={!slug.trim()}>
              Send invitation
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
