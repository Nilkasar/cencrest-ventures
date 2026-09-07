"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { apiClient } from "./api-client";
import { getRefreshToken } from "./auth-state";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

export interface SessionOrg {
  id: string;
  slug: string;
  name: string;
  plan?: string;
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
  const [user, setUser] = useState<SessionUser | null>(null);
  const [org, setOrg] = useState<SessionOrg | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!getRefreshToken()) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    Promise.all([
      apiClient.get<SessionUser>("/auth/me"),
      apiClient.get<SessionOrg[]>("/orgs"),
    ])
      .then(([me, orgs]) => {
        if (cancelled) return;
        setUser(me);
        setOrg(orgs[0] ?? null);
      })
      .catch(() => {
        if (cancelled) return;
        setUser(null);
        setOrg(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [tick]);

  return (
    <SessionContext.Provider value={{ user, org, loading, refresh }}>
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
