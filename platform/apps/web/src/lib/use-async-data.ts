"use client";

import { useCallback, useEffect, useState, type DependencyList } from "react";

export type AsyncState<T> =
  | { status: "loading" }
  | { status: "error"; error: Error }
  | { status: "success"; data: T };

/**
 * Generic loading/error/success state for a screen backed by
 * `data/crm/client.ts` (or any async fetcher). Every CRM list and detail
 * view goes through this — never a bare `if (loading) return null` — so
 * swapping the fetcher for a real `apiClient` call later needs no change
 * here.
 */
export function useAsyncData<T>(fetcher: () => Promise<T>, deps: DependencyList = []): AsyncState<T> & { reload: () => void } {
  const [state, setState] = useState<AsyncState<T>>({ status: "loading" });
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // Resetting to "loading" here is the one legitimate case this lint rule
    // flags as a false positive: a dependency change (new filters, a
    // `reload()` call) genuinely needs to show a loading state again before
    // the new fetch resolves, and there's no render-time value to derive
    // that from instead.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({ status: "loading" });
    fetcher()
      .then((data) => {
        if (!cancelled) setState({ status: "success", data });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: "error", error: error instanceof Error ? error : new Error(String(error)) });
      });
    return () => {
      cancelled = true;
    };
    // `fetcher` is expected to be stable-enough per call site (recreated
    // from the same deps); callers pass their own dependency list instead
    // of relying on fetcher identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, reloadToken]);

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  return { ...state, reload };
}
