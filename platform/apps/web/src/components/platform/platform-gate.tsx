"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Skeleton, SkeletonText } from "@bebest/ui";
import { useSession } from "@/lib/session-context";

/**
 * Sends non-staff away from `/platform/*` as soon as the session says so
 * (`/auth/me`'s `platformRole`). A hint, not the boundary — the API 403s
 * every Platform route for them regardless.
 */
export function PlatformGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, platformRole, loading } = useSession();
  const denied = !loading && (!user || platformRole === "none");

  useEffect(() => {
    if (denied) router.replace("/overview");
  }, [denied, router]);

  if (loading && !user) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true" aria-label="Checking platform access">
        <Skeleton className="h-28 w-full rounded-xl" />
        <SkeletonText lines={3} />
      </div>
    );
  }
  if (denied) {
    return (
      <p role="status" className="py-10 text-center text-[13px] text-muted-foreground">
        The Platform view is for BeBest staff. Taking you to your Overview…
      </p>
    );
  }
  return <>{children}</>;
}
