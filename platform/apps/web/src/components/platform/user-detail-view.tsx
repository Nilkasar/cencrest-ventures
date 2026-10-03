"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Mail, ScrollText, UserX } from "lucide-react";
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  RefreshOverlay,
  Skeleton,
  SkeletonText,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  getInitials,
  useToast,
} from "@bebest/ui";
import { isForbidden, isNotFound, platformErrorMessage, sendUserMagicLink, fetchPlatformUser } from "@/data/platform/client";
import type { PlatformUserDetail } from "@/data/platform/types";
import { formatDate } from "@/lib/format";
import { useAsyncData } from "@/lib/use-async-data";
import {
  AdminOnly,
  ConfirmDialog,
  Fact,
  InlineEmpty,
  KindBadge,
  PlatformErrorState,
  PlatformRoleBadge,
  Section,
  ShortId,
  StatusBadge,
  TimeAgo,
  humanize,
} from "./platform-ui";

/** Platform → User detail: "Who is this, where do they belong, and can they get in?" */
export function UserDetailView({ userId }: { userId: string }) {
  const state = useAsyncData(() => fetchPlatformUser(userId), [userId]);

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/platform/users"
        className="inline-flex w-fit items-center gap-1.5 rounded-sm text-[13px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft size={14} aria-hidden /> All users
      </Link>

      {state.status === "loading" && <UserSkeleton />}
      {state.status === "error" && (
        <PlatformErrorState
          error={state.error}
          onRetry={state.reload}
          resource="this user"
          notFound={
            <EmptyState
              icon={<UserX size={20} />}
              title="User not found"
              description="No account has this id. It may have been mistyped, or the link is from another environment."
              action={
                <Button variant="secondary" size="sm" asChild>
                  <Link href="/platform/users">Search users</Link>
                </Button>
              }
            />
          }
        />
      )}
      {state.status === "success" && (
        <RefreshOverlay active={state.isRefreshing}>
          <UserDetail d={state.data} />
        </RefreshOverlay>
      )}
    </div>
  );
}

function UserDetail({ d }: { d: PlatformUserDetail }) {
  const u = d.user;
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <Avatar fallback={getInitials(u.name || u.email)} size="lg" />
          <div className="flex min-w-0 flex-col gap-1.5">
            <p className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-subtle-foreground">User</p>
            <h1 className="break-words font-display text-[24px] font-semibold tracking-[-0.015em] text-foreground">{u.name || u.email}</h1>
            <p className="break-all text-[13px] text-muted-foreground">{u.email}</p>
            <div className="flex flex-wrap items-center gap-2">
              <PlatformRoleBadge role={u.platformRole} size="md" />
              <Badge variant={u.emailVerified ? "success" : "warning"} size="md" dot>
                {u.emailVerified ? "Email verified" : "Email unverified"}
              </Badge>
              {u.deletedAt && (
                <Badge variant="danger" size="md">
                  Deleted {formatDate(u.deletedAt)}
                </Badge>
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" asChild>
            <Link href={`/platform/audit?userId=${u.id}`}>
              <ScrollText size={13} aria-hidden /> Audit log
            </Link>
          </Button>
          <SendSignInLink user={u} />
        </div>
      </header>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Section id="memberships" title="Organizations" description="Direct memberships. Agency access to client orgs isn't listed here.">
            {d.memberships.length === 0 ? (
              <InlineEmpty>Not a member of any organization. Signing in will start onboarding for a new one.</InlineEmpty>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Organization</TableHead>
                    <TableHead>Kind</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Joined</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {d.memberships.map((m) => (
                    <TableRow key={m.organizationId}>
                      <TableCell className="min-w-[200px]">
                        <Link
                          href={`/platform/organizations/${m.organizationId}`}
                          className="block rounded-sm text-[13px] font-medium text-foreground hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {m.organizationName}
                        </Link>
                        <p className="font-mono text-[12px] text-muted-foreground">{m.organizationSlug}</p>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1.5">
                          <KindBadge kind={m.organizationKind} />
                          {m.organizationStatus !== "active" && <StatusBadge status={m.organizationStatus} />}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" size="sm">
                          {humanize(m.role)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <TimeAgo iso={m.joinedAt} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Section>

          <Section id="user-audit" title="Recent activity" description="The latest 20 things this person did, sign-ins included.">
            {d.recentAudit.length === 0 ? (
              <InlineEmpty>No recorded activity yet.</InlineEmpty>
            ) : (
              <ol className="flex flex-col divide-y divide-border">
                {d.recentAudit.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 py-2.5 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="font-mono text-[12.5px] text-foreground">{a.action}</p>
                      <p className="text-[12px] text-muted-foreground">
                        {humanize(a.entityType)}
                        {a.organizationId && (
                          <>
                            {" · "}
                            <Link href={`/platform/organizations/${a.organizationId}`} className="text-accent hover:underline">
                              organization
                            </Link>
                          </>
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {a.result !== "success" && <StatusBadge status={a.result} />}
                      <TimeAgo iso={a.createdAt} />
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Section>
        </div>

        <aside className="flex min-w-0 flex-col gap-6" aria-label="Account details">
          <Section id="account" title="Account">
            <dl className="grid grid-cols-2 gap-4">
              <Fact label="Last sign-in">
                <TimeAgo iso={u.lastLoginAt} empty="Never" className="text-[13px] text-foreground" />
              </Fact>
              <Fact label="Joined">{formatDate(u.createdAt)}</Fact>
              <Fact label="Platform role">{humanize(u.platformRole)}</Fact>
              <Fact label="User id">
                <ShortId id={u.id} />
              </Fact>
            </dl>
          </Section>

          <Section id="auth-events" title="Auth events">
            {d.recentAuthEvents.length === 0 ? (
              <p className="text-[13px] leading-relaxed text-muted-foreground">
                No separate auth events. Sign-ins are recorded as <span className="font-mono">auth.login</span> in recent activity.
              </p>
            ) : (
              <ol className="flex flex-col gap-3">
                {d.recentAuthEvents.map((e) => (
                  <li key={e.id} className="flex flex-col gap-0.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[12.5px] text-foreground">{e.eventType}</span>
                      <TimeAgo iso={e.createdAt} />
                    </div>
                    {(e.ipAddress || e.userAgent) && (
                      <p className="truncate text-[11.5px] text-subtle-foreground" title={e.userAgent ?? undefined}>
                        {[e.ipAddress, e.userAgent].filter(Boolean).join(" · ")}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </Section>
        </aside>
      </div>
    </div>
  );
}

function SendSignInLink({ user }: { user: PlatformUserDetail["user"] }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const deleted = Boolean(user.deletedAt);

  async function send() {
    setBusy(true);
    try {
      const res = await sendUserMagicLink(user.id);
      setOpen(false);
      toast({ variant: "success", title: "Sign-in link sent", description: `A one-time sign-in link is on its way to ${res.email}.` });
    } catch (err) {
      setOpen(false);
      if (isForbidden(err)) {
        toast({ variant: "danger", title: "Only platform admins can send sign-in links", description: "The API checked your role and declined. Nothing was sent." });
      } else if (isNotFound(err)) {
        toast({ variant: "danger", title: "This account no longer exists", description: "Nothing was sent." });
      } else {
        toast({ variant: "danger", title: "Couldn't send the sign-in link", description: platformErrorMessage(err) });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <AdminOnly reason="Only platform admins can send sign-in links">
        {(disabled) => (
          <Button variant="primary" size="sm" onClick={() => setOpen(true)} disabled={disabled || deleted}>
            <Mail size={13} aria-hidden /> Send sign-in link
          </Button>
        )}
      </AdminOnly>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Send a sign-in link?"
        description={
          <p>
            BeBest will email a one-time sign-in link to <span className="font-medium text-foreground">{user.email}</span> — the same link they&apos;d get
            by asking for one. You never see the link. This is recorded in the audit log.
          </p>
        }
        confirmLabel="Send link"
        onConfirm={send}
        busy={busy}
      />
    </>
  );
}

function UserSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading user">
      <div className="flex items-center gap-4 border-b border-border pb-6">
        <Skeleton className="size-12 rounded-full" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-6 w-56" />
          <Skeleton className="h-3 w-40" />
        </div>
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Card className="p-5">
          <SkeletonText lines={5} />
        </Card>
        <Card className="p-5">
          <SkeletonText lines={4} />
        </Card>
      </div>
    </div>
  );
}
