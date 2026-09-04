"use client";

import { useState } from "react";
import { Users } from "lucide-react";
import {
  Avatar,
  Badge,
  Button,
  EmptyState,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  getInitials,
  useToast,
} from "@bebest/ui";
import { ErrorPanel } from "@/components/patterns/error-panel";
import { useAsyncData } from "@/lib/use-async-data";
import { formatDate } from "@/lib/format";
import { currentOrganization, currentUser } from "@/data/fixtures";
import { OwnerProtectedError, TeamForbiddenError, changeMemberRole, loadTeamData, removeMember } from "@/data/team/client";
import { ASSIGNABLE_ROLES, ROLE_LABELS, isAssignableRole, type AssignableRole, type TeamMember } from "@/data/team/types";
import { InviteTeamMemberDialog } from "./invite-team-member-dialog";

/**
 * Settings > Team. Wires the real Epic 0 org/membership routes
 * (`data/team/client.ts`) — replaces the "invites are stubbed until Epic
 * 0's auth backend ships" fixture note a route-wiring audit flagged, even
 * though that backend has been real, tested, and VERIFIED since Wave 1.
 *
 * `currentOrganization` (fixture) still supplies the name/plan label in
 * the header line — the same decorative-only use `BillingPanel`/
 * `IntegrationsPanel` already make of `currentUser.role`. The org this
 * screen actually reads and writes is `state.data.slug`, resolved for real
 * by `loadTeamData` (see `data/team/client.ts`'s header comment for why
 * there's no wired "home org" session to read this from instead yet).
 * `currentUser.role` gates the mutating controls the same fixture-backed
 * way every other Settings panel does — real enforcement is the backend's
 * `manage_team` 403, which `handleRoleChange`/`handleRemove` below also
 * catch and surface, so the UI stays honest even if this client-side gate
 * is ever bypassed.
 */
export function TeamPanel() {
  const { reload, ...state } = useAsyncData(loadTeamData, []);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const { toast } = useToast();

  const canManageTeam = currentUser.role === "owner" || currentUser.role === "admin";

  function memberLabel(member: TeamMember): string {
    return member.name || member.email;
  }

  async function handleRoleChange(slug: string, member: TeamMember, role: AssignableRole) {
    if (role === member.role) return;
    setBusyUserId(member.userId);
    try {
      await changeMemberRole(slug, member.userId, role);
      toast({ title: `${memberLabel(member)}'s role is now ${ROLE_LABELS[role]}`, variant: "success" });
      reload();
    } catch (err) {
      if (err instanceof OwnerProtectedError || err instanceof TeamForbiddenError) {
        toast({ title: "Couldn't change role", description: err.message, variant: "danger" });
      } else {
        toast({ title: "Couldn't change role", description: "Try again in a moment.", variant: "danger" });
      }
    } finally {
      setBusyUserId(null);
    }
  }

  async function handleRemove(slug: string, member: TeamMember) {
    const confirmed = window.confirm(`Remove ${memberLabel(member)} from this organization? They'll immediately lose access.`);
    if (!confirmed) return;
    setBusyUserId(member.userId);
    try {
      await removeMember(slug, member.userId);
      toast({ title: "Member removed", description: `${memberLabel(member)} no longer has access.`, variant: "success" });
      reload();
    } catch (err) {
      if (err instanceof OwnerProtectedError || err instanceof TeamForbiddenError) {
        toast({ title: "Couldn't remove member", description: err.message, variant: "danger" });
      } else {
        toast({ title: "Couldn't remove member", description: "Try again in a moment.", variant: "danger" });
      }
    } finally {
      setBusyUserId(null);
    }
  }

  if (state.status === "loading") {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-5 w-64" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    );
  }

  if (state.status === "error") {
    return <ErrorPanel message={state.error.message} onRetry={reload} />;
  }

  const { slug, members } = state.data;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] text-muted-foreground">
          {currentOrganization.name} · {currentOrganization.plan} plan · {members.length} member{members.length === 1 ? "" : "s"}
        </p>
        <InviteTeamMemberDialog slug={slug} disabled={!canManageTeam} onInvited={reload} />
      </div>

      {!canManageTeam && (
        <p className="text-[12.5px] text-subtle-foreground">
          You&apos;re viewing the team as {currentUser.role}. Only an organization owner or admin can invite, change
          roles, or remove members.
        </p>
      )}

      {members.length === 0 ? (
        <EmptyState
          compact
          icon={<Users size={18} />}
          eyebrow="Team"
          title="No members found"
          description="This shouldn't normally happen — you're a member of this organization yourself. Try reloading."
          action={
            <Button variant="outline" size="sm" onClick={reload}>
              Reload
            </Button>
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Member</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((member) => {
              const isOwner = member.role === "owner";
              const isBusy = busyUserId === member.userId;
              const rowDisabled = !canManageTeam || (busyUserId !== null && !isBusy);

              return (
                <TableRow key={member.userId}>
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <Avatar fallback={getInitials(memberLabel(member))} size="sm" />
                      <span className="font-medium">{member.name || "—"}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{member.email}</TableCell>
                  <TableCell>
                    {isOwner ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span tabIndex={0} className="inline-flex">
                            <Badge variant="accent" size="sm">
                              Owner
                            </Badge>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>The owner&apos;s role can&apos;t be changed here.</TooltipContent>
                      </Tooltip>
                    ) : isAssignableRole(member.role) ? (
                      <Select
                        value={member.role}
                        onValueChange={(value) => handleRoleChange(slug, member, value as AssignableRole)}
                        disabled={rowDisabled}
                      >
                        <SelectTrigger className="w-[130px]" aria-label={`Role for ${memberLabel(member)}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ASSIGNABLE_ROLES.map((role) => (
                            <SelectItem key={role} value={role}>
                              {ROLE_LABELS[role]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Badge variant="neutral" size="sm">
                        {ROLE_LABELS[member.role]}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(member.joinedAt)}</TableCell>
                  <TableCell className="text-right">
                    {isOwner ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span tabIndex={0} className="inline-flex">
                            <Button variant="outline" size="sm" disabled>
                              Remove
                            </Button>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>The owner can&apos;t be removed.</TooltipContent>
                      </Tooltip>
                    ) : (
                      <Button variant="outline" size="sm" onClick={() => handleRemove(slug, member)} loading={isBusy} disabled={rowDisabled}>
                        Remove
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
