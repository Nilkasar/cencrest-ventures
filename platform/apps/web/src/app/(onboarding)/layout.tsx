import Link from "next/link";
import { X } from "lucide-react";

/**
 * Chrome for the entire onboarding wizard: no `<AppShell>` sidebar/topbar —
 * this is a focused, full-attention flow (same instinct as the `(auth)`
 * group), just a wordmark and an explicit exit instead of a split hero.
 * Exiting is safe at any point: every step persists on its own "Continue"
 * (see `src/lib/onboarding-client.ts`), so there is nothing to warn about
 * losing.
 */
export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-background">
      <header className="flex items-center justify-between border-b border-border px-6 py-4 sm:px-8">
        <div className="flex items-center gap-2">
          <span className="font-display text-[16px] font-semibold text-foreground tracking-[-0.02em]">BeBest</span>
          <span className="size-1.5 rounded-full bg-accent" aria-hidden="true" />
        </div>
        <Link
          href="/overview"
          className="flex items-center gap-1.5 text-[12.5px] font-medium text-muted-foreground hover:text-foreground"
        >
          <X size={14} /> Exit
        </Link>
      </header>
      <main className="px-6 py-10 sm:px-8 sm:py-14">{children}</main>
    </div>
  );
}
