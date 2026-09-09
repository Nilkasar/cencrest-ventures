"use client";

import { useCallback, useEffect, useRef, useState, type DependencyList } from "react";

export type AsyncState<T> =
  | { status: "loading" }
  | { status: "error"; error: Error }
  | { status: "success"; data: T };

/**
 * Loading/error/success state for a screen backed by an async fetcher.
 *
 * Keeps the previous result on screen while the next one loads. The earlier
 * version reset to `{ status: "loading" }` on every dependency change, so a
 * screen tore its whole table down to skeletons on each keystroke of a
 * debounced search, each filter change and each page turn. Against a remote
 * database that is seconds of blank layout, with the page jumping as
 * content is swapped for placeholders and back.
 *
 * The rule now: skeletons only when there is genuinely nothing to show —
 * the first load, or a retry after an error. Once anything has loaded, a
 * refetch leaves `status: "success"` (and the old `data`) in place and
 * raises `isRefreshing` instead, which screens use for a quiet inline
 * indicator rather than a full teardown.
 *
 * The returned shape is the same discriminated union as before plus
 * `isRefreshing`, so `state.status === "success" && state.data` still
 * narrows exactly as it always did at every call site.
 *
 * A fetch that resolves after a newer one started is discarded, so results
 * can never arrive out of order — the same guard the previous version had.
 */
export function useAsyncData<T>(
  fetcher: () => Promise<T>,
  deps: DependencyList = [],
): AsyncState<T> & { isRefreshing: boolean; reload: () => void } {
  const [state, setState] = useState<AsyncState<T>>({ status: "loading" });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  // Read inside the effect only, so flipping it never re-triggers a fetch.
  const hasData = useRef(false);

  useEffect(() => {
    let cancelled = false;

    if (hasData.current) {
      // Something is already on screen — keep it, and say we're updating.
      setIsRefreshing(true);
    } else {
      // Nothing to preserve: a real first load (or a retry after an error),
      // where the skeleton is the honest thing to show.
      setState({ status: "loading" });
    }

    fetcher()
      .then((data) => {
        if (cancelled) return;
        hasData.current = true;
        setState({ status: "success", data });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        // A failed refresh replaces the stale rows with the error rather
        // than leaving data on screen that no longer matches the filters
        // the user can see selected.
        hasData.current = false;
        setState({ status: "error", error: error instanceof Error ? error : new Error(String(error)) });
      })
      .finally(() => {
        if (!cancelled) setIsRefreshing(false);
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

  return { ...state, isRefreshing, reload };
}
