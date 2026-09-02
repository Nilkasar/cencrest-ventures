import * as React from "react";
import { cn } from "../lib/utils";

/** Base shimmer block. Compose with explicit width/height utilities. */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div role="presentation" aria-hidden="true" className={cn("bb-skeleton", className)} {...props} />;
}

export function SkeletonText({
  lines = 3,
  className,
  lastLineWidth = "60%",
}: {
  lines?: number;
  className?: string;
  lastLineWidth?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2", className)} role="presentation" aria-hidden="true">
      {Array.from({ length: lines }).map((_, index) => (
        <Skeleton
          key={index}
          className="h-3"
          style={index === lines - 1 ? { width: lastLineWidth } : undefined}
        />
      ))}
    </div>
  );
}

export function SkeletonAvatar({ size = 36, className }: { size?: number; className?: string }) {
  return (
    <Skeleton
      className={cn("rounded-full shrink-0", className)}
      style={{ width: size, height: size }}
    />
  );
}

export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-xl border border-border bg-surface-raised p-5", className)}>
      <div className="flex items-center gap-3 mb-4">
        <SkeletonAvatar size={32} />
        <Skeleton className="h-3 w-32" />
      </div>
      <SkeletonText lines={2} />
    </div>
  );
}
