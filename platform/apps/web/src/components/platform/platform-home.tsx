"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  Briefcase,
  Building,
  Gauge,
  ScrollText,
  ShieldCheck,
  TrendingUp,
  UsersRound,
} from "lucide-react";
import {
  Avatar,
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
  getInitials,
} from "@bebest/ui";
import { ErrorPanel } from "@/components/patterns/error-panel";
import { ApiError, apiClient } from "@/lib/api-client";
import { useAsyncData } from "@/lib/use-async-data";

/** `GET /api/platform/session` (apps/api/src/routes/platform/session.ts). */
interface PlatformSession {
  platformRole: "support" | "admin";
  user: { id: string; email: string; name: string };
}

const ROLE_COPY: Record<PlatformSession["platformRole"], string> = {
  support: "Read access across every organization. Phase 4 adds read-only “view as org” sessions.",
  admin: "Everything support can do, plus operational actions (retry/cancel jobs, plan overrides) as they ship.",
};

const PHASE_1 = [
  { icon: Gauge, label: "Overview", body: "Org, user and run KPIs plus a live capability matrix." },
  { icon: Building, label: "Organizations", body: "Search every org; members, plan, usage vs limits, recent runs." },
  { icon: UsersRound, label: "Users", body: "Find a person, see their memberships and sign-in history." },
  { icon: Briefcase, label: "Agencies", body: "Each agency and the client orgs it manages." },
  { icon: TrendingUp, label: "Growth", body: "Leads, deals, accounts and free-snapshot requests." },
  { icon: Activity, label: "Operations", body: "Crawls, AI runs and agent runs — failures and stuck jobs." },
  { icon: ScrollText, label: "Audit log", body: "Every customer and platform action, filterable." },
] as const;

export function PlatformHome() {
  const router = useRouter();
  const state = useAsyncData(() => apiClient.get<PlatformSession>("/platform/session"), []);
  const forbidden = state.status === "error" && state.error instanceof ApiError && state.error.status === 403;

  useEffect(() => {
    if (forbidden) router.replace("/overview");
  }, [forbidden, router]);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <CardTitle>Your platform access</CardTitle>
            <CardDescription>Confirmed by the API just now, from your account — not from your sign-in token.</CardDescription>
          </div>
          <ShieldCheck size={20} className="shrink-0 text-accent" aria-hidden />
        </CardHeader>
        <CardContent aria-live="polite">
          {state.status === "loading" && (
            <div className="flex items-center gap-4" aria-busy="true">
              <Skeleton className="size-10 rounded-full" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-3.5 w-48" />
                <Skeleton className="h-3 w-64" />
              </div>
            </div>
          )}

          {state.status === "error" &&
            (forbidden ? (
              <p role="status" className="text-[13px] text-muted-foreground">
                Your account doesn&apos;t have platform access. Taking you to your Overview…
              </p>
            ) : (
              <ErrorPanel
                compact
                title="Couldn't confirm platform access"
                message="The platform service didn't answer. Your access is unchanged — try again."
                onRetry={state.reload}
              />
            ))}

          {state.status === "success" && (
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-4">
                <Avatar fallback={getInitials(state.data.user.name)} />
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-medium text-foreground">{state.data.user.name}</p>
                  <p className="truncate text-[12.5px] text-muted-foreground">{state.data.user.email}</p>
                </div>
              </div>
              <div className="flex flex-col gap-1.5 sm:max-w-[360px] sm:items-end sm:text-right">
                <Badge variant="accent" dot>
                  Platform {state.data.platformRole}
                </Badge>
                <p className="text-[12.5px] leading-relaxed text-muted-foreground">{ROLE_COPY[state.data.platformRole]}</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <section
        aria-labelledby="platform-phase-1"
        className="rounded-xl border border-dashed border-border-strong/50 px-6 py-8 sm:px-8"
      >
        <div className="flex flex-col gap-2">
          <Badge variant="outline" size="sm" className="self-start">
            Arrives in Phase 1
          </Badge>
          <h2 id="platform-phase-1" className="font-display text-[19px] font-semibold tracking-[-0.01em] text-foreground">
            Platform overview arrives in Phase 1
          </h2>
          <p className="max-w-[62ch] text-[13.5px] leading-relaxed text-muted-foreground">
            Phase 0 puts the foundations in place: your staff role, an audited access guard on every platform request, and
            this view. No cross-organization numbers are shown until they come from the real platform API — these are the
            sections it will open up:
          </p>
        </div>
        <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {PHASE_1.map(({ icon: Icon, label, body }) => (
            <li key={label} className="flex gap-3 rounded-lg border border-border bg-surface px-4 py-3">
              <Icon size={16} className="mt-0.5 shrink-0 text-subtle-foreground" aria-hidden />
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-foreground">{label}</p>
                <p className="text-[12.5px] leading-relaxed text-muted-foreground">{body}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
