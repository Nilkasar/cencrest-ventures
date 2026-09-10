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
import { setOrgScopedAccessToken, setSession } from "@/lib/auth-state";

interface VerifyResponse {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; name: string };
}

interface MeResponse {
  organizations: { id: string; name: string; slug: string; role: string }[];
}

interface SelectOrgResponse {
  accessToken: string;
  organization: { id: string; name: string; slug: string; role: string };
}

/**
 * A freshly verified access token carries NO org claim (`auth.ts` mints it
 * with `org: null` and expects the client to choose one). Nothing did — so
 * every screen behind an org-scoped route answered 409 "No organization
 * selected" immediately after a successful login. This selects one before
 * handing the user to the app, and persists the choice so a later token
 * refresh can re-attach it.
 *
 * Picking the first membership is the same interim single-org assumption
 * the Settings > Team panel already documents: correct for a user in one
 * organization, and the org switcher is how a multi-org user changes it.
 * Never fatal — a user with no organizations still reaches the app, where
 * onboarding can create one.
 *
 * Returns true when an org was selected, which is also the signal for where
 * to send the user next: a member already has a workspace and belongs in
 * the app, only a user with none needs onboarding.
 */
async function selectInitialOrg(): Promise<boolean> {
  try {
    const me = await apiClient.get<MeResponse>("/auth/me");
    const first = me.organizations[0];
    if (!first) return false;

    const selection = await apiClient.post<SelectOrgResponse>("/auth/select-org", {
      slug: first.slug,
    });
    setOrgScopedAccessToken(selection.accessToken, selection.organization.slug);
    return true;
  } catch {
    // Leave the session as-is; the user is signed in either way.
    return false;
  }
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
        const hasOrg = await selectInitialOrg();
        setStatus({ kind: "success" });
        router.replace(hasOrg ? "/overview" : "/onboarding");
      })
      .catch((err: unknown) => {
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
