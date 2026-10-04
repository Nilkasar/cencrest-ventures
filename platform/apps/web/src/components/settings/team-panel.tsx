"use client";

import { useState } from "react";
import { Users } from "lucide-react";
import {
  Avatar,
  Badge,
  Button,
  EmptyState,
  RefreshOverlay,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  getInitials,
  useToast,
} from "@bebest/ui";
import { ErrorPanel } from "@/components/patterns/error-panel";
import { PageStack, Reveal } from "@/components/patterns/motion";
import { PropertyList, Section } from "@/components/patterns/section";
import { TableSkeleton, type SkeletonColumn } from "@/components/patterns/data-table";
import { typography } from "@/components/patterns/typography";
import { useAsyncData } from "@/lib/use-async-data";
import { formatDate, formatRelativeTime } from "@/lib/format";
import { useSession } from "@/lib/session-context";
import { OwnerProtectedError, TeamForbiddenError, changeMemberRole, loadTeamData, removeMember } from "@/data/team/client";
import { ASSIGNABLE_ROLES, ROLE_LABELS, isAssignableRole, type AssignableRole, type TeamMember } from "@/data/team/types";
import { ConfirmDialog } from "./confirm-dialog";
import { Notice } from "./form-controls";
import { InviteTeamMemberDialog, ROLE_DESCRIPTIONS } from "./invite-team-member-dialog";

const COLUMNS: SkeletonColumn[] = [
  { header: "Member", cell: "entity" },
  { header: "Role", cell: "badge" },
  { header: "Joined", cell: "meta" },
  { header: "", cell: "meta" },
];

/**
 * Settings > Team — the real Epic 0 org/membership routes
 * (`data/team/client.ts`). The org this screen reads and writes is
 * `state.data.slug`, resolved by `loadTeamData`. The session role gates the
 * controls client-side so a non-admin sees *why* they're unavailable; the
 * backend's `manage_team` 403 is still the real enforcement, and both
 * mutations surface it if this gate is ever bypassed.
 */
export function TeamPanel() {
  const { org, user } = useSession();
  const { reload, ...state } = useAsyncData(loadTeamData, []);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [pendingRemove, setPendingRemove] = useState<TeamMember | null>(null);
  const { toast } = useToast();

  const myRole = org?.role ?? "member";
  const canManageTeam = myRole === "owner" || myRole === "admin";

  function memberLabel(member: TeamMember): string {
    return member.name || member.email;
  }

  async function handleRoleChange(slug: string, member: TeamMember, role: AssignableRole) {
    if (role === member.role) return;
    setBusyUserId(member.userId);
    try {
      await changeMemberRole(slug, member.userId, role);
      toast({ title: `${memberLabel(member)} is now ${ROLE_LABELS[role]}`, variant: "success" });
      reload();
    } catch (err) {
      const description = err instanceof OwnerProtectedError || err instanceof TeamForbiddenError ? err.message : "Try again in a moment.";
      toast({ title: "Couldn't change role", description, variant: "danger" });
    } finally {
      setBusyUserId(null);
    }
  }

  async function handleRemove(slug: string, member: TeamMember) {
    setBusyUserId(member.userId);
    try {
      await removeMember(slug, member.userId);
      toast({ title: "Member removed", description: `${memberLabel(member)} no longer has access.`, variant: "success" });
      reload();
    } catch (err) {
      const description = err instanceof OwnerProtectedError || err instanceof TeamForbiddenError ? err.message : "Try again in a moment.";
      toast({ title: "Couldn't remove member", description, variant: "danger" });
    } finally {
      setBusyUserId(null);
    }
  }

  if (state.status === "error") {
    return <ErrorPanel title="Your team didn't load" message={state.error.message} onRetry={reload} />;
  }

  const data = state.status === "success" ? state.data : null;
  const members = data ? sortMembers(data.members, user?.id) : [];

  return (
    <PageStack>
      {!canManageTeam && (
        <Reveal>
          <Notice tone="locked" title="View only">
            You&apos;re signed in as {ROLE_LABELS[myRole as keyof typeof ROLE_LABELS] ?? myRole}. Only an owner or admin can invite people, change roles, or remove members.
          </Notice>
        </Reveal>
      )}

      <Section
        title="Members"
        description={
          data
            ? `${members.length} ${members.length === 1 ? "person has" : "people have"} access to ${org?.name ?? "this organization"}`
            : "People with access to this organization"
        }
        actions={data ? <InviteTeamMemberDialog slug={data.slug} disabled={!canManageTeam} onInvited={reload} /> : undefined}
        flush
      >
        {!data && <TableSkeleton columns={COLUMNS} rows={3} framed={false} label="Loading team…" />}

        {data && members.length === 0 && (
          <EmptyState
            compact
            icon={<Users size={18} />}
            title="No members found"
            description="You're a member of this organization yourself, so this list shouldn't be empty — reload to try again."
            action={
              <Button variant="secondary" size="sm" onClick={reload}>
                Reload
              </Button>
            }
            className="m-5"
          />
        )}

        {data && members.length > 0 && (
          <RefreshOverlay active={state.status === "success" && state.isRefreshing}>
            <Table framed={false}>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((member) => {
                  const isOwner = member.role === "owner";
                  const isYou = member.userId === user?.id;
                  const isBusy = busyUserId === member.userId;
                  const rowDisabled = !canManageTeam || (busyUserId !== null && !isBusy);
                  const label = memberLabel(member);

                  return (
                    <TableRow key={member.userId}>
                      <TableCell>
                        <div className="flex min-w-0 items-center gap-2.5">
                          <Avatar fallback={getInitials(label)} size="sm" />
                          <div className="min-w-0">
                            <p className="flex items-center gap-2 truncate text-[13px] font-medium text-foreground">
                              <span className="truncate">{member.name || member.email}</span>
                              {isYou && (
                                <Badge variant="accent" size="sm">
                                  You
                                </Badge>
                              )}
                            </p>
                            {member.name && <p className="truncate text-[12px] text-muted-foreground">{member.email}</p>}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        {!isOwner && isAssignableRole(member.role) && canManageTeam ? (
                          <Select
                            value={member.role}
                            onValueChange={(value) => handleRoleChange(data.slug, member, value as AssignableRole)}
                            disabled={rowDisabled}
                          >
                            <SelectTrigger className="h-8 w-[132px]" aria-label={`Role for ${label}`}>
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
                          <Badge variant="outline" size="sm" title={isOwner ? "Ownership can't be changed here" : undefined}>
                            {ROLE_LABELS[member.role]}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <time dateTime={member.joinedAt} title={formatDate(member.joinedAt)} className={typography.meta}>
                          {formatRelativeTime(member.joinedAt)}
                        </time>
                      </TableCell>
                      <TableCell className="text-right">
                        {!isOwner && canManageTeam && (
                          <Button variant="ghost" size="sm" onClick={() => setPendingRemove(member)} loading={isBusy} disabled={rowDisabled}>
                            Remove<span className="sr-only"> {label}</span>
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </RefreshOverlay>
        )}
      </Section>

      <Section title="What each role can do" description="Owners have full control, including billing. There is one owner per organization.">
        <PropertyList items={ASSIGNABLE_ROLES.map((role) => ({ label: ROLE_LABELS[role], value: ROLE_DESCRIPTIONS[role] }))} />
      </Section>

      <ConfirmDialog
        open={pendingRemove !== null}
        onOpenChange={(open) => !open && setPendingRemove(null)}
        title={`Remove ${pendingRemove ? memberLabel(pendingRemove) : "this member"}?`}
        description="They lose access to this organization immediately. Anything they created stays. You can invite them again later."
        confirmLabel="Remove member"
        onConfirm={() => (pendingRemove && data ? handleRemove(data.slug, pendingRemove) : undefined)}
      />
    </PageStack>
  );
}

/** You first, then the owner, then everyone else by join date. */
function sortMembers(members: TeamMember[], myId: string | undefined): TeamMember[] {
  const rank = (m: TeamMember) => (m.userId === myId ? 0 : m.role === "owner" ? 1 : 2);
  return [...members].sort((a, b) => rank(a) - rank(b) || a.joinedAt.localeCompare(b.joinedAt));
}
