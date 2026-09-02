"use client";

import Link from "next/link";
import { ArrowRight, CircleCheck, Circle } from "lucide-react";
import { Button } from "@bebest/ui";
import { useOnboarding } from "@/components/onboarding/onboarding-context";
import { WIZARD_STEPS } from "@/components/onboarding/steps";
import { completedStepCount, resumeStep } from "@/lib/onboarding-client";

const STEP_DESCRIPTIONS: Record<string, string> = {
  "brand-basics": "Confirm your company name, website, and how you describe yourselves.",
  competitors: "Add who you're compared against — up to your plan's limit.",
  industry: "Tell us your industry, categories, and markets.",
  "use-cases": "Add 3–5 ways customers use you, and why.",
  claims: "Optional: facts about your product worth citing (evidence, proof points).",
};

export default function OnboardingWelcomePage() {
  const { profile } = useOnboarding();
  if (!profile) return null;

  const done = completedStepCount(profile);
  const isReturning = profile.status !== "not_started";
  // `resumeStep` returns the first incomplete step, or the last step once
  // everything is done (a sensible "review" entry point) — works for all
  // three statuses without special-casing here.
  const continueHref = WIZARD_STEPS.find((s) => s.key === resumeStep(profile))?.href ?? WIZARD_STEPS[0]!.href;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2.5">
        <p className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-subtle-foreground">
          Brand intelligence setup
        </p>
        <h1 className="font-display text-[30px] font-semibold text-foreground tracking-[-0.02em] leading-[1.15]">
          {isReturning ? "Welcome back." : "Let's build your brand profile."}
        </h1>
        <p className="max-w-[52ch] text-[14.5px] leading-relaxed text-muted-foreground">
          {isReturning
            ? `You've completed ${done} of ${WIZARD_STEPS.length} steps. Pick up where you left off — nothing you've entered has been lost.`
            : "Five short steps. Everything you enter is saved as you go, so you can leave and come back without losing progress. This becomes the baseline every AI Visibility and SEO measurement in BeBest compares against."}
        </p>
      </div>

      <ol className="flex flex-col gap-1 rounded-xl border border-border bg-surface-raised">
        {WIZARD_STEPS.map((step, index) => {
          const isDone = profile.completedSteps[step.key];
          return (
            <li key={step.key} className="flex items-start gap-3 border-b border-border p-4 last:border-0">
              <span className="mt-0.5 shrink-0 text-accent">
                {isDone ? <CircleCheck size={18} /> : <Circle size={18} className="text-border-strong" />}
              </span>
              <div className="flex flex-col gap-0.5">
                <p className="text-[13.5px] font-medium text-foreground">
                  {index + 1}. {step.label}
                </p>
                <p className="text-[12.5px] text-muted-foreground">{STEP_DESCRIPTIONS[step.key]}</p>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="flex items-center gap-3">
        <Button variant="primary" size="lg" asChild>
          <Link href={continueHref}>
            {isReturning ? "Resume setup" : "Get started"} <ArrowRight size={15} />
          </Link>
        </Button>
        <Button variant="ghost" size="lg" asChild>
          <Link href="/overview">I&apos;ll do this later</Link>
        </Button>
      </div>
    </div>
  );
}
