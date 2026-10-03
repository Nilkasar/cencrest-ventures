"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Activity, Bot, Camera, Globe, Hourglass, Radar, X } from "lucide-react";
import {
  Badge,
  Button,
  EmptyState,
  Pagination,
  RefreshOverlay,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
  useToast,
} from "@bebest/ui";
import { PageHeader } from "@/components/patterns/page-header";
import { PLATFORM_PAGE_SIZE, apiErrorBody, cancelPlatformJob, fetchPlatformJobs, isForbidden, platformErrorMessage } from "@/data/platform/client";
import { JOB_STATUSES, JOB_TYPES, type JobType, type PlatformJob } from "@/data/platform/types";
import { ApiError } from "@/lib/api-client";
import { useAsyncData } from "@/lib/use-async-data";
import {
  ALL,
  AdminOnly,
  ConfirmDialog,
  FilterBar,
  FilterSelect,
  PlatformErrorState,
  Progress,
  RefreshingHint,
  ShortId,
  StatusBadge,
  TableSkeleton,
  TimeAgo,
  humanize,
  useRememberedLabel,
} from "./platform-ui";

const TYPE_META: Record<JobType, { label: string; icon: typeof Globe }> = {
  crawl: { label: "Crawl", icon: Globe },
  ai_run: { label: "AI run", icon: Radar },
  agent_run: { label: "Agent run", icon: Bot },
  snapshot: { label: "Snapshot", icon: Camera },
};
const TYPE_OPTIONS = JOB_TYPES.map((t) => ({ value: t, label: TYPE_META[t].label }));
const STATUS_OPTIONS = JOB_STATUSES.map((s) => ({ value: s, label: humanize(s) }));
const COLUMNS = ["Job", "Organization", "Status", "Progress", "Created", ""];
/** jobs.ts JOB_SPECS[type].cancelStatus — what a cancel turns the row into. */
const CANCEL_STATUS: Record<JobType, string> = { crawl: "cancelled", ai_run: "failed", agent_run: "failed", snapshot: "failed" };

interface Override {
  status: string;
  error: string | null;
  pending: boolean;
}

export interface OperationsInitial {
  type?: string;
  status?: string;
  orgId?: string;
  stuck?: boolean;
}

/** Platform → Operations: "What background work is running, failing or stuck — and can I clear it?" */
export function OperationsView({ initial }: { initial: OperationsInitial }) {
  const { toast } = useToast();
  const [type, setType] = useState(initial.type && (JOB_TYPES as readonly string[]).includes(initial.type) ? initial.type : ALL);
  const [status, setStatus] = useState(initial.status && (JOB_STATUSES as readonly string[]).includes(initial.status) ? initial.status : ALL);
  const [orgId, setOrgId] = useState(initial.orgId ?? "");
  const [stuck, setStuck] = useState(Boolean(initial.stuck));
  const [page, setPage] = useState(1);
  const [overrides, setOverrides] = useState<Record<string, Override>>({});
  const [confirming, setConfirming] = useState<PlatformJob | null>(null);

  const state = useAsyncData(
    () => fetchPlatformJobs({ type: type === ALL ? undefined : type, status: status === ALL ? undefined : status, orgId: orgId || undefined, stuck, page }),
    [type, status, orgId, stuck, page],
  );
  const data = state.status === "success" ? state.data : null;

  // Fresh server rows supersede settled optimistic overrides (in-flight ones stay).
  const [prevData, setPrevData] = useState(data);
  if (prevData !== data) {
    setPrevData(data);
    setOverrides((o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v.pending)));
  }

  // Keep the URL shareable (and Back-button friendly) without a navigation.
  useEffect(() => {
    const params = new URLSearchParams();
    if (type !== ALL) params.set("type", type);
    if (status !== ALL) params.set("status", status);
    if (orgId) params.set("orgId", orgId);
    if (stuck) params.set("stuck", "true");
    const s = params.toString();
    window.history.replaceState(null, "", s ? `?${s}` : window.location.pathname);
  }, [type, status, orgId, stuck]);

  const filtered = type !== ALL || status !== ALL || orgId !== "" || stuck;
  const orgName = useRememberedLabel(orgId, data?.items.find((j) => j.organizationId === orgId)?.organizationName);

  function clear() {
    setType(ALL);
    setStatus(ALL);
    setOrgId("");
    setStuck(false);
    setPage(1);
  }

  async function cancel(job: PlatformJob) {
    const key = `${job.type}:${job.id}`;
    setConfirming(null);
    setOverrides((o) => ({ ...o, [key]: { status: CANCEL_STATUS[job.type], error: "Cancelling…", pending: true } }));
    try {
      const res = await cancelPlatformJob(job.type, job.id);
      setOverrides((o) => ({ ...o, [key]: { status: res.status, error: res.error, pending: false } }));
      toast({ variant: "success", title: `${TYPE_META[job.type].label} cancelled`, description: `Was ${res.previousStatus}; now ${res.status}. Recorded in the audit log.` });
      state.reload();
    } catch (err) {
      setOverrides((o) => {
        const { [key]: _drop, ...rest } = o;
        void _drop;
        return rest;
      });
      if (err instanceof ApiError && err.status === 409) {
        const now = apiErrorBody(err)?.status;
        toast({
          variant: "warning",
          title: "That job already finished",
          description: now ? `It's ${now} now, so there was nothing to cancel.` : "It's no longer queued or running, so there was nothing to cancel.",
        });
        state.reload();
      } else if (isForbidden(err)) {
        toast({ variant: "danger", title: "Only platform admins can cancel jobs", description: "The API checked your role and declined. The job is unchanged." });
      } else {
        toast({ variant: "danger", title: "Couldn't cancel the job", description: platformErrorMessage(err) });
      }
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Platform"
        title="Operations"
        description="Crawls, AI runs, agent runs and free-snapshot jobs across every organization, newest first. A job is stuck when it has been queued or running for more than 30 minutes."
      />
      <div className="flex flex-col gap-4">
        <FilterBar onClear={clear} active={filtered}>
          <button
            type="button"
            aria-pressed={stuck}
            onClick={() => {
              setStuck((s) => !s);
              setPage(1);
            }}
            className={cn(
              "inline-flex h-10 items-center gap-2 rounded-md border px-3 text-[13px] font-medium transition-colors sm:h-9",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              stuck ? "border-warning/60 bg-warning-muted text-warning" : "border-border bg-surface-raised text-foreground hover:border-border-strong",
            )}
          >
            <Hourglass size={14} aria-hidden /> Stuck only
          </button>
          <FilterSelect label="Filter by job type" value={type} onChange={(v) => { setType(v); setPage(1); }} options={TYPE_OPTIONS} allLabel="All job types" />
          <FilterSelect label="Filter by status" value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={STATUS_OPTIONS} allLabel="All statuses" />
          {orgId && (
            <Badge variant="outline" size="md" className="h-9 gap-1 pr-1">
              Org: {orgName ?? orgId.slice(0, 8)}
              <button
                type="button"
                onClick={() => {
                  setOrgId("");
                  setPage(1);
                }}
                aria-label="Remove organization filter"
                className="flex size-7 items-center justify-center rounded-full hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X size={12} aria-hidden />
              </button>
            </Badge>
          )}
          <div className="sm:ml-auto">
            <RefreshingHint active={state.isRefreshing} />
          </div>
        </FilterBar>

        {state.status === "loading" && <TableSkeleton columns={COLUMNS.slice(0, 5)} label="Loading jobs" />}
        {state.status === "error" && <PlatformErrorState error={state.error} onRetry={state.reload} resource="jobs" />}

        {data && data.items.length === 0 && (
          <EmptyState
            compact
            icon={stuck ? <Hourglass size={18} /> : <Activity size={18} />}
            title={stuck ? "Nothing is stuck" : filtered ? "No jobs match" : "No jobs yet"}
            description={
              stuck
                ? "No job has been queued or running for more than 30 minutes. Background work is moving."
                : filtered
                  ? "No job matches these filters. Status values differ by type — snapshots use pending/processing/complete."
                  : "Jobs appear here as organizations run crawls, AI visibility runs and agents."
            }
            action={
              filtered ? (
                <Button variant="secondary" size="sm" onClick={clear}>
                  Show all jobs
                </Button>
              ) : undefined
            }
          />
        )}

        {data && data.items.length > 0 && (
          <RefreshOverlay active={state.isRefreshing} className="flex flex-col gap-3">
            <Table>
              <caption className="sr-only">Background jobs, newest first</caption>
              <TableHeader>
                <TableRow>
                  {COLUMNS.map((c, i) => (
                    <TableHead key={i}>{c || <span className="sr-only">Actions</span>}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((job) => {
                  const key = `${job.type}:${job.id}`;
                  const o = overrides[key];
                  const shownStatus = o?.status ?? job.status;
                  const shownError = o ? o.error : job.error;
                  const cancellable = !o && job.cancellable;
                  const Icon = TYPE_META[job.type].icon;
                  return (
                    <TableRow key={key} className={cn(o?.pending && "opacity-70")}>
                      <TableCell className="min-w-[220px] max-w-[340px]">
                        <div className="flex items-start gap-2.5">
                          <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-surface text-muted-foreground" aria-hidden>
                            <Icon size={13} />
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-[13px] text-foreground" title={job.label ?? undefined}>
                              <span className="font-medium">{TYPE_META[job.type].label}</span>
                              {job.label && <span className="text-muted-foreground"> · {job.label}</span>}
                            </p>
                            <ShortId id={job.id} />
                            {shownError && (
                              <p className={cn("mt-0.5 line-clamp-2 text-[12px]", o?.pending ? "text-muted-foreground" : "text-danger")} title={shownError}>
                                {shownError}
                              </p>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="min-w-[140px]">
                        {job.organizationId ? (
                          <Link href={`/platform/organizations/${job.organizationId}`} className="text-[13px] text-foreground hover:text-accent hover:underline">
                            {job.organizationName ?? job.organizationId.slice(0, 8)}
                          </Link>
                        ) : (
                          <span className="text-[12.5px] text-subtle-foreground">{job.type === "snapshot" ? "Pre-signup" : "—"}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <StatusBadge status={shownStatus} />
                          {job.stuck && !o && (
                            <Badge variant="warning" size="sm">
                              Stuck
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{job.progress ? <Progress done={job.progress.done} total={job.progress.total} failed={job.progress.failed} /> : <span className="text-[12.5px] text-subtle-foreground">—</span>}</TableCell>
                      <TableCell>
                        <TimeAgo iso={job.createdAt} />
                        {job.startedAt && (
                          <p className="text-[11.5px] text-subtle-foreground">
                            started <TimeAgo iso={job.startedAt} className="text-[11.5px] text-subtle-foreground" />
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {cancellable && (
                          <AdminOnly reason="Only platform admins can cancel jobs">
                            {(disabled) => (
                              <Button variant="outline" size="sm" disabled={disabled} onClick={() => setConfirming(job)} aria-label={`Cancel ${TYPE_META[job.type].label} ${job.label ?? job.id}`}>
                                Cancel
                              </Button>
                            )}
                          </AdminOnly>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <Pagination page={page} pageSize={PLATFORM_PAGE_SIZE} total={data.total} onPageChange={setPage} itemLabel="jobs" />
          </RefreshOverlay>
        )}
      </div>

      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => !open && setConfirming(null)}
        title={`Cancel this ${confirming ? TYPE_META[confirming.type].label.toLowerCase() : "job"}?`}
        tone="danger"
        description={
          confirming && (
            <div className="flex flex-col gap-2">
              <p>
                The job row moves to <span className="font-mono text-foreground">{CANCEL_STATUS[confirming.type]}</span> with the reason
                &ldquo;Cancelled by platform staff&rdquo;
                {confirming.organizationName ? ` in ${confirming.organizationName}` : ""}. The organization sees it as ended.
              </p>
              <p>
                It can&apos;t stop a worker that is genuinely still running — use this for jobs whose worker died. Recorded in the audit log.
              </p>
            </div>
          )
        }
        confirmLabel="Cancel job"
        onConfirm={() => confirming && cancel(confirming)}
      />
    </>
  );
}
