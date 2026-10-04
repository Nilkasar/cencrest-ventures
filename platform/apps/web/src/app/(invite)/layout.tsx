import type { Metadata } from "next";
import { HeroPanel } from "@/components/brand-hero/hero-panel";

export const metadata: Metadata = {
  title: "Accept invitation",
  // An invitation link carries a bearer token in its query string — keep
  // the page out of search indexes and out of Referer headers.
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

const HERO = {
  eyebrow: "Team invitation",
  headline: ["Your team is", "already measuring."],
  description:
    "Join your organization's BeBest workspace to see how ChatGPT, Claude, Gemini and Perplexity talk about your brand — and what to fix next.",
  stats: [
    { value: "4", label: "AI models tracked" },
    { value: "1", label: "Shared workspace" },
    { value: "100%", label: "Answers on record" },
  ],
} as const;

/**
 * `/invitations/accept` frame — the same split as `/login` and `/snapshot`
 * (shared `HeroPanel` on the left on desktop), so an invitee's first
 * impression of the product matches the sign-in it hands them to.
 * Public: listed in `proxy.ts`'s PUBLIC_PREFIXES.
 */
export default function InviteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <HeroPanel {...HERO} />

      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <header className="flex items-center px-6 pt-6 sm:px-10 lg:hidden">
          <a href="https://bebestwithai.com" className="flex items-center gap-2 rounded-md">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-mark.png" alt="" className="size-7 object-contain" />
            <span className="font-display text-[18px] font-semibold tracking-[-0.02em] text-foreground">BeBest</span>
          </a>
        </header>

        <div className="flex flex-1 items-center justify-center px-6 py-10 sm:px-10">
          <div className="w-full max-w-[420px]">{children}</div>
        </div>
      </main>
    </div>
  );
}
