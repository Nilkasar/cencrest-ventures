"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@bebest/ui";
import { setSession, setOrgScopedAccessToken } from "@/lib/auth-state";
import { apiClient } from "@/lib/api-client";

interface MeResponse {
  id: string;
  email: string;
  name: string;
  organizations: { id: string; name: string; slug: string; role: string }[];
}

interface SelectOrgResponse {
  accessToken: string;
  organization: { id: string; name: string; slug: string; role: string };
}

interface CreateOrgResponse {
  id: string;
  name: string;
  slug: string;
}

async function selectInitialOrg(): Promise<boolean> {
  try {
    const me = await apiClient.get<MeResponse>("/auth/me");
    let first = me.organizations[0];

    if (!first) {
      const rawName = me.name && me.name.length >= 2 ? me.name : me.email.split("@")[0] ?? "My Organization";
      try {
        const newOrg = await apiClient.post<CreateOrgResponse>("/orgs", { name: rawName });
        first = { id: newOrg.id, name: newOrg.name, slug: newOrg.slug, role: "owner" };
      } catch {
        return false;
      }
    }

    const selection = await apiClient.post<SelectOrgResponse>("/auth/select-org", { slug: first.slug });
    setOrgScopedAccessToken(selection.accessToken, selection.organization.slug);
    return true;
  } catch {
    return false;
  }
}

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
    selectInitialOrg()
      .then((hasOrg) => router.replace(hasOrg ? "/overview" : "/onboarding"))
      .catch(() => router.replace("/overview"));
  }, [searchParams, router]);

  if (status.kind === "error") {
    return (
      <div className="flex flex-col items-center text-center gap-5">
        <div className="flex items-center justify-center size-12 rounded-full border border-border bg-surface text-danger">
          <AlertTriangle size={20} />
        </div>
        <div className="flex flex-col gap-1.5">
          <h1 className="font-display text-[22px] font-semibold text-foreground tracking-[-0.015em]">
            Sign-in failed
          </h1>
          <p className="text-[13.5px] text-muted-foreground max-w-[36ch]">{status.message}</p>
        </div>
        <Button variant="primary" size="sm" onClick={() => router.push("/login")}>
          Back to sign in
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center text-center gap-5">
      <div className="flex items-center justify-center size-12 rounded-full border border-border bg-surface text-accent">
        <Loader2 size={20} className="animate-spin" />
      </div>
      <div className="flex flex-col gap-1.5">
        <h1 className="font-display text-[22px] font-semibold text-foreground tracking-[-0.015em]">
          Signing you in…
        </h1>
        <p className="text-[13.5px] text-muted-foreground max-w-[36ch]">One moment while we set up your account.</p>
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
