"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, AlertCircle } from "lucide-react";
import { Button, EmptyState, Skeleton } from "@bebest/ui";
import { useOnboarding } from "@/components/onboarding/onboarding-context";
import { WIZARD_STEPS } from "@/components/onboarding/steps";
import { completeOnboarding, resumeStep, ValidationError } from "@/lib/onboarding-client";

export default function DoneStep() {
  const router = useRouter();
  const { organizationId, profile, setProfile } = useOnboarding();
  // Lazy initializer (not an effect): if setup was already complete before
  // landing here, there's nothing to finish — no synchronous setState in
  // an effect needed for that case at all.
  const [finishing, setFinishing] = useState(() => profile!.status !== "completed");
  const [error, setError] = useState<string | undefined>(undefined);
  const attempted = useRef(false);

  useEffect(() => {
    if (!finishing || attempted.current) return;
    attempted.current = true;

    completeOnboarding(organizationId)
      .then((updated) => {
        setProfile(updated);
        setFinishing(false);
      })
      .catch((err: unknown) => {
        if (err instanceof ValidationError) {
          // Someone navigated to /onboarding/done directly with steps left —
          // send them back to the one that still needs attention instead of
          // showing a dead end.
          const target = WIZARD_STEPS.find((s) => s.key === resumeStep(profile!))?.href ?? "/onboarding";
          router.replace(target);
          return;
        }
        setError(err instanceof Error ? err.message : "Something went wrong finishing setup.");
        setFinishing(false);
      });
  }, [finishing, organizationId, profile, setProfile, router]);

  if (finishing) {
    return (
      <div className="flex flex-col items-center gap-4 py-12" role="status" aria-label="Finishing setup">
        <Skeleton className="size-12 rounded-full" />
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-3.5 w-64" />
      </div>
    );
  }

  if (error) {
    return (
      <EmptyState
        icon={<AlertCircle size={20} />}
        eyebrow="Couldn't finish"
        title="Setup didn't complete"
        description={error}
        action={
          <Button variant="primary" size="sm" onClick={() => window.location.reload()}>
            Try again
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col items-center gap-6 py-8 text-center">
      <div className="flex size-14 items-center justify-center rounded-full border border-success/30 bg-success-muted text-success">
        <CheckCircle2 size={26} />
      </div>
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-[24px] font-semibold text-foreground tracking-[-0.015em]">
          Your brand profile is saved.
        </h1>
        <p className="max-w-[48ch] text-[14px] leading-relaxed text-muted-foreground">
          Your AI Visibility Baseline will start measuring once the AI Visibility Engine ships (Epic 7) — for now,
          everything you entered is saved and ready. You can review or edit any of it from Settings whenever you like.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <Button variant="primary" size="lg" asChild>
          <Link href="/overview">Go to Overview</Link>
        </Button>
        <Button variant="secondary" size="lg" asChild>
          <Link href="/settings?tab=brand">View brand profile</Link>
        </Button>
      </div>
    </div>
  );
}
