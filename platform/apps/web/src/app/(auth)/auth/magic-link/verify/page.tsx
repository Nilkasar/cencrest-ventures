"use client";

/**
 * The other half of the magic-link flow. The URL shape here — literally
 * `/auth/magic-link/verify?token=...` — is not arbitrary: it has to match
 * what `apps/api/src/routes/auth.ts`'s `POST /magic-link` embeds in the
 * email it sends (`${appUrl}/auth/magic-link/verify?token=${token}`, where
 * `appUrl` is this web app's own origin). `ConsoleEmailSender` just logs
 * that URL instead of emailing it in this environment, but the URL a real
 * email would contain, and what this page does with it, are both real.
 */

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@bebest/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { setSession } from "@/lib/auth-state";
import { completeSignIn } from "@/lib/post-login";

interface VerifyResponse {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; name: string };
}

type Status = { kind: "verifying" } | { kind: "success" } | { kind: "error"; message: string };

function messageFor(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 404) return "This link isn't valid — it may have been copied incorrectly.";
    if (err.status === 410) return "This link has expired. Magic links are valid for 15 minutes.";
    if (err.status === 409) return "This link was already used. Request a new one to sign in.";
    if (err.status === 400) {
      const body = err.body as Record<string, unknown> | null;
      if (body && typeof body.error === "string" && body.error.toLowerCase().includes("already used")) {
        return "This link was already used. Request a new one to sign in.";
      }
      return "This link isn't valid — it may have been copied incorrectly.";
    }
  }
  return "Something went wrong verifying that link. Please try again.";
}

function VerifyContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [status, setStatus] = useState<Status>({ kind: "verifying" });
  // StrictMode/fast-refresh double-invokes effects; the magic-link token is
  // single-use server-side, so a second real call would always fail with
  // "already used" even though the first one succeeded. Guard against that.
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;

    if (!token) {
      // Same legitimate case `use-async-data.ts` documents: there's no
      // render-time value to derive "missing token" from, this effect is
      // the only place that can observe it.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStatus({ kind: "error", message: "This link is missing its token." });
      return;
    }

    apiClient
      .post<VerifyResponse>("/auth/magic-link/verify", { token })
      .then(async (data) => {
        setSession({ accessToken: data.accessToken, refreshToken: data.refreshToken });
        // Org selection/bootstrap + where to land: lib/post-login.ts.
        const destination = await completeSignIn();
        setStatus({ kind: "success" });
        router.replace(destination);
      })
      .catch((err: unknown) => {
        setStatus({ kind: "error", message: messageFor(err) });
      });
  }, [token, router]);

  if (status.kind === "verifying" || status.kind === "success") {
    return (
      <div className="flex flex-col items-center text-center gap-7">
        <div className="flex items-center justify-center size-16 rounded-full bg-accent-muted text-accent">
          <Loader2 size={24} className="animate-spin" />
        </div>
        <div className="flex flex-col gap-3">
          <h1 className="font-display text-[28px] font-semibold leading-[1.1] text-foreground tracking-[-0.02em]">
            Signing you in…
          </h1>
          <p className="text-pretty text-[14.5px] leading-relaxed text-muted-foreground">One moment while we verify your link.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center text-center gap-7">
      <div className="flex items-center justify-center size-16 rounded-full bg-danger-muted text-danger">
        <AlertTriangle size={24} />
      </div>
      <div className="flex flex-col gap-3">
        <h1 className="font-display text-[28px] font-semibold leading-[1.1] text-foreground tracking-[-0.02em]">
          Couldn&apos;t sign you in
        </h1>
        <p className="text-pretty text-[14.5px] leading-relaxed text-muted-foreground">{status.message}</p>
      </div>
      <Button
        variant="primary"
        size="lg"
        className="h-12 w-full rounded-xl text-[15px] shadow-md"
        onClick={() => router.push("/login")}
      >
        Request a new link
      </Button>
    </div>
  );
}

export default function MagicLinkVerifyPage() {
  return (
    <Suspense fallback={null}>
      <VerifyContent />
    </Suspense>
  );
}
