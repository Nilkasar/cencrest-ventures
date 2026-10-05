import { Search } from "lucide-react";
import { Button, Card, EmptyState, Skeleton, SkeletonText, cn } from "@bebest/ui";

/**
 * Loading and "nothing matched" states that match the final layouts. For
 * errors use `ErrorPanel` (./error-panel); for a first-run empty list use
 * `EmptyState` from `@bebest/ui` with the copy pattern in README.md.
 */

/** Filters/search returned nothing (the data exists, it just doesn't match). */
export function NoResults({
  noun,
  onClear,
  hint = "Try a different search term or filter.",
  className,
}: {
  /** Plural noun: "leads", "deals". */
  noun: string;
  onClear: () => void;
  hint?: string;
  className?: string;
}) {
  return (
    <EmptyState
      compact
      icon={<Search size={18} />}
      title={`No ${noun} match these filters`}
      description={hint}
      action={
        <Button variant="secondary" size="sm" onClick={onClear}>
          Clear filters
        </Button>
      }
      className={className}
    />
  );
}

/** Placeholder for a `Section` while its data loads. */
export function SectionSkeleton({ lines = 3, className, titleWidth = "w-32" }: { lines?: number; className?: string; titleWidth?: string }) {
  return (
    <Card className={cn("p-5", className)} aria-hidden="true">
      <Skeleton className={cn("mb-4 h-4", titleWidth)} />
      <SkeletonText lines={lines} />
    </Card>
  );
}

/** Placeholder for a whole detail page: header, key facts, main + rail. */
export function DetailSkeleton({ withLeading = true, label = "Loading…" }: { withLeading?: boolean; label?: string }) {
  return (
    <div aria-busy="true" className="flex flex-col gap-6">
      <span className="sr-only">{label}</span>
      <div className="flex flex-col gap-4" aria-hidden="true">
        <Skeleton className="h-4 w-16" />
        <div className="flex items-center gap-3.5">
          {withLeading && <Skeleton className="size-12 shrink-0 rounded-full" />}
          <div className="flex flex-col gap-2">
            <Skeleton className="h-6 w-56" />
            <Skeleton className="h-3 w-40" />
          </div>
        </div>
        <Skeleton className="h-12 w-full rounded-lg" />
      </div>
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]" aria-hidden="true">
        <SectionSkeleton lines={6} />
        <div className="flex flex-col gap-5">
          <SectionSkeleton lines={3} titleWidth="w-24" />
          <SectionSkeleton lines={2} titleWidth="w-20" />
        </div>
      </div>
    </div>
  );
}
