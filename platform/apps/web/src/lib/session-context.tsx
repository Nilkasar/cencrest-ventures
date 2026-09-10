"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { apiClient } from "./api-client";
import { getRefreshToken } from "./auth-state";
import type { Organization } from "@/data/types";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

export interface SessionOrg {
  id: string;
  slug: string;
  name: string;
  // Reuses `data/types.ts`'s canonical tier union rather than a loose
  // `string`: `competitorLimitFor` and every other entitlement helper is
  // keyed on that union, so a widened type here fails at each call site.
  plan?: Organization["plan"];
  role?: string;
}

interface SessionContextValue {
  user: SessionUser | null;
  org: SessionOrg | null;
  loading: boolean;
  refresh: () => void;
}

const SessionContext = createContext<SessionContextValue>({
  user: null,
  org: null,
  loading: true,
  refresh: () => undefined,
});

export function SessionProvider({ children }: { children: React.ReactNode }) {
  // `loading` is DERIVED, never set: `resolved.tick` records which fetch
  // generation the held user/org came from, so a `refresh()` bump makes the
  // context read as loading on the very same render, with no setState in the
  // effect body (react-hooks/set-state-in-effect) and no cascading render.
  const [resolved, setResolved] = useState<{ user: SessionUser | null; org: SessionOrg | null; tick: number | null }>({
    user: null,
    org: null,
    tick: null,
  });
  const [tick, setTick] = useState(0);
  const loading = resolved.tick !== tick;

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      // No refresh token means "never signed in on this browser" — settle
      // immediately as signed-out rather than calling an API that would 401.
      if (!getRefreshToken()) {
        if (!cancelled) setResolved({ user: null, org: null, tick });
        return;
      }
      try {
        const [me, orgs] = await Promise.all([
          apiClient.get<SessionUser>("/auth/me"),
          apiClient.get<SessionOrg[]>("/orgs"),
        ]);
        if (!cancelled) setResolved({ user: me, org: orgs[0] ?? null, tick });
      } catch {
        if (!cancelled) setResolved({ user: null, org: null, tick });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tick]);

  return (
    <SessionContext.Provider value={{ user: resolved.user, org: resolved.org, loading, refresh }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  return useContext(SessionContext);
}

export function useCurrentUser(): SessionUser | null {
  return useContext(SessionContext).user;
}

export function useCurrentOrg(): SessionOrg | null {
  return useContext(SessionContext).org;
}
