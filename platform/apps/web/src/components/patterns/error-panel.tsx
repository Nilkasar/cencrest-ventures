import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "@bebest/ui";

/**
 * Standard inline error state for any data-fetching view — a real message
 * plus a real retry path, never a silent blank screen. Used by every
 * list/detail/board when `useAsyncData` lands in its "error" state.
 *
 * Full: a calm card (same chrome as the page's other blocks, danger used
 * only on the icon) in place of the content that failed. Compact: a
 * one-line danger banner for a failure inside an otherwise-working page.
 */
export function ErrorPanel({
  title = "Something went wrong",
  message,
  onRetry,
  compact = false,
}: {
  title?: string;
  message: string;
  onRetry: () => void;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <div role="alert" className="flex items-center gap-3 rounded-lg border border-danger/30 bg-danger-muted px-4 py-3">
        <AlertTriangle className="size-4 shrink-0 text-danger" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-foreground">{title}</p>
          <p className="text-[12.5px] text-muted-foreground">{message}</p>
        </div>
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 rounded-xl border border-border bg-surface-raised px-8 py-14 text-center shadow-sm"
    >
      <span className="flex size-10 items-center justify-center rounded-full bg-danger-muted text-danger" aria-hidden="true">
        <AlertTriangle size={18} />
      </span>
      <div>
        <p className="font-display text-[16px] font-semibold text-foreground">{title}</p>
        <p className="mt-1 max-w-[440px] text-[13px] leading-relaxed text-muted-foreground">{message}</p>
      </div>
      <Button variant="outline" size="sm" onClick={onRetry} className="mt-1">
        <RotateCw size={13} aria-hidden="true" />
        Try again
      </Button>
    </div>
  );
}
