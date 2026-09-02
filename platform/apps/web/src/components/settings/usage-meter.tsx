import { cn } from "@bebest/ui";
import type { UsageEntry } from "@/data/billing/types";

/**
 * One metered-limit row for the Billing tab. Follows the same "at your
 * limit" register `competitors-view.tsx` (Epic 2) established with its text
 * summary card ("N of LIMIT tracked... LIMIT - N remaining"), rendered here
 * as an actual bar per this epic's UI-surface requirement ("usage bars for
 * every metered limit"). `used: null` (an entitlement this epic seeded a
 * limit for but no prior epic counts against yet, per
 * `routes/subscription.ts`'s `buildUsageSummary`) renders as "Limit only"
 * with no bar — an honest "not tracked", never a fabricated 0%.
 */
export function UsageMeter({ label, entry }: { label: string; entry: UsageEntry }) {
  const { used, limit } = entry;
  const unlimited = limit === null;
  const untracked = used === null;

  const pct = !unlimited && !untracked && limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const atLimit = !unlimited && !untracked && used >= limit;
  const nearLimit = !atLimit && pct >= 80;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] text-foreground">{label}</span>
        <span className="font-mono text-[12px] text-muted-foreground tabular-nums">
          {untracked
            ? unlimited
              ? "Not tracked · unlimited"
              : `Not tracked · limit ${limit.toLocaleString()}`
            : unlimited
              ? `${used.toLocaleString()} · unlimited`
              : `${used.toLocaleString()} / ${limit.toLocaleString()}`}
        </span>
      </div>
      {!untracked && !unlimited && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface" role="presentation">
          <div
            className={cn(
              "h-full rounded-full transition-[width] duration-300 ease-out",
              atLimit ? "bg-danger" : nearLimit ? "bg-warning" : "bg-accent",
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      {atLimit && <p className="text-[11.5px] text-danger">You&apos;re at this plan&apos;s limit.</p>}
    </div>
  );
}
