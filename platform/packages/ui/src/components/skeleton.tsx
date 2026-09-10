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

/**
 * Wraps content that is being refreshed in place — a filter changed, a page
 * turned, a mutation landed — while the previous result stays on screen.
 *
 * Deliberately understated: a slight fade and a suppressed pointer, not a
 * spinner over the whole region and never a teardown to skeletons. The
 * distinction that matters is "there is nothing to show yet" (skeleton)
 * versus "what you're looking at is one moment out of date" (this).
 * Announced politely so a screen reader hears the state change once.
 */
export function RefreshOverlay({
  active,
  children,
  className,
}: {
  active: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      aria-busy={active || undefined}
      className={cn(
        "transition-opacity duration-200 motion-reduce:transition-none",
        active && "opacity-55 pointer-events-none select-none",
        className,
      )}
    >
      {children}
    </div>
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
