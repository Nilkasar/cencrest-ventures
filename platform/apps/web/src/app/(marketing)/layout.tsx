import Link from "next/link";

/**
 * Epic 17 (Free AI + SEO Growth Snapshot) — the public route group.
 * Unauthenticated, unlike every other segment in this app: `(app)` sits
 * behind a session, `(auth)` is the sign-in flow itself, `(onboarding)` runs
 * right after sign-up. This group has no session at all — a prospect can
 * land here from an ad or a marketing-site link having never heard of
 * BeBest — so the chrome is a plain top bar (logo + a "Sign in" escape
 * hatch for anyone who already has an account), never the authenticated
 * app shell (`components/shell`), which assumes a logged-in org context
 * this visitor doesn't have.
 *
 * `docs/epics/17-free-snapshot.md`'s "UI surface" section calls this out as
 * the pragmatic choice: it lives in `apps/web` so it can reuse `@bebest/ui`
 * and the real API immediately, even though the eventual marketing-site
 * integration is Epic 20's job, not this one's.
 */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh flex flex-col bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
          <Link href="/snapshot" className="flex items-center gap-2">
            <span className="font-display text-[19px] font-semibold text-foreground tracking-[-0.02em]">BeBest</span>
            <span className="size-1.5 rounded-full bg-accent" aria-hidden="true" />
          </Link>
          <Link
            href="/login"
            className="text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Sign in
          </Link>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-border">
        <div className="mx-auto max-w-5xl px-6 py-8 text-[12px] text-subtle-foreground">
          BeBest measures how AI models and search engines see your brand.
        </div>
      </footer>
    </div>
  );
}
