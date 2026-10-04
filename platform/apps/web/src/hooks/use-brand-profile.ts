"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BrandProfile } from "@/data/types";
import { getBrandProfile } from "@/lib/onboarding-client";
import { useSession } from "@/lib/session-context";

interface UseBrandProfileResult {
  profile: BrandProfile | undefined;
  loading: boolean;
  error: string | undefined;
  /** Re-fetch from the store — the manual "try again" path. */
  reload: () => void;
  /** Adopt a profile a mutation already returned, without a round trip. */
  setProfile: (profile: BrandProfile) => void;
}

/** Loads (and lets callers update) one organization's brand profile from
 *  the onboarding mock store. Shared by the wizard's context provider and
 *  the Settings > Brand profile panel so both read the same contract.
 *
 *  The fetch effect below only ever calls `setState` inside the promise's
 *  `.then`/`.catch`/`.finally` callbacks (never synchronously in the effect
 *  body) — `reload()` bumps `reloadToken` instead of calling a function
 *  that sets state directly, so `react-hooks/set-state-in-effect` stays
 *  clean without losing the "reload shows a fresh loading state" behavior
 *  (that part happens in `reload` itself, a plain event handler). */
export function useBrandProfile(organizationId: string): UseBrandProfileResult {
  const { loading: sessionLoading } = useSession();
  const [profile, setProfileState] = useState<BrandProfile | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [reloadToken, setReloadToken] = useState(0);
  // Which (org, reload) the held profile/error belong to. `loading` is
  // DERIVED from it rather than stored: an empty org id while the session is
  // still resolving used to report loading=false with no profile, so callers
  // briefly rendered "Start onboarding" for fully set-up users.
  const [settledKey, setSettledKey] = useState<string | null>(null);
  const requestId = useRef(0);
  const key = `${organizationId}:${reloadToken}`;
  const loading = organizationId ? settledKey !== key : sessionLoading;

  useEffect(() => {
    if (!organizationId) return;
    const id = ++requestId.current;
    getBrandProfile(organizationId)
      .then((result) => {
        if (id !== requestId.current) return;
        setProfileState(result);
        setError(undefined);
      })
      .catch((err: unknown) => {
        if (id !== requestId.current) return;
        setError(err instanceof Error ? err.message : "Couldn't load your brand profile.");
      })
      .finally(() => {
        if (id !== requestId.current) return;
        setSettledKey(`${organizationId}:${reloadToken}`);
      });
  }, [organizationId, reloadToken]);

  const reload = useCallback(() => {
    setError(undefined);
    setReloadToken((token) => token + 1);
  }, []);

  return {
    profile,
    loading,
    error,
    reload,
    setProfile: setProfileState,
  };
}
