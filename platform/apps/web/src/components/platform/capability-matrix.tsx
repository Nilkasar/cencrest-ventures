"use client";

import { useId, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, CheckCircle2, ChevronDown, CircleDashed, RefreshCw, XCircle } from "lucide-react";
import { Badge, Button, Card, RefreshOverlay, Skeleton, cn, durations, easings } from "@bebest/ui";
import type { Capability, CapabilitiesResponse, CapabilityDependency, CapabilityGroup, CapabilityStatus } from "@/data/platform/types";
import type { AsyncState } from "@/lib/use-async-data";
import { PlatformErrorState, TimeAgo } from "./platform-ui";

/**
 * The capability matrix — "everything the platform can do, and whether it
 * can do it right now". Every status comes from `/api/platform/capabilities`
 * (live checks + code-audit facts), never from this file. Problems sort
 * first inside each group so a scan top-to-bottom reads worst-to-best.
 */

const STATUS_ORDER: CapabilityStatus[] = ["blocked", "stub", "partial", "working"];
const GROUP_ORDER: CapabilityGroup[] = ["Core product", "Intelligence", "Execution", "Growth & revenue", "Platform"];

const STATUS_META: Record<
  CapabilityStatus,
  { label: string; icon: typeof CheckCircle2; text: string; bar: string; badge: "success" | "warning" | "danger" | "neutral"; blurb: string }
> = {
  working: { label: "Working", icon: CheckCircle2, text: "text-success", bar: "bg-success", badge: "success", blurb: "every check passes" },
  partial: { label: "Partial", icon: AlertCircle, text: "text-warning", bar: "bg-warning", badge: "warning", blurb: "works, with a degraded dependency" },
  blocked: { label: "Blocked", icon: XCircle, text: "text-danger", bar: "bg-danger", badge: "danger", blurb: "a required dependency is failing" },
  stub: { label: "Stub", icon: CircleDashed, text: "text-subtle-foreground", bar: "bg-border-strong", badge: "neutral", blurb: "placeholder implementation" },
};

type Loadable = AsyncState<CapabilitiesResponse> & { isRefreshing: boolean; reload: () => void };

export function CapabilityMatrix({ state }: { state: Loadable }) {
  const [filter, setFilter] = useState<CapabilityStatus | "all">("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const data = state.status === "success" ? state.data : null;

  const groups = useMemo(() => {
    if (!data) return [];
    const visible = data.capabilities.filter((c) => filter === "all" || c.status === filter);
    const byGroup = new Map<string, Capability[]>();
    for (const cap of visible) byGroup.set(cap.group, [...(byGroup.get(cap.group) ?? []), cap]);
    const order = [...GROUP_ORDER, ...[...byGroup.keys()].filter((g) => !GROUP_ORDER.includes(g as CapabilityGroup))];
    return order
      .filter((g) => byGroup.has(g))
      .map((g) => ({
        group: g,
        items: [...byGroup.get(g)!].sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)),
      }));
  }, [data, filter]);

  const allKeys = data?.capabilities.map((c) => c.key) ?? [];
  const allOpen = allKeys.length > 0 && allKeys.every((k) => expanded.has(k));

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <section aria-labelledby="capability-matrix-heading" className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <p className="font-mono text-[10.5px] font-medium uppercase tracking-[0.12em] text-subtle-foreground">Capability matrix</p>
          <h2 id="capability-matrix-heading" className="font-display text-[20px] font-semibold tracking-[-0.01em] text-foreground">
            What the platform can do right now
          </h2>
          <p className="max-w-[64ch] text-[13px] leading-relaxed text-muted-foreground">
            Each capability&apos;s status is derived from its dependencies — live checks taken by the API (providers, email, queue,
            RLS) and code-audit facts. Expand one to see exactly what it depends on.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {data && (
            <p className="text-[12px] text-subtle-foreground" aria-live="polite">
              Checked <TimeAgo iso={data.checkedAt} className="text-[12px] text-subtle-foreground" />
              {data.cached && <span title="The API caches live checks for 60 seconds"> · cached</span>}
            </p>
          )}
          <Button
            variant="secondary"
            size="sm"
            onClick={state.reload}
            loading={state.isRefreshing}
            disabled={state.status === "loading"}
            aria-label="Re-run capability checks"
          >
            {!state.isRefreshing && <RefreshCw size={13} aria-hidden />} Refresh
          </Button>
        </div>
      </div>

      {state.status === "loading" && <MatrixSkeleton />}
      {state.status === "error" && <PlatformErrorState error={state.error} onRetry={state.reload} resource="capability checks" />}

      {data && (
        <RefreshOverlay active={state.isRefreshing} className="flex flex-col gap-4">
          <SummaryBar data={data} filter={filter} onFilter={setFilter} />

          <div className="flex items-center justify-between gap-3">
            <p className="text-[12.5px] text-muted-foreground">
              {filter === "all"
                ? `${data.capabilities.length} capabilities across ${groups.length} areas`
                : `${groups.reduce((n, g) => n + g.items.length, 0)} ${STATUS_META[filter].label.toLowerCase()}`}
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setExpanded(allOpen ? new Set() : new Set(allKeys))}
              aria-pressed={allOpen}
            >
              {allOpen ? "Collapse all" : "Expand all"}
            </Button>
          </div>

          {groups.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-[13px] text-muted-foreground">
              Nothing is {filter === "all" ? "listed" : STATUS_META[filter as CapabilityStatus].label.toLowerCase()} right now.{" "}
              <button type="button" className="font-medium text-accent hover:underline" onClick={() => setFilter("all")}>
                Show all
              </button>
            </p>
          ) : (
            <div className="grid items-start gap-4 xl:grid-cols-2">
              {groups.map(({ group, items }) => (
                <Card key={group} className="overflow-hidden">
                  <div className="flex items-center justify-between gap-3 border-b border-border bg-surface/60 px-4 py-2.5">
                    <h3 className="font-mono text-[10.5px] font-medium uppercase tracking-[0.12em] text-muted-foreground">{group}</h3>
                    <GroupDots items={items} />
                  </div>
                  <ul className="divide-y divide-border">
                    {items.map((cap) => (
                      <CapabilityRow key={cap.key} cap={cap} open={expanded.has(cap.key)} onToggle={() => toggle(cap.key)} />
                    ))}
                  </ul>
                </Card>
              ))}
            </div>
          )}
        </RefreshOverlay>
      )}
    </section>
  );
}

function SummaryBar({
  data,
  filter,
  onFilter,
}: {
  data: CapabilitiesResponse;
  filter: CapabilityStatus | "all";
  onFilter: (f: CapabilityStatus | "all") => void;
}) {
  const total = data.capabilities.length || 1;
  const order: CapabilityStatus[] = ["working", "partial", "blocked", "stub"];
  return (
    <Card className="p-4">
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-surface" role="img" aria-label={order.map((s) => `${data.summary[s]} ${s}`).join(", ")}>
        {order.map((s) =>
          data.summary[s] > 0 ? (
            <div key={s} className={cn("h-full first:rounded-l-full last:rounded-r-full", STATUS_META[s].bar)} style={{ width: `${(data.summary[s] / total) * 100}%` }} />
          ) : null,
        )}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label="Filter capabilities by status">
        {order.map((s) => {
          const meta = STATUS_META[s];
          const Icon = meta.icon;
          const pressed = filter === s;
          return (
            <button
              key={s}
              type="button"
              aria-pressed={pressed}
              onClick={() => onFilter(pressed ? "all" : s)}
              className={cn(
                "flex min-h-11 items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                pressed ? "border-accent bg-accent-muted" : "border-border hover:border-border-strong hover:bg-surface",
              )}
            >
              <Icon size={16} className={cn("shrink-0", meta.text)} aria-hidden />
              <span className="flex min-w-0 flex-col">
                <span className="flex items-baseline gap-1.5">
                  <span className="font-mono text-[18px] font-semibold tabular-nums text-foreground">{data.summary[s]}</span>
                  <span className="text-[12.5px] font-medium text-foreground">{meta.label}</span>
                </span>
                <span className="truncate text-[11.5px] text-subtle-foreground">{meta.blurb}</span>
              </span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

function GroupDots({ items }: { items: Capability[] }) {
  return (
    <span className="flex items-center gap-1" aria-label={items.map((i) => `${i.name}: ${i.status}`).join("; ")} role="img">
      {items.map((i) => (
        <span key={i.key} className={cn("size-1.5 rounded-full", STATUS_META[i.status].bar)} />
      ))}
    </span>
  );
}

function CapabilityRow({ cap, open, onToggle }: { cap: Capability; open: boolean; onToggle: () => void }) {
  const panelId = useId();
  const meta = STATUS_META[cap.status];
  const Icon = meta.icon;
  const failing = cap.dependencies.filter((d) => !d.ok).length;
  const liveCount = cap.dependencies.filter((d) => d.source === "live").length;

  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-surface/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <Icon size={17} className={cn("mt-0.5 shrink-0", meta.text)} aria-hidden />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[13.5px] font-medium text-foreground">{cap.name}</span>
            <Badge variant={meta.badge} size="sm">
              {meta.label}
            </Badge>
          </span>
          <span className="text-[12.5px] leading-relaxed text-muted-foreground">{cap.summary}</span>
          <span className="font-mono text-[11px] text-subtle-foreground">
            {cap.dependencies.length === 0
              ? "No dependencies"
              : failing === 0
                ? `${cap.dependencies.length} ${cap.dependencies.length === 1 ? "check passes" : "checks pass"}`
                : `${failing} of ${cap.dependencies.length} checks failing`}
            {liveCount > 0 && ` · ${liveCount} live`}
          </span>
        </span>
        <ChevronDown
          size={15}
          aria-hidden
          className={cn("mt-1 shrink-0 text-subtle-foreground transition-transform duration-200 motion-reduce:transition-none", open && "rotate-180")}
        />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={panelId}
            key="deps"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: durations.base, ease: easings.emphasized }}
            className="overflow-hidden"
          >
            <ul className="mx-4 mb-4 flex flex-col gap-2 rounded-lg border border-border bg-surface/50 p-3" aria-label={`${cap.name} dependencies`}>
              {cap.dependencies.length === 0 && <li className="text-[12.5px] text-muted-foreground">No dependencies recorded.</li>}
              {cap.dependencies.map((d) => (
                <DependencyRow key={d.key} dep={d} />
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

const SEVERITY_COPY: Record<CapabilityDependency["severity"], string> = {
  required: "Required",
  degrades: "Degrades",
  stub: "Stub",
};

function DependencyRow({ dep }: { dep: CapabilityDependency }) {
  const failTone = dep.severity === "required" ? "text-danger" : dep.severity === "stub" ? "text-subtle-foreground" : "text-warning";
  return (
    <li className="flex items-start gap-2.5">
      {dep.ok ? (
        <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-success" aria-label="Passing" />
      ) : (
        <XCircle size={14} className={cn("mt-0.5 shrink-0", failTone)} aria-label="Failing" />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[12.5px] font-medium text-foreground">{dep.label}</span>
          <span
            className={cn(
              "rounded border px-1 font-mono text-[9.5px] uppercase leading-4 tracking-[0.08em]",
              dep.source === "live" ? "border-accent/40 text-accent" : "border-border text-subtle-foreground",
            )}
            title={dep.source === "live" ? "Observed by the API at check time" : "A code-audit fact encoded in the API"}
          >
            {dep.source}
          </span>
          {!dep.ok && (
            <span className="rounded border border-border px-1 font-mono text-[9.5px] uppercase leading-4 tracking-[0.08em] text-subtle-foreground">
              {SEVERITY_COPY[dep.severity]}
            </span>
          )}
        </div>
        <p className="break-words text-[12px] leading-relaxed text-muted-foreground">{dep.detail}</p>
      </div>
    </li>
  );
}

function MatrixSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Running capability checks">
      <Card className="p-4">
        <Skeleton className="h-2.5 w-full rounded-full" />
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12 rounded-lg" />
          ))}
        </div>
      </Card>
      <div className="grid items-start gap-4 xl:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="overflow-hidden">
            <div className="border-b border-border px-4 py-3">
              <Skeleton className="h-2.5 w-24" />
            </div>
            {Array.from({ length: 3 }).map((__, j) => (
              <div key={j} className="flex gap-3 border-b border-border px-4 py-3.5 last:border-0">
                <Skeleton className="size-4 rounded-full" />
                <div className="flex flex-1 flex-col gap-1.5">
                  <Skeleton className="h-3 w-40" />
                  <Skeleton className="h-2.5 w-full" />
                </div>
              </div>
            ))}
          </Card>
        ))}
      </div>
      <p className="sr-only">Checking AI providers, email, queue and database. This can take a few seconds.</p>
    </div>
  );
}

