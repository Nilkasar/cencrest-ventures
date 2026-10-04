"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@bebest/ui";
import { setSession } from "@/lib/auth-state";
import { completeSignIn } from "@/lib/post-login";

type Status = { kind: "processing" } | { kind: "error"; message: string };

const ERROR_MESSAGES: Record<string, string> = {
  denied: "You cancelled the Google sign-in.",
  invalid: "The sign-in request was invalid. Please try again.",
  unverified: "Your Google account email isn't verified.",
  failed: "Google sign-in failed. Please try again.",
};

function GoogleCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const attempted = useRef(false);
  const [status, setStatus] = useState<Status>({ kind: "processing" });

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;

    const error = searchParams.get("error");
    if (error) {
      setStatus({ kind: "error", message: ERROR_MESSAGES[error] ?? "Google sign-in failed. Please try again." });
      return;
    }

    const accessToken = searchParams.get("accessToken");
    const refreshToken = searchParams.get("refreshToken");

    if (!accessToken || !refreshToken) {
      setStatus({ kind: "error", message: "Missing tokens from Google sign-in. Please try again." });
      return;
    }

    setSession({ accessToken, refreshToken });
    // Org selection/bootstrap + where to land: lib/post-login.ts.
    void completeSignIn().then((destination) => router.replace(destination));
  }, [searchParams, router]);

  if (status.kind === "error") {
    return (
      <div className="flex flex-col items-center text-center gap-7">
        <div className="flex items-center justify-center size-16 rounded-full bg-danger-muted text-danger">
          <AlertTriangle size={24} />
        </div>
        <div className="flex flex-col gap-3">
          <h1 className="font-display text-[28px] font-semibold leading-[1.1] text-foreground tracking-[-0.02em]">
            Sign-in failed
          </h1>
          <p className="text-pretty text-[14.5px] leading-relaxed text-muted-foreground">{status.message}</p>
        </div>
        <Button
          variant="primary"
          size="lg"
          className="h-12 w-full rounded-xl text-[15px] shadow-md"
          onClick={() => router.push("/login")}
        >
          Back to sign in
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center text-center gap-7">
      <div className="flex items-center justify-center size-16 rounded-full bg-accent-muted text-accent">
        <Loader2 size={24} className="animate-spin" />
      </div>
      <div className="flex flex-col gap-3">
        <h1 className="font-display text-[28px] font-semibold leading-[1.1] text-foreground tracking-[-0.02em]">
          Signing you in…
        </h1>
        <p className="text-pretty text-[14.5px] leading-relaxed text-muted-foreground">One moment while we set up your account.</p>
      </div>
    </div>
  );
}

export default function GoogleCallbackPage() {
  return (
    <Suspense fallback={null}>
      <GoogleCallbackContent />
    </Suspense>
  );
}
