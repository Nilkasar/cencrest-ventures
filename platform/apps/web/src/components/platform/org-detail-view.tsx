"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Activity, ArrowLeft, Building, ExternalLink, ScrollText } from "lucide-react";
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  cn,
  getInitials,
} from "@bebest/ui";
import { fetchPlatformOrg } from "@/data/platform/client";
import type { AgencyLink, PlatformOrgDetail, UsageKey, UsageMetric } from "@/data/platform/types";
import { formatDate } from "@/lib/format";
import { useAsyncData } from "@/lib/use-async-data";
import {
  Fact,
  InlineEmpty,
  KindBadge,
  PlanBadge,
  PlatformErrorState,
  PlatformRoleBadge,
  Progress,
  Section,
  ShortId,
  StatusBadge,
  TimeAgo,
  humanize,
} from "./platform-ui";

const USAGE_LABEL: Record<UsageKey, string> = {
  ai_queries_per_month: "AI queries this month",
  competitors_tracked: "Competitors tracked",
  queries_per_query_set: "Queries in active query set",
  team_members: "Team members",
  pages_analyzed: "Pages analyzed",
  snapshots_per_month: "Snapshots this month",
  agent_runs_per_month: "Agent runs this month",
  autonomy_level_max: "Max autonomy level",
  client_accounts: "Client accounts",
};
const USAGE_ORDER = Object.keys(USAGE_LABEL) as UsageKey[];

/** Platform → Organization detail: "What is this org, what does it use, and what has happened to it lately?" */
export function OrgDetailView({ orgId }: { orgId: string }) {
  const state = useAsyncData(() => fetchPlatformOrg(orgId), [orgId]);

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/platform/organizations"
        className="inline-flex w-fit items-center gap-1.5 rounded-sm text-[13px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft size={14} aria-hidden /> All organizations
      </Link>

      {state.status === "loading" && <DetailSkeleton />}
      {state.status === "error" && (
        <PlatformErrorState
          error={state.error}
          onRetry={state.reload}
          resource="this organization"
          notFound={
            <EmptyState
              icon={<Building size={20} />}
              title="Organization not found"
              description="No organization has this id. It may have been mistyped, or the link is from another environment."
              action={
                <Button variant="secondary" size="sm" asChild>
                  <Link href="/platform/organizations">Search organizations</Link>
                </Button>
              }
            />
          }
        />
      )}
      {state.status === "success" && (
        <RefreshOverlay active={state.isRefreshing}>
          <OrgDetail d={state.data} />
        </RefreshOverlay>
      )}
    </div>
  );
}

function OrgDetail({ d }: { d: PlatformOrgDetail }) {
  const org = d.organization;
  const runCount = d.recentRuns.aiRuns.length + d.recentRuns.crawlJobs.length + d.recentRuns.agentRuns.length;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 flex-col gap-2">
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-subtle-foreground">Organization</p>
          <h1 className="break-words font-display text-[26px] font-semibold tracking-[-0.015em] text-foreground">{org.name}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <KindBadge kind={org.kind} size="md" />
            <PlanBadge plan={d.subscription ? d.subscription.plan : null} size="md" />
            <StatusBadge status={org.status} size="md" />
            {org.deletedAt && (
              <Badge variant="danger" size="md">
                Deleted {formatDate(org.deletedAt)}
              </Badge>
            )}
          </div>
          <p className="text-[12.5px] text-muted-foreground">
            <span className="font-mono">{org.slug}</span> · created {formatDate(org.createdAt)} · <ShortId id={org.id} />
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" asChild>
            <Link href={`/platform/operations?orgId=${org.id}`}>
              <Activity size={13} aria-hidden /> Jobs
            </Link>
          </Button>
          <Button variant="secondary" size="sm" asChild>
            <Link href={`/platform/audit?orgId=${org.id}`}>
              <ScrollText size={13} aria-hidden /> Audit log
            </Link>
          </Button>
        </div>
      </header>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Section
            id="usage"
            title="Usage vs plan limits"
            description={`Effective plan: ${d.plan.slug}${d.subscription ? "" : " (no subscription row — treated as Free)"}.`}
          >
            <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
              {USAGE_ORDER.map((k) => (
                <LimitMeter key={k} label={USAGE_LABEL[k]} metric={d.usage[k]} />
              ))}
            </div>
          </Section>

          <Section id="members" title="Members" description={`${d.members.length} member${d.members.length === 1 ? "" : "s"}, oldest first.`}>
            {d.members.length === 0 ? (
              <InlineEmpty>This organization has no members — it can only be reached by staff or an agency link.</InlineEmpty>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Person</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Last sign-in</TableHead>
                    <TableHead>Joined</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {d.members.map((m) => (
                    <TableRow key={m.userId}>
                      <TableCell className="min-w-[220px]">
                        <div className="flex items-center gap-2.5">
                          <Avatar fallback={getInitials(m.name || m.email)} size="sm" />
                          <div className="min-w-0">
                            <Link
                              href={`/platform/users/${m.userId}`}
                              className="block truncate rounded-sm text-[13px] font-medium text-foreground hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              {m.name || m.email}
                            </Link>
                            <p className="truncate text-[12px] text-muted-foreground">{m.email}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1.5">
                          <Badge variant="outline" size="sm">
                            {humanize(m.role)}
                          </Badge>
                          <PlatformRoleBadge role={m.platformRole} />
                        </div>
                      </TableCell>
                      <TableCell>
                        <TimeAgo iso={m.lastLoginAt} empty="Never" />
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

          <Section
            id="runs"
            title="Recent runs"
            description="The latest 10 of each kind."
            action={
              <Link href={`/platform/operations?orgId=${d.organization.id}`} className="text-[12.5px] font-medium text-accent hover:underline">
                Open in Operations
              </Link>
            }
          >
            {runCount === 0 ? (
              <InlineEmpty>No AI runs, crawls or agent runs yet. They appear once onboarding starts the first baseline.</InlineEmpty>
            ) : (
              <RecentRuns runs={d.recentRuns} />
            )}
          </Section>

          <Section
            id="audit"
            title="Recent activity"
            description="The latest 20 audit events in this organization."
            action={
              <Link href={`/platform/audit?orgId=${d.organization.id}`} className="text-[12.5px] font-medium text-accent hover:underline">
                Full audit log
              </Link>
            }
          >
            {d.recentAudit.length === 0 ? (
              <InlineEmpty>No audit events recorded for this organization yet.</InlineEmpty>
            ) : (
              <ol className="flex flex-col divide-y divide-border">
                {d.recentAudit.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 py-2.5 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="font-mono text-[12.5px] text-foreground">{a.action}</p>
                      <p className="truncate text-[12px] text-muted-foreground">
                        {a.userEmail ?? humanize(a.actorType)}
                        {a.actorRole && ` · ${a.actorRole}`} · {humanize(a.entityType)}
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

        <aside className="flex min-w-0 flex-col gap-6" aria-label="Organization details">
          <Section id="subscription" title="Subscription">
            {d.subscription ? (
              <dl className="grid grid-cols-2 gap-4">
                <Fact label="Plan">{d.subscription.planName ?? d.subscription.plan}</Fact>
                <Fact label="Status">
                  <StatusBadge status={d.subscription.status} />
                </Fact>
                <Fact label="Period ends">{d.subscription.currentPeriodEnd ? formatDate(d.subscription.currentPeriodEnd) : "—"}</Fact>
                <Fact label="Trial ends">{d.subscription.trialEndsAt ? formatDate(d.subscription.trialEndsAt) : "—"}</Fact>
                <Fact label="Billing customer">{d.subscription.hasExternalCustomer ? "Linked" : "Not linked"}</Fact>
                {d.subscription.cancelledAt && <Fact label="Cancelled">{formatDate(d.subscription.cancelledAt)}</Fact>}
              </dl>
            ) : (
              <p className="text-[13px] leading-relaxed text-muted-foreground">No subscription row. Entitlements treat this organization as Free.</p>
            )}
          </Section>

          <Section id="brand" title="Brand">
            {d.brand ? (
              <dl className="flex flex-col gap-4">
                <Fact label="Name">{d.brand.name}</Fact>
                <Fact label="Website">
                  {d.brand.websiteUrl ? (
                    <a
                      href={d.brand.websiteUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex max-w-full items-center gap-1 break-all text-accent hover:underline"
                    >
                      {d.brand.websiteUrl.replace(/^https?:\/\//, "")}
                      <ExternalLink size={12} aria-hidden className="shrink-0" />
                      <span className="sr-only">(opens in a new tab)</span>
                    </a>
                  ) : (
                    "—"
                  )}
                </Fact>
                <Fact label="Industries">{d.brand.industries.length ? d.brand.industries.join(", ") : "—"}</Fact>
                <Fact label="Categories">{d.brand.categories.length ? d.brand.categories.join(", ") : "—"}</Fact>
              </dl>
            ) : (
              <p className="text-[13px] leading-relaxed text-muted-foreground">No brand set up — onboarding hasn&apos;t been completed.</p>
            )}
          </Section>

          <Section id="agency-links" title="Agency links">
            {d.agencyLinks.asAgency.length + d.agencyLinks.asClient.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">Not linked to any agency or client.</p>
            ) : (
              <div className="flex flex-col gap-4">
                {d.agencyLinks.asClient.length > 0 && <LinkList title="Managed by" links={d.agencyLinks.asClient} />}
                {d.agencyLinks.asAgency.length > 0 && <LinkList title="Manages" links={d.agencyLinks.asAgency} />}
              </div>
            )}
          </Section>
        </aside>
      </div>
    </div>
  );
}

function LimitMeter({ label, metric }: { label: string; metric: UsageMetric }) {
  const { used, limit } = metric;
  const tracked = used !== null;
  const bounded = limit !== null;
  const ratio = tracked && bounded && limit > 0 ? Math.min(1, used / limit) : 0;
  const over = tracked && bounded && used >= limit && limit > 0;
  const near = !over && ratio >= 0.8;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] text-foreground">{label}</span>
        <span className="whitespace-nowrap font-mono text-[12px] tabular-nums text-muted-foreground">
          {tracked ? used.toLocaleString() : "Not tracked"}
          {" / "}
          {bounded ? limit.toLocaleString() : "∞"}
        </span>
      </div>
      {tracked && bounded ? (
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-surface"
          role="meter"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={limit}
          aria-valuenow={Math.min(used, limit)}
        >
          <div
            className={cn("h-full rounded-full transition-[width] duration-300 ease-out motion-reduce:transition-none", over ? "bg-danger" : near ? "bg-warning" : "bg-accent")}
            style={{ width: `${ratio * 100}%` }}
          />
        </div>
      ) : (
        <div className="h-1.5 w-full rounded-full border border-dashed border-border" aria-hidden />
      )}
      {over && <p className="text-[11.5px] text-danger">At or over the plan limit</p>}
    </div>
  );
}

function LinkList({ title, links }: { title: string; links: AgencyLink[] }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="font-mono text-[10.5px] font-medium uppercase tracking-[0.1em] text-subtle-foreground">{title}</p>
      <ul className="flex flex-col gap-2">
        {links.map((l) => (
          <li key={l.id} className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <Link
                href={`/platform/organizations/${l.org.id}`}
                className="block truncate rounded-sm text-[13px] font-medium text-foreground hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {l.org.name}
              </Link>
              <p className="text-[12px] text-muted-foreground">
                {humanize(l.accessLevel)} access · since {formatDate(l.createdAt)}
              </p>
            </div>
            <StatusBadge status={l.status} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function RecentRuns({ runs }: { runs: PlatformOrgDetail["recentRuns"] }) {
  const first = runs.aiRuns.length ? "ai" : runs.crawlJobs.length ? "crawl" : "agent";
  return (
    <Tabs defaultValue={first}>
      <TabsList aria-label="Run type">
        <TabsTrigger value="ai">AI runs ({runs.aiRuns.length})</TabsTrigger>
        <TabsTrigger value="crawl">Crawls ({runs.crawlJobs.length})</TabsTrigger>
        <TabsTrigger value="agent">Agents ({runs.agentRuns.length})</TabsTrigger>
      </TabsList>
      <TabsContent value="ai">
        <RunTable
          empty="No AI visibility runs yet."
          head={["Run", "Status", "Progress", "Score", "Started"]}
          rows={runs.aiRuns.map((r) => ({
            key: r.id,
            cells: [
              <RunLabel key="l" title={r.providers.join(", ") || "—"} error={r.error} />,
              <StatusBadge key="s" status={r.status} />,
              <Progress key="p" done={r.completedJobs} total={r.totalJobs} failed={r.failedJobs} />,
              <span key="sc" className="font-mono text-[12.5px]">{r.aiVisibilityScore === null ? "—" : r.aiVisibilityScore.toFixed(1)}</span>,
              <TimeAgo key="t" iso={r.createdAt} />,
            ],
          }))}
        />
      </TabsContent>
      <TabsContent value="crawl">
        <RunTable
          empty="No website crawls yet."
          head={["Site", "Status", "Pages", "Started"]}
          rows={runs.crawlJobs.map((r) => ({
            key: r.id,
            cells: [
              <RunLabel key="l" title={r.rootUrl.replace(/^https?:\/\//, "")} error={r.error} />,
              <StatusBadge key="s" status={r.status} />,
              <Progress key="p" done={r.pagesCrawled} total={r.pagesFound} failed={r.pagesFailed} />,
              <TimeAgo key="t" iso={r.createdAt} />,
            ],
          }))}
        />
      </TabsContent>
      <TabsContent value="agent">
        <RunTable
          empty="No agent runs yet."
          head={["Agent", "Status", "Steps", "Started"]}
          rows={runs.agentRuns.map((r) => ({
            key: r.id,
            cells: [
              <RunLabel key="l" title={humanize(r.agentName)} sub={`Triggered by ${r.triggeredBy}`} error={r.error} />,
              <StatusBadge key="s" status={r.status} />,
              <Progress key="p" done={r.stepsCompleted} total={r.totalSteps} />,
              <TimeAgo key="t" iso={r.createdAt} />,
            ],
          }))}
        />
      </TabsContent>
    </Tabs>
  );
}

function RunTable({ head, rows, empty }: { head: string[]; rows: { key: string; cells: ReactNode[] }[]; empty: string }) {
  if (rows.length === 0) return <InlineEmpty>{empty}</InlineEmpty>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {head.map((h) => (
            <TableHead key={h}>{h}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.key}>
            {r.cells.map((c, i) => (
              <TableCell key={i} className={i === 0 ? "min-w-[180px] max-w-[320px]" : undefined}>
                {c}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function RunLabel({ title, sub, error }: { title: string; sub?: string; error: string | null }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[13px] text-foreground">{title}</p>
      {sub && <p className="truncate text-[12px] text-muted-foreground">{sub}</p>}
      {error && (
        <p className="line-clamp-2 text-[12px] text-danger" title={error}>
          {error}
        </p>
      )}
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading organization">
      <div className="flex flex-col gap-3 border-b border-border pb-6">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-7 w-64" />
        <div className="flex gap-2">
          <Skeleton className="h-6 w-20 rounded-full" />
          <Skeleton className="h-6 w-16 rounded-full" />
          <Skeleton className="h-6 w-16 rounded-full" />
        </div>
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-6">
          {[0, 1, 2].map((i) => (
            <Card key={i} className="p-5">
              <Skeleton className="mb-4 h-4 w-40" />
              <SkeletonText lines={4} />
            </Card>
          ))}
        </div>
        <div className="flex flex-col gap-6">
          {[0, 1].map((i) => (
            <Card key={i} className="p-5">
              <Skeleton className="mb-4 h-4 w-28" />
              <SkeletonText lines={3} />
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
