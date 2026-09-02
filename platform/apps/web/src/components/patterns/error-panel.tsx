import { AlertTriangle } from "lucide-react";
import { Button } from "@bebest/ui";

/**
 * Standard inline error state for any data-fetching view — a real message
 * plus a real retry path, never a silent blank screen. Used by every CRM
 * list/detail/board when `useAsyncData` lands in its "error" state.
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
  return (
    <div
      role="alert"
      className={
        compact
          ? "flex items-center gap-3 rounded-lg border border-danger/30 bg-danger-muted px-4 py-3"
          : "flex flex-col items-center text-center gap-3 rounded-xl border border-danger/30 bg-danger-muted px-8 py-14"
      }
    >
      <AlertTriangle className={compact ? "size-4 text-danger shrink-0" : "size-8 text-danger"} aria-hidden="true" />
      <div className={compact ? "flex-1 min-w-0" : ""}>
        <p className={compact ? "text-[13px] font-medium text-foreground" : "font-display text-[16px] font-semibold text-foreground"}>
          {title}
        </p>
        <p className={compact ? "text-[12.5px] text-muted-foreground" : "text-[13.5px] text-muted-foreground mt-1 max-w-[440px]"}>
          {message}
        </p>
      </div>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}
