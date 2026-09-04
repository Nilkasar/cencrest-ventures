"use client";

import { useState, type FormEvent } from "react";
import { UserPlus } from "lucide-react";
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useToast,
} from "@bebest/ui";
import { OwnerProtectedError, TeamForbiddenError, inviteMember } from "@/data/team/client";
import { ASSIGNABLE_ROLES, ROLE_LABELS, type AssignableRole } from "@/data/team/types";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Mirrors SECURITY.md's per-role permission matrix in plain language — the
// same "pick a role, see what it grants" pattern `InviteClientDialog`
// (Epic 18) established for agency-client roles.
const ROLE_DESCRIPTIONS: Record<AssignableRole, string> = {
  admin: "Full access to this organization, including team, billing, and integrations.",
  analyst: "Can act on opportunities, content, and measurement — not billing or settings.",
  editor: "Can create and edit content and briefs — not billing or settings.",
  viewer: "Read-only access to this organization's data.",
};

/**
 * `POST /orgs/:slug/invitations` — sends a real invite email (via
 * `EmailSender`; `ConsoleEmailSender` in this environment logs the URL
 * instead of delivering it, same stand-in every other invite/magic-link
 * flow in this app uses). Requires `manage_team` (owner/admin) —
 * `disabled` mirrors that client-side so a viewer/analyst/editor sees why
 * the control is unavailable instead of a surprise 403; the backend 403 is
 * still the real enforcement if this check is ever bypassed.
 */
export function InviteTeamMemberDialog({
  slug,
  disabled,
  onInvited,
}: {
  slug: string;
  disabled: boolean;
  onInvited: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AssignableRole>("viewer");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const { toast } = useToast();

  function reset() {
    setEmail("");
    setRole("viewer");
    setError(undefined);
  }

  const trimmedEmail = email.trim();
  // Real-time, specific feedback mirroring the backend's own
  // `z.string().email()` — never only surfaced after a round trip.
  const emailFormatValid = trimmedEmail.length === 0 || EMAIL_PATTERN.test(trimmedEmail);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!trimmedEmail || !EMAIL_PATTERN.test(trimmedEmail)) {
      setError("Enter a valid email address.");
      return;
    }
    setSubmitting(true);
    setError(undefined);
    try {
      await inviteMember(slug, { email: trimmedEmail, role });
      toast({
        title: "Invitation sent",
        description: `${trimmedEmail} has 7 days to accept before it expires.`,
        variant: "success",
      });
      setOpen(false);
      reset();
      onInvited();
    } catch (err) {
      if (err instanceof OwnerProtectedError || err instanceof TeamForbiddenError) {
        setError(err.message);
      } else {
        setError("Couldn't send that invitation — try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  const trigger = (
    <Button variant="secondary" size="sm" disabled={disabled}>
      <UserPlus size={14} /> Invite team member
    </Button>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      {disabled ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={0} className="inline-flex">
              {trigger}
            </span>
          </TooltipTrigger>
          <TooltipContent>Only an organization owner or admin can invite team members.</TooltipContent>
        </Tooltip>
      ) : (
        <DialogTrigger asChild>{trigger}</DialogTrigger>
      )}
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Invite a team member</DialogTitle>
            <DialogDescription>
              They&apos;ll get an email with a link to join — it expires in 7 days if not accepted.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <Input
              type="email"
              label="Email address"
              placeholder="teammate@company.com"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                setError(undefined);
              }}
              error={!emailFormatValid ? "Enter a valid email address." : error}
              autoFocus
              required
            />
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="team-invite-role">Role</Label>
              <Select value={role} onValueChange={(value) => setRole(value as AssignableRole)}>
                <SelectTrigger id="team-invite-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ASSIGNABLE_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[12px] text-muted-foreground">{ROLE_DESCRIPTIONS[role]}</p>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              loading={submitting}
              disabled={!trimmedEmail || !emailFormatValid}
            >
              Send invitation
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
