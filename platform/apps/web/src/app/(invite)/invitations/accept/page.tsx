"use client";

import { Suspense, useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { AlertTriangle, ArrowRight, CheckCircle2, Clock, Link2Off, Mail, ShieldCheck, UserRound } from "lucide-react";
import { Badge, Button, Skeleton, SkeletonText } from "@bebest/ui";
import {
  acceptInvitation,
  AcceptInvitationError,
  InvitationNotFoundError,
  previewInvitation,
  type InvitationPreview,
} from "@/data/invitations/client";
import { ROLE_DESCRIPTIONS } from "@/components/settings/invite-team-member-dialog";
import { ROLE_LABELS, isAssignableRole, type MembershipRole } from "@/data/team/types";
import { apiClient } from "@/lib/api-client";
import { clearSession, getRefreshToken, hasStoredSession, loginUrlFor } from "@/lib/auth-state";
import { SessionProvider, useSession } from "@/lib/session-context";
import { useAsyncData } from "@/lib/use-async-data";

const EASE = [0.16, 1, 0.3, 1] as const;

// ── Signed in? ──────────────────────────────────────────────────────────────
// The refresh token lives in localStorage, which the server can't see — so
// this is `null` (unknown) during SSR/hydration and a boolean after. The
// `SessionProvider` is mounted ONLY when a session exists: with none, it
// would treat this public page as an expired session and bounce to /login.
const noopSubscribe = () => () => undefined;
function useHasSession(): boolean | null {
  return useSyncExternalStore(noopSubscribe, hasStoredSession, () => null);
}

function roleLabel(role: string): string {
  return ROLE_LABELS[role as MembershipRole] ?? role;
}

function roleDescription(role: string): string | undefined {
  return isAssignableRole(role as MembershipRole) ? ROLE_DESCRIPTIONS[role as keyof typeof ROLE_DESCRIPTIONS] : undefined;
}

async function signOutTo(path: string) {
  const refreshToken = getRefreshToken();
  if (refreshToken) await apiClient.post("/auth/logout", { refreshToken }).catch(() => undefined);
  clearSession();
  // A full navigation: every in-memory token and session cache goes with it.
  window.location.href = loginUrlFor(path);
}

// ── Building blocks ─────────────────────────────────────────────────────────

function Rise({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

/** A terminal state (expired, accepted, not found, mismatch…): icon, title,
 *  one honest sentence, and the one action that helps. */
function StatusPanel({
  tone,
  icon,
  title,
  children,
  actions,
}: {
  tone: "danger" | "warning" | "neutral" | "success";
  icon: ReactNode;
  title: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  const toneClass = {
    danger: "bg-danger-muted text-danger",
    warning: "bg-warning-muted text-warning",
    neutral: "bg-surface text-muted-foreground border border-border",
    success: "bg-success-muted text-success",
  }[tone];
  return (
    <Rise>
      <div className="flex flex-col items-center gap-6 text-center">
        <span className={`flex size-16 items-center justify-center rounded-full ${toneClass}`} aria-hidden="true">
          {icon}
        </span>
        <div className="flex flex-col gap-3">
          <h1 className="font-display text-[28px] font-semibold leading-[1.1] tracking-[-0.02em] text-foreground">{title}</h1>
          <div className="text-pretty text-[14.5px] leading-relaxed text-muted-foreground">{children}</div>
        </div>
        {actions && <div className="flex w-full flex-col gap-3">{actions}</div>}
      </div>
    </Rise>
  );
}

function InvitationCard({ preview }: { preview: InvitationPreview }) {
  const description = roleDescription(preview.role);
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-border bg-surface-raised p-5 shadow-sm">
      <div className="flex items-center gap-3.5">
        <span
          className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-accent font-display text-[20px] font-semibold text-accent-foreground"
          aria-hidden="true"
        >
          {preview.organizationName.trim().slice(0, 1).toUpperCase() || "B"}
        </span>
        <div className="min-w-0">
          <p className="font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-subtle-foreground">Organization</p>
          <p className="truncate font-display text-[19px] font-semibold tracking-[-0.015em] text-foreground">{preview.organizationName}</p>
        </div>
      </div>
      <dl className="grid grid-cols-1 gap-3 border-t border-border pt-4 text-[13px]">
        <div className="flex items-start gap-2.5">
          <dt className="sr-only">Role</dt>
          <ShieldCheck size={15} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <dd className="flex min-w-0 flex-col gap-1">
            <span className="flex items-center gap-2 text-foreground">
              Joining as{" "}
              <Badge variant="accent" size="sm">
                {roleLabel(preview.role)}
              </Badge>
            </span>
            {description && <span className="text-[12.5px] leading-relaxed text-muted-foreground">{description}</span>}
          </dd>
        </div>
        <div className="flex items-start gap-2.5">
          <dt className="sr-only">Invited by</dt>
          <UserRound size={15} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <dd className="text-foreground">
            Invited by <span className="font-medium">{preview.inviterName || "a team member"}</span>
          </dd>
        </div>
        <div className="flex items-start gap-2.5">
          <dt className="sr-only">Sent to</dt>
          <Mail size={15} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <dd className="text-foreground">
            Sent to <span className="font-mono text-[12.5px]">{preview.email}</span>
          </dd>
        </div>
      </dl>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex flex-col gap-6" role="status" aria-label="Loading invitation">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-8 w-64" />
        <SkeletonText lines={1} className="max-w-xs" />
      </div>
      <Skeleton className="h-[188px] w-full rounded-2xl" />
      <Skeleton className="h-12 w-full rounded-xl" />
    </div>
  );
}

// ── Accept (signed in) ──────────────────────────────────────────────────────

type AcceptOutcome = { kind: "idle" } | { kind: "accepting" } | { kind: "switching"; orgName: string } | { kind: "error"; error: AcceptInvitationError | Error };

function SignedInAccept({ token, preview, selfPath }: { token: string; preview: InvitationPreview; selfPath: string }) {
  const router = useRouter();
  const { user, loading, switchOrg } = useSession();
  const [outcome, setOutcome] = useState<AcceptOutcome>({ kind: "idle" });

  async function handleAccept() {
    setOutcome({ kind: "accepting" });
    try {
      const accepted = await acceptInvitation(token);
      setOutcome({ kind: "switching", orgName: accepted.organizationName });
      const org = await switchOrg(accepted.organizationSlug);
      router.replace(org.needsOnboarding ? "/onboarding" : "/overview");
    } catch (err) {
      setOutcome({ kind: "error", error: err instanceof Error ? err : new Error("Couldn't accept this invitation.") });
    }
  }

  const err = outcome.kind === "error" ? outcome.error : null;
  const code = err instanceof AcceptInvitationError ? err.code : null;

  if (code === "email_mismatch") {
    return (
      <StatusPanel
        tone="warning"
        icon={<UserRound size={24} />}
        title="Wrong account for this invitation"
        actions={
          <>
            <Button variant="primary" size="lg" className="h-12 w-full rounded-xl text-[15px]" onClick={() => signOutTo(selfPath)}>
              Sign in with {preview.email}
            </Button>
            <Button variant="ghost" size="lg" className="h-11 w-full rounded-xl" asChild>
              <Link href="/overview">Stay signed in as {user?.email ?? "this account"}</Link>
            </Button>
          </>
        }
      >
        <p>
          This invitation to <span className="font-medium text-foreground">{preview.organizationName}</span> was sent to{" "}
          <span className="font-mono text-[13px] text-foreground">{preview.email}</span>, but you&apos;re signed in as{" "}
          <span className="font-medium text-foreground">{user?.email ?? "a different account"}</span>. Sign out and sign back in with the
          invited address to accept it.
        </p>
      </StatusPanel>
    );
  }

  if (code === "already_accepted") return <AlreadyAccepted signedIn />;
  if (code === "expired") return <Expired preview={preview} />;
  if (code === "revoked" || code === "organization_deleted" || code === "invalid_token" || code === "invalid_request") {
    return <NotFound message={err?.message} signedIn />;
  }

  const busy = outcome.kind === "accepting" || outcome.kind === "switching";

  return (
    <div className="flex flex-col gap-7">
      <Rise>
        <div className="flex flex-col gap-3">
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-accent">You&apos;re invited</p>
          <h1 className="font-display text-[30px] font-semibold leading-[1.08] tracking-[-0.02em] text-foreground sm:text-[34px]">
            Join {preview.organizationName}
          </h1>
          <p className="text-[14.5px] leading-relaxed text-muted-foreground">
            {preview.inviterName || "A team member"} invited you to their BeBest workspace.
          </p>
        </div>
      </Rise>

      <Rise delay={0.08}>
        <InvitationCard preview={preview} />
      </Rise>

      <Rise delay={0.14}>
        <div className="flex flex-col gap-3">
          {err && (
            <p role="alert" className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-muted px-3.5 py-2.5 text-[13px] text-foreground">
              <AlertTriangle size={14} className="mt-0.5 shrink-0 text-danger" aria-hidden="true" />
              {err.message}
            </p>
          )}
          <Button
            variant="primary"
            size="lg"
            className="h-12 w-full rounded-xl text-[15px] shadow-md"
            onClick={handleAccept}
            loading={busy}
            disabled={loading || busy}
          >
            {outcome.kind === "switching" ? `Opening ${outcome.orgName}…` : "Accept invitation"}
            {!busy && <ArrowRight size={16} aria-hidden="true" />}
          </Button>
          <p className="text-center text-[12.5px] text-muted-foreground">
            {loading ? (
              <span className="inline-block h-3 w-40 animate-pulse rounded bg-foreground/10 align-middle" aria-hidden="true" />
            ) : (
              <>
                Signed in as <span className="font-medium text-foreground">{user?.email}</span> ·{" "}
                <button
                  type="button"
                  onClick={() => signOutTo(selfPath)}
                  className="inline-flex min-h-[32px] items-center rounded font-medium text-foreground underline-offset-4 hover:text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Not you?
                </button>
              </>
            )}
          </p>
        </div>
      </Rise>
    </div>
  );
}

// ── Terminal states ─────────────────────────────────────────────────────────

function AlreadyAccepted({ signedIn }: { signedIn: boolean }) {
  return (
    <StatusPanel
      tone="success"
      icon={<CheckCircle2 size={24} />}
      title="Invitation already accepted"
      actions={
        <Button variant="primary" size="lg" className="h-12 w-full rounded-xl text-[15px]" asChild>
          <Link href={signedIn ? "/overview" : "/login"}>{signedIn ? "Go to your workspace" : "Sign in"}</Link>
        </Button>
      }
    >
      <p>This invitation has already been used. If it was you, sign in to reach the organization from the workspace switcher.</p>
    </StatusPanel>
  );
}

function Expired({ preview }: { preview: InvitationPreview }) {
  return (
    <StatusPanel tone="warning" icon={<Clock size={24} />} title="This invitation has expired">
      <p>
        Invitations are valid for 7 days. Ask <span className="font-medium text-foreground">{preview.inviterName || "the person who invited you"}</span>{" "}
        to send a new one to <span className="font-mono text-[13px] text-foreground">{preview.email}</span> from Settings › Team.
      </p>
    </StatusPanel>
  );
}

function NotFound({ message, signedIn }: { message?: string; signedIn: boolean | null }) {
  return (
    <StatusPanel
      tone="neutral"
      icon={<Link2Off size={24} />}
      title="This invitation isn't valid"
      actions={
        <Button variant="secondary" size="lg" className="h-11 w-full rounded-xl" asChild>
          <Link href={signedIn ? "/overview" : "/login"}>{signedIn ? "Go to your workspace" : "Go to sign in"}</Link>
        </Button>
      }
    >
      <p>{message ?? "The link may have been revoked, or copied incorrectly. Ask the person who invited you to send a new one."}</p>
    </StatusPanel>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

function AcceptInvitationContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const signedIn = useHasSession();
  const selfPath = `/invitations/accept?token=${encodeURIComponent(token)}`;

  const { reload, ...state } = useAsyncData(
    () => (token ? previewInvitation(token) : Promise.reject(new InvitationNotFoundError("This link is missing its invitation token."))),
    [token],
  );

  if (state.status === "loading" || signedIn === null) return <LoadingState />;

  if (state.status === "error") {
    if (state.error instanceof InvitationNotFoundError) return <NotFound message={state.error.message} signedIn={signedIn} />;
    return (
      <StatusPanel
        tone="danger"
        icon={<AlertTriangle size={24} />}
        title="Couldn't load this invitation"
        actions={
          <Button variant="primary" size="lg" className="h-12 w-full rounded-xl" onClick={reload}>
            Try again
          </Button>
        }
      >
        <p>{state.error.message}</p>
      </StatusPanel>
    );
  }

  const preview = state.data;
  if (preview.accepted) return <AlreadyAccepted signedIn={signedIn} />;
  if (preview.expired) return <Expired preview={preview} />;

  if (signedIn) {
    return (
      <SessionProvider>
        <SignedInAccept token={token} preview={preview} selfPath={selfPath} />
      </SessionProvider>
    );
  }

  return (
    <div className="flex flex-col gap-7">
      <Rise>
        <div className="flex flex-col gap-3">
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-accent">You&apos;re invited</p>
          <h1 className="font-display text-[30px] font-semibold leading-[1.08] tracking-[-0.02em] text-foreground sm:text-[34px]">
            Join {preview.organizationName}
          </h1>
          <p className="text-[14.5px] leading-relaxed text-muted-foreground">
            {preview.inviterName || "A team member"} invited you to their BeBest workspace. Sign in to accept.
          </p>
        </div>
      </Rise>
      <Rise delay={0.08}>
        <InvitationCard preview={preview} />
      </Rise>
      <Rise delay={0.14}>
        <div className="flex flex-col gap-3">
          <Button variant="primary" size="lg" className="h-12 w-full rounded-xl text-[15px] shadow-md" asChild>
            <Link href={loginUrlFor(selfPath)}>
              Sign in to accept <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </Button>
          <p className="text-center text-[12.5px] leading-relaxed text-muted-foreground">
            Use <span className="font-mono text-foreground">{preview.email}</span> — the address this invitation was sent to. New to BeBest? Signing in
            creates your account.
          </p>
        </div>
      </Rise>
    </div>
  );
}

export default function AcceptInvitationPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <AcceptInvitationContent />
    </Suspense>
  );
}
