"use client";

import Link from "next/link";
import { Check } from "lucide-react";
import { cn } from "@bebest/ui";
import { WIZARD_STEPS } from "./steps";
import type { OnboardingStepKey } from "@/data/types";

interface StepperProps {
  activeKey: OnboardingStepKey;
  completedSteps: Record<OnboardingStepKey, boolean>;
}

/** Horizontal progress stepper for the 5 substantive wizard steps (Welcome
 *  and Done are bookends, rendered without it). Steps are always navigable —
 *  a user can jump back to review or forward to skip ahead, since every
 *  step saves independently; there is nothing a hard lock would protect. */
export function Stepper({ activeKey, completedSteps }: StepperProps) {
  const activeIndex = WIZARD_STEPS.findIndex((step) => step.key === activeKey);
  const doneCount = WIZARD_STEPS.filter((step) => completedSteps[step.key]).length;

  return (
    <nav aria-label="Onboarding progress">
      {/* Compact form: small screens only. */}
      <div className="sm:hidden">
        <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.1em] text-subtle-foreground">
          Step {activeIndex + 1} of {WIZARD_STEPS.length} &middot; {WIZARD_STEPS[activeIndex]?.label}
        </p>
        <div className="h-1 w-full overflow-hidden rounded-full bg-surface">
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-300 ease-out"
            style={{ width: `${((activeIndex + 1) / WIZARD_STEPS.length) * 100}%` }}
          />
        </div>
      </div>

      {/* Full form: circles + labels + connecting line. */}
      <ol className="hidden sm:flex sm:items-start">
        {WIZARD_STEPS.map((step, index) => {
          const isDone = completedSteps[step.key];
          const isActive = step.key === activeKey;
          const isLast = index === WIZARD_STEPS.length - 1;
          return (
            <li key={step.key} className={cn("flex items-center", !isLast && "flex-1")}>
              <Link
                href={step.href}
                className="group flex flex-col items-center gap-2 focus-visible:outline-none"
                aria-current={isActive ? "step" : undefined}
              >
                <span
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-full border font-mono text-[12px] font-medium transition-colors duration-150",
                    isActive && "border-accent bg-accent text-accent-foreground",
                    !isActive && isDone && "border-accent bg-accent-muted text-accent",
                    !isActive && !isDone && "border-border bg-surface-raised text-muted-foreground group-hover:border-border-strong",
                    "group-focus-visible:ring-2 group-focus-visible:ring-ring group-focus-visible:ring-offset-2 group-focus-visible:ring-offset-background",
                  )}
                >
                  {isDone && !isActive ? <Check size={14} /> : index + 1}
                </span>
                <span
                  className={cn(
                    "max-w-[92px] text-center text-[11.5px] font-medium leading-tight",
                    isActive ? "text-foreground" : "text-muted-foreground group-hover:text-foreground",
                  )}
                >
                  {step.label}
                </span>
              </Link>
              {!isLast && (
                <div className="mx-2 mt-4 h-px flex-1 bg-border" aria-hidden="true">
                  <div
                    className="h-px bg-accent transition-[width] duration-300 ease-out"
                    style={{ width: index < doneCount ? "100%" : "0%" }}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
