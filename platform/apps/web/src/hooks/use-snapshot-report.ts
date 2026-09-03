"use client";

import { useEffect, useState } from "react";
import { getSnapshotReport, SnapshotNotFoundError } from "@/data/snapshot/client";
import type { FreeSnapshotReport } from "@/data/snapshot/types";

const POLL_INTERVAL_MS = 4000;

export type SnapshotReportState =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "preparing"; message: string }
  | { status: "failed"; message: string }
  | { status: "error"; error: Error }
  | { status: "ready"; report: FreeSnapshotReport };

/**
 * Polls `GET /snapshot/:token` (`getSnapshotReport`) once every four seconds
 * for as long as the pipeline is non-terminal (`pending`/`processing`) —
 * same shape as `use-crawl-job.ts`/`use-ai-run.ts`, adapted for a public,
 * tokenized resource with no organization id to key the fetch on. Four
 * seconds rather than those hooks' one/two: this pipeline runs four other
 * epics' engines in sequence for an anonymous visitor with nothing else to
 * watch tick, so a coarser interval is kinder to the rate-limited public
 * endpoint without costing the visitor a noticeably slower reveal.
 *
 * Stops polling the moment the row reaches `complete` or `failed`, or the
 * token turns out not to resolve at all (`SnapshotNotFoundError` — a typed,
 * terminal state distinct from a transient network `error`).
 */
export function useSnapshotReport(token: string): SnapshotReportState {
  const [state, setState] = useState<SnapshotReportState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      try {
        const response = await getSnapshotReport(token);
        if (cancelled) return;

        if (response.status === "complete") {
          setState({ status: "ready", report: response.report });
          return;
        }
        if (response.status === "failed") {
          setState({ status: "failed", message: response.message });
          return;
        }
        setState({ status: "preparing", message: response.message });
        timer = setTimeout(poll, POLL_INTERVAL_MS);
      } catch (error) {
        if (cancelled) return;
        if (error instanceof SnapshotNotFoundError) {
          setState({ status: "not-found" });
          return;
        }
        setState({ status: "error", error: error instanceof Error ? error : new Error(String(error)) });
      }
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({ status: "loading" });
    void poll();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [token]);

  return state;
}
