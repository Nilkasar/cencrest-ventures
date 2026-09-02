import type { OnboardingStepKey } from "@/data/types";

export interface WizardStepMeta {
  key: OnboardingStepKey;
  href: string;
  label: string;
}

/** Source of truth for step order + routing, shared by the stepper, the
 *  "Continue" navigation on each step, and the resume-point calculation
 *  in `onboarding-client.ts` (which uses `ONBOARDING_STEP_KEYS` — keep the
 *  two lists in the same order). */
export const WIZARD_STEPS: WizardStepMeta[] = [
  { key: "brand-basics", href: "/onboarding/brand-basics", label: "Brand basics" },
  { key: "competitors", href: "/onboarding/competitors", label: "Competitors" },
  { key: "industry", href: "/onboarding/industry", label: "Industry & category" },
  { key: "use-cases", href: "/onboarding/use-cases", label: "Use cases" },
  { key: "claims", href: "/onboarding/claims", label: "Brand claims" },
];

export function stepAt(index: number): WizardStepMeta | undefined {
  return WIZARD_STEPS[index];
}

export function stepIndexForKey(key: OnboardingStepKey): number {
  return WIZARD_STEPS.findIndex((step) => step.key === key);
}

export function nextStepHref(key: OnboardingStepKey): string {
  const index = stepIndexForKey(key);
  return stepAt(index + 1)?.href ?? "/onboarding/done";
}

export function previousStepHref(key: OnboardingStepKey): string {
  const index = stepIndexForKey(key);
  return index <= 0 ? "/onboarding" : (stepAt(index - 1)?.href ?? "/onboarding");
}
