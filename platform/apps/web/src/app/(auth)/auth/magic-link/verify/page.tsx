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
import Link from "next/link";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@bebest/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { setCurrentOrgSlug, setOrgScopedAccessToken, setSession } from "@/lib/auth-state";

interface VerifyResponse {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; name: string };
}

type Status = { kind: "verifying" } | { kind: "success" } | { kind: "error"; message: string };

function messageFor(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 404) return "This link isn't valid — it may have been copied incorrectly.";
    if (err.status === 400) return "This link isn't valid — it may have been copied incorrectly.";
    if (err.status === 410) return "This link has expired. Magic links are valid for 15 minutes.";
    if (err.status === 409 || (err.body && typeof err.body === "object" && "error" in err.body)) {
      return "This link was already used. Request a new one to sign in.";
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
        try {
          const orgs = await apiClient.get<Array<{ id: string; slug: string; name: string }>>("/orgs");
          if (orgs.length > 0) {
            const first = orgs[0]!;
            const orgData = await apiClient.post<{ accessToken: string }>("/auth/select-org", { slug: first.slug });
            setCurrentOrgSlug(first.slug);
            setOrgScopedAccessToken(orgData.accessToken);
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setStatus({ kind: "success" });
            router.replace("/overview");
            return;
          }
        } catch {
          // New user with no org yet → fall through to onboarding
        }
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setStatus({ kind: "success" });
        router.replace("/onboarding");
      })
      .catch((err: unknown) => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setStatus({ kind: "error", message: messageFor(err) });
      });
  }, [token, router]);

  if (status.kind === "verifying" || status.kind === "success") {
    return (
      <div className="flex flex-col items-center text-center gap-5">
        <div className="flex items-center justify-center size-12 rounded-full border border-border bg-surface text-accent">
          <Loader2 size={20} className="animate-spin" />
        </div>
        <div className="flex flex-col gap-1.5">
          <h1 className="font-display text-[22px] font-semibold text-foreground tracking-[-0.015em]">
            Signing you in…
          </h1>
          <p className="text-[13.5px] text-muted-foreground max-w-[36ch]">One moment while we verify your link.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center text-center gap-5">
      <div className="flex items-center justify-center size-12 rounded-full border border-border bg-surface text-danger">
        <AlertTriangle size={20} />
      </div>
      <div className="flex flex-col gap-1.5">
        <h1 className="font-display text-[22px] font-semibold text-foreground tracking-[-0.015em]">
          Couldn&apos;t sign you in
        </h1>
        <p className="text-[13.5px] text-muted-foreground max-w-[36ch]">{status.message}</p>
      </div>
      <Button variant="primary" size="sm" onClick={() => router.push("/login")}>
        Back to sign in
      </Button>
      <Link
        href="/login"
        className="text-[12.5px] text-muted-foreground hover:text-foreground underline underline-offset-4"
      >
        Use a different email
      </Link>
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
