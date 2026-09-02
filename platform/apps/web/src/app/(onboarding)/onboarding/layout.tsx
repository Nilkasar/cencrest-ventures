"use client";

import { usePathname } from "next/navigation";
import { AlertCircle } from "lucide-react";
import { Button, EmptyState, Skeleton, SkeletonText } from "@bebest/ui";
import { OnboardingProvider, useOnboarding } from "@/components/onboarding/onboarding-context";
import { Stepper } from "@/components/onboarding/stepper";

function WizardFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { profile, loading, error, reload } = useOnboarding();
  const showStepper = pathname !== "/onboarding" && pathname !== "/onboarding/done";

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col">
      {showStepper && profile && (
        <div className="mb-10">
          <Stepper activeKey={stepKeyFromPathname(pathname)} completedSteps={profile.completedSteps} />
        </div>
      )}

      {loading && (
        <div className="flex flex-col gap-4" role="status" aria-label="Loading your brand profile">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-7 w-64" />
          <SkeletonText lines={2} className="mt-1 max-w-md" />
          <div className="mt-4 flex flex-col gap-3">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        </div>
      )}

      {!loading && error && (
        <EmptyState
          icon={<AlertCircle size={20} />}
          eyebrow="Couldn't load"
          title="Your brand profile didn't load"
          description={error}
          action={
            <Button variant="primary" size="sm" onClick={reload}>
              Try again
            </Button>
          }
        />
      )}

      {!loading && !error && profile && children}
    </div>
  );
}

function stepKeyFromPathname(pathname: string) {
  const segment = pathname.split("/").pop();
  return (segment ?? "brand-basics") as Parameters<typeof Stepper>[0]["activeKey"];
}

export default function OnboardingWizardLayout({ children }: { children: React.ReactNode }) {
  return (
    <OnboardingProvider>
      <WizardFrame>{children}</WizardFrame>
    </OnboardingProvider>
  );
}
