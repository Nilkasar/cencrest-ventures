"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BrandProfile } from "@/data/types";
import { getBrandProfile } from "@/lib/onboarding-client";

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
  const [profile, setProfileState] = useState<BrandProfile | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const [reloadToken, setReloadToken] = useState(0);
  const requestId = useRef(0);

  useEffect(() => {
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
        setLoading(false);
      });
  }, [organizationId, reloadToken]);

  const reload = useCallback(() => {
    setLoading(true);
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
