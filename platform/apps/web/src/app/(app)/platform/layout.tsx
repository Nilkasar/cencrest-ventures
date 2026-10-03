import { PlatformGate } from "@/components/platform/platform-gate";

/**
 * Platform view (Epic 22) — BeBest staff only. Lives inside `(app)` so it
 * shares the signed-in shell and session; the sidebar swaps to the Platform
 * nav for every `/platform/*` path (`use-workspace-nav.ts`). The gate here
 * is UX only: every `/api/platform/*` route re-checks `platform_role`
 * server-side and answers 403 to everyone else.
 */
export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  return <PlatformGate>{children}</PlatformGate>;
}
