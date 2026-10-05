import Link from "next/link";
import { HeroPanel } from "@/components/brand-hero/hero-panel";

const HERO = {
  eyebrow: "AI Visibility Platform",
  headline: ["Become the brand", "AI recommends."],
  description:
    "Measure how ChatGPT, Claude, Gemini and Perplexity discover, trust and recommend your brand — and know exactly what to fix next.",
  stats: [
    { value: "4", label: "AI models tracked" },
    { value: "Top 3", label: "Competitors compared" },
    { value: "100%", label: "Answers on record" },
  ],
} as const;

/**
 * Sign-in flow frame (`/login`, `/login/check-email`, magic-link verify):
 * the same split as the public snapshot screen — shared `HeroPanel` on the
 * left (desktop), the step's own content on the right.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <HeroPanel {...HERO} />

      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <header className="flex items-center justify-between gap-4 px-6 pt-6 sm:px-10 lg:justify-end">
          <a href="https://bebestwithai.com" className="flex items-center gap-2 rounded-md lg:hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-mark.png" alt="" className="size-7 object-contain" />
            <span className="font-display text-[18px] font-semibold tracking-[-0.02em] text-foreground">BeBest</span>
          </a>
          <p className="text-[13px] text-muted-foreground">
            <span className="hidden sm:inline">New to BeBest? </span>
            <Link
              href="/snapshot"
              className="font-medium text-foreground underline-offset-4 transition-colors hover:text-accent hover:underline"
            >
              Get a free snapshot
            </Link>
          </p>
        </header>

        <div className="flex flex-1 items-center justify-center px-6 py-10 sm:px-10">
          <div className="w-full max-w-[400px]">{children}</div>
        </div>
      </main>
    </div>
  );
}
