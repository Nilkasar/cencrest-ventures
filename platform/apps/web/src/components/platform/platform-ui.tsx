"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { DatabaseZap, Lock, Search, X } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
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
  cn,
  type BadgeProps,
} from "@bebest/ui";
import { ErrorPanel } from "@/components/patterns/error-panel";
import { isForbidden, isNotFound, isPlatformDbUnconfigured, platformErrorMessage } from "@/data/platform/client";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import { useSession } from "@/lib/session-context";

/**
 * Shared building blocks for every Platform (Epic 22) screen. Kept in one
 * place so the seven screens read as one tool: the same error/empty
 * vocabulary, the same badges for the same statuses, the same admin-only
 * affordance.
 */

// ── Hooks ──────────────────────────────────────────────────────────────────

/** Debounces a fast-changing value (search input) so each keystroke isn't a
 *  2–6s round trip to the platform database. */
export function useDebouncedValue<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(handle);
  }, [value, ms]);
  return debounced;
}

/** The last label seen for an id (e.g. an org name read off a result row),
 *  kept after the rows change — so a filter chip doesn't fall back to a raw
 *  id when the filtered list becomes empty. */
export function useRememberedLabel(id: string, found: string | null | undefined): string | undefined {
  const [memo, setMemo] = useState<{ id: string; label: string } | null>(null);
  if (found && id && (memo?.id !== id || memo.label !== found)) setMemo({ id, label: found });
  return found ?? (memo && memo.id === id ? memo.label : undefined);
}

export function useIsPlatformAdmin(): boolean {
  return useSession().platformRole === "admin";
}

// ── Error states ───────────────────────────────────────────────────────────

/**
 * The one error renderer for Platform data. 503 is a configuration state
 * (the API has no PLATFORM_DATABASE_URL), so it is explained, not shown as
 * a failure; 403 says the role is the problem; anything else is a retryable
 * error with a human message.
 */
export function PlatformErrorState({
  error,
  onRetry,
  resource = "this data",
  compact = false,
  notFound,
}: {
  error: Error;
  onRetry: () => void;
  resource?: string;
  compact?: boolean;
  /** What to render for a 404 (detail pages). */
  notFound?: ReactNode;
}) {
  if (isPlatformDbUnconfigured(error)) {
    return (
      <EmptyState
        compact={compact}
        icon={<DatabaseZap size={compact ? 18 : 20} />}
        eyebrow="Configuration"
        title="Platform database not configured"
        description={`The API on this environment has no PLATFORM_DATABASE_URL, so cross-organization ${resource} can't be read. Set it on the API (see scripts/create-platform-role.sql) and restart. The capability matrix on the Overview still works without it.`}
        action={
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Check again
          </Button>
        }
      />
    );
  }
  if (isForbidden(error)) {
    return (
      <EmptyState
        compact={compact}
        icon={<Lock size={compact ? 18 : 20} />}
        title="Your platform role can't open this"
        description="The API checked your platform role just now and declined. If you need access, ask a platform admin."
        action={
          <Button variant="secondary" size="sm" asChild>
            <Link href="/platform">Back to Platform overview</Link>
          </Button>
        }
      />
    );
  }
  if (notFound && isNotFound(error)) return <>{notFound}</>;
  return <ErrorPanel compact={compact} title={`Couldn't load ${resource}`} message={platformErrorMessage(error)} onRetry={onRetry} />;
}

// ── Badges ─────────────────────────────────────────────────────────────────

const STATUS_VARIANT: Record<string, BadgeProps["variant"]> = {
  completed: "success",
  complete: "success",
  active: "success",
  working: "success",
  success: "success",
  running: "accent",
  processing: "accent",
  queued: "neutral",
  pending: "neutral",
  failed: "danger",
  failure: "danger",
  blocked: "danger",
  revoked: "danger",
  cancelled: "outline",
  terminated: "outline",
  paused: "warning",
  partial: "warning",
  trialing: "accent",
  past_due: "warning",
  denied: "danger",
};

export function humanize(value: string): string {
  const s = value.replace(/[_.]/g, " ").trim();
  const out = s.charAt(0).toUpperCase() + s.slice(1);
  return out.replace(/\bai\b/gi, "AI");
}

export function StatusBadge({ status, size = "sm", className }: { status: string; size?: BadgeProps["size"]; className?: string }) {
  return (
    <Badge variant={STATUS_VARIANT[status] ?? "neutral"} size={size} dot className={className}>
      {humanize(status)}
    </Badge>
  );
}

const KIND_VARIANT: Record<string, BadgeProps["variant"]> = { customer: "neutral", agency: "accent", internal: "warning" };

export function KindBadge({ kind, size = "sm" }: { kind: string; size?: BadgeProps["size"] }) {
  return (
    <Badge variant={KIND_VARIANT[kind] ?? "neutral"} size={size}>
      {humanize(kind)}
    </Badge>
  );
}

export function PlanBadge({ plan, size = "sm" }: { plan: string | null; size?: BadgeProps["size"] }) {
  if (!plan) {
    return (
      <Badge variant="outline" size={size} title="No subscription row — entitlements treat this as Free">
        No plan
      </Badge>
    );
  }
  return (
    <Badge variant="outline" size={size} className="font-mono uppercase tracking-[0.06em]">
      {plan}
    </Badge>
  );
}

export function PlatformRoleBadge({ role, size = "sm" }: { role: string; size?: BadgeProps["size"] }) {
  if (role === "none") return null;
  return (
    <Badge variant={role === "admin" ? "accent" : "outline"} size={size}>
      Staff · {role}
    </Badge>
  );
}

// ── Time ───────────────────────────────────────────────────────────────────

/** Relative time with the exact timestamp on hover and for assistive tech. */
export function TimeAgo({ iso, empty = "—", className }: { iso: string | null | undefined; empty?: string; className?: string }) {
  if (!iso) return <span className={cn("text-[12.5px] text-subtle-foreground", className)}>{empty}</span>;
  return (
    <time dateTime={iso} title={formatDateTime(iso)} className={cn("whitespace-nowrap text-[12.5px] text-muted-foreground", className)}>
      {formatRelativeTime(iso)}
    </time>
  );
}

// ── Filters ────────────────────────────────────────────────────────────────

export const ALL = "all";

export function FilterSelect({
  label,
  value,
  onChange,
  options,
  allLabel,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly { value: string; label: string }[];
  allLabel: string;
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={cn("h-10 w-full sm:h-9 sm:w-40", className)} aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function SearchField({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
}) {
  return (
    <div className="relative w-full sm:max-w-xs sm:flex-1">
      <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle-foreground" aria-hidden />
      <Input
        type="search"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 pl-8 sm:h-9"
        aria-label={label}
      />
    </div>
  );
}

export function FilterBar({ children, onClear, active }: { children: ReactNode; onClear: () => void; active: boolean }) {
  return (
    <div role="search" className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      {children}
      {active && (
        <Button variant="ghost" size="sm" onClick={onClear} className="self-start sm:self-auto">
          <X size={14} aria-hidden /> Clear filters
        </Button>
      )}
    </div>
  );
}

export function opts(values: readonly string[]): { value: string; label: string }[] {
  return values.map((v) => ({ value: v, label: humanize(v) }));
}

// ── Layout pieces ──────────────────────────────────────────────────────────

export function TableSkeleton({ columns, rows = 6, label }: { columns: string[]; rows?: number; label: string }) {
  return (
    <div aria-busy="true" aria-label={label}>
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((c) => (
              <TableHead key={c}>{c}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: rows }).map((_, i) => (
            <TableRow key={i}>
              {columns.map((c, j) => (
                <TableCell key={c}>
                  {j === 0 ? (
                    <div className="flex flex-col gap-1.5">
                      <Skeleton className="h-3 w-36" />
                      <Skeleton className="h-2.5 w-24" />
                    </div>
                  ) : (
                    <Skeleton className="h-3 w-16" />
                  )}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** A titled card section for detail pages. */
export function Section({
  title,
  description,
  action,
  children,
  className,
  id,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  const headingId = id ? `${id}-heading` : undefined;
  return (
    <Card className={cn("min-w-0", className)}>
      <section aria-labelledby={headingId}>
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 id={headingId} className="font-display text-[15.5px] font-semibold tracking-[-0.01em] text-foreground">
              {title}
            </h2>
            {description && <p className="text-[12.5px] leading-relaxed text-muted-foreground">{description}</p>}
          </div>
          {action}
        </div>
        <div className="p-5">{children}</div>
      </section>
    </Card>
  );
}

/** Definition-list row used in detail headers/side panels. */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="font-mono text-[10.5px] font-medium uppercase tracking-[0.1em] text-subtle-foreground">{label}</dt>
      <dd className="min-w-0 text-[13px] text-foreground">{children}</dd>
    </div>
  );
}

export function InlineEmpty({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-[13px] text-muted-foreground">{children}</p>;
}

/** Monospace id with a short form; full value on hover. */
export function ShortId({ id }: { id: string }) {
  return (
    <span className="font-mono text-[11.5px] text-subtle-foreground" title={id}>
      {id.slice(0, 8)}
    </span>
  );
}

// ── Admin-only actions ─────────────────────────────────────────────────────

/**
 * An action only platform admins may take. Support staff see it disabled
 * with the reason in a tooltip (reachable by keyboard: the wrapper takes
 * focus because a disabled button can't). The API enforces the same rule —
 * a 403 is still handled by the caller.
 */
export function AdminOnly({ children, reason }: { children: (disabled: boolean) => ReactNode; reason: string }) {
  const isAdmin = useIsPlatformAdmin();
  if (isAdmin) return <>{children(false)}</>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={reason}>
          {children(true)}
        </span>
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  busy,
  tone = "primary",
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  busy?: boolean;
  tone?: "primary" | "danger";
  children?: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription asChild>
            <div>{description}</div>
          </DialogDescription>
        </DialogHeader>
        {children}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Keep as is
          </Button>
          <Button variant={tone === "danger" ? "danger" : "primary"} onClick={onConfirm} loading={busy}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Small "updating" hint next to a list header while a refetch runs. */
export function RefreshingHint({ active }: { active: boolean }) {
  return (
    <span aria-live="polite" className={cn("text-[12px] text-subtle-foreground transition-opacity", active ? "opacity-100" : "opacity-0")}>
      {active ? "Updating…" : ""}
    </span>
  );
}

/** Whole-row click target (a mouse convenience). The row's first cell holds
 *  the real `<Link>`, which is what keyboard and screen-reader users reach —
 *  rows are never given `role="link"` themselves. */
export function rowLinkProps(onOpen: () => void) {
  return {
    className: "cursor-pointer",
    onClick: (e: React.MouseEvent) => {
      // Let real links/buttons inside the row do their own thing.
      if ((e.target as HTMLElement).closest("a,button")) return;
      onOpen();
    },
  };
}

/** done / total with a thin bar (job progress). */
export function Progress({ done, total, failed }: { done: number; total: number | null; failed?: number | null }) {
  const ratio = total && total > 0 ? Math.min(1, done / total) : 0;
  return (
    <div className="flex min-w-[96px] flex-col gap-1">
      <span className="font-mono text-[12px] tabular-nums text-muted-foreground">
        {done}
        {total !== null && ` / ${total}`}
        {failed ? <span className="text-danger"> · {failed} failed</span> : null}
      </span>
      {total !== null && total > 0 && (
        <div className="h-1 w-full overflow-hidden rounded-full bg-surface" aria-hidden>
          <div className="h-full rounded-full bg-accent" style={{ width: `${ratio * 100}%` }} />
        </div>
      )}
    </div>
  );
}
