"use client";

import { Check, X } from "lucide-react";
import { cn } from "@bebest/ui";
import { DEAL_STAGE_LABEL, DEAL_STAGE_SEQUENCE, type DealStage } from "@/data/crm/types";

/** Main path a deal walks; Lost is a branch off any open stage. */
const PATH: DealStage[] = DEAL_STAGE_SEQUENCE.filter((s) => s !== "lost");

/**
 * The deal's stage as a vertical stepper whose steps are the controls:
 * each step is a real button ("Move to Proposal"), so moving a deal on its
 * own page is one click and fully keyboard reachable. Lost is offered
 * separately because it needs a reason first (the caller opens the
 * `LostReasonDialog`).
 */
export function DealStagePipeline({
  stage,
  onMove,
  disabled = false,
}: {
  stage: DealStage;
  onMove: (stage: DealStage) => void;
  disabled?: boolean;
}) {
  const currentIndex = PATH.indexOf(stage);
  const lost = stage === "lost";

  return (
    <div className="flex flex-col gap-1">
      <ol className="flex flex-col" aria-label="Deal stage">
        {PATH.map((step, index) => {
          const done = !lost && index < currentIndex;
          const active = !lost && index === currentIndex;
          const isWon = step === "won";
          const isLast = index === PATH.length - 1;
          return (
            <li key={step} className="relative">
              {!isLast && (
                <span
                  aria-hidden="true"
                  className={cn("absolute left-[19px] top-[30px] h-[calc(100%-22px)] w-px", done ? "bg-accent" : "bg-border")}
                />
              )}
              <button
                type="button"
                onClick={() => onMove(step)}
                disabled={disabled || active}
                aria-current={active ? "step" : undefined}
                aria-label={active ? `${DEAL_STAGE_LABEL[step]} (current stage)` : `Move to ${DEAL_STAGE_LABEL[step]}`}
                className={cn(
                  "group relative flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  !active && !disabled && "hover:bg-surface",
                  "disabled:cursor-default",
                )}
              >
                <span
                  className={cn(
                    "flex size-[18px] shrink-0 items-center justify-center rounded-full border text-[10px] font-medium",
                    done && "border-accent bg-accent text-accent-foreground",
                    active && (isWon ? "border-success bg-success-muted text-success" : "border-accent bg-accent-muted text-accent"),
                    !done && !active && "border-border bg-surface text-subtle-foreground group-hover:border-border-strong",
                  )}
                  aria-hidden="true"
                >
                  {done || (active && isWon) ? <Check size={10} /> : index + 1}
                </span>
                <span className={cn("flex-1 text-[13px]", active ? "font-semibold text-foreground" : "text-muted-foreground group-hover:text-foreground")}>
                  {DEAL_STAGE_LABEL[step]}
                </span>
                {!active && !disabled && (
                  <span className="text-[11.5px] text-subtle-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden="true">
                    Move here
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ol>

      <div className="mt-1 border-t border-border pt-2">
        {lost ? (
          <div className="flex h-9 items-center gap-2.5 px-2.5" aria-current="step">
            <span className="flex size-[18px] shrink-0 items-center justify-center rounded-full border border-danger bg-danger-muted text-danger" aria-hidden="true">
              <X size={10} />
            </span>
            <span className="text-[13px] font-semibold text-danger">Lost</span>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => onMove("lost")}
            disabled={disabled}
            className="flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[13px] text-muted-foreground transition-colors hover:bg-danger-muted hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
          >
            <span className="flex size-[18px] shrink-0 items-center justify-center rounded-full border border-border bg-surface" aria-hidden="true">
              <X size={10} />
            </span>
            Mark as lost…
          </button>
        )}
      </div>
    </div>
  );
}
