"use client";

import { motion } from "framer-motion";
import { SnapshotSignalField } from "./snapshot-signal-field";

const EASE = [0.16, 1, 0.3, 1] as const;

const STATS = [
  { value: "4", label: "AI models queried" },
  { value: "Top 3", label: "Competitors compared" },
  { value: "24h", label: "To your inbox" },
] as const;

/** One headline line revealed from behind a mask — reads as typeset, not faded. */
function RevealLine({ children, delay, className }: { children: React.ReactNode; delay: number; className?: string }) {
  return (
    <span className="block overflow-hidden pb-[0.08em]">
      <motion.span
        className={`block ${className ?? ""}`}
        initial={{ y: "105%" }}
        animate={{ y: 0 }}
        transition={{ duration: 0.9, delay, ease: EASE }}
      >
        {children}
      </motion.span>
    </span>
  );
}

/**
 * Dark left half of the snapshot intake screen (desktop only). Three bands:
 * brand, the pitch + live signal visual (which absorbs any spare height and
 * shrinks first on short viewports), and the three facts that answer
 * "what do I get".
 */
export function SnapshotHeroPanel() {
  return (
    <aside className="relative hidden lg:flex w-[54%] shrink-0 flex-col overflow-hidden bg-ink-950 text-ink-0">
      <div className="snapshot-grid pointer-events-none absolute inset-0" aria-hidden="true" />
      <div
        className="pointer-events-none absolute -right-40 -top-40 size-[520px] rounded-full bg-verdant-500/10 blur-3xl"
        aria-hidden="true"
      />

      <div className="relative mx-auto flex h-full w-full max-w-[760px] flex-col px-12 py-10 xl:px-16 [@media(max-height:760px)]:py-8">
        <motion.a
          href="https://bebestwithai.com"
          className="flex w-fit items-center gap-2.5 rounded-md"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, ease: EASE }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-mark.png" alt="" className="size-8 object-contain" />
          <span className="font-display text-[20px] font-semibold tracking-[-0.02em]">BeBest</span>
        </motion.a>

        <div className="flex min-h-0 flex-1 flex-col justify-center gap-8 py-8 [@media(max-height:760px)]:gap-5 [@media(max-height:760px)]:py-5">
          <div className="flex flex-col gap-5 [@media(max-height:760px)]:gap-3">
            <motion.p
              className="flex items-center gap-2 font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-verdant-300"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.05, ease: EASE }}
            >
              <span className="relative flex size-1.5" aria-hidden="true">
                <span className="absolute inset-0 animate-ping rounded-full bg-verdant-400 opacity-60" />
                <span className="relative size-1.5 rounded-full bg-verdant-400" />
              </span>
              Free AI Visibility Snapshot
            </motion.p>

            <p className="font-display text-[clamp(40px,3.9vw,60px)] font-semibold leading-[1.02] tracking-[-0.025em] [@media(max-height:760px)]:text-[clamp(36px,3.3vw,48px)]">
              <RevealLine delay={0.1}>Does AI recommend</RevealLine>
              <RevealLine delay={0.2} className="text-verdant-400">
                your brand?
              </RevealLine>
            </p>

            <motion.p
              className="max-w-[460px] text-[15px] leading-relaxed text-ink-0/60 [@media(max-height:700px)]:hidden"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.35, ease: EASE }}
            >
              We ask ChatGPT, Claude, Gemini and Perplexity the questions your buyers ask — then show you exactly where
              you stand against your competitors.
            </motion.p>
          </div>

          <motion.div
            className="flex min-h-[170px] max-h-[440px] flex-1 items-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1, delay: 0.3, ease: EASE }}
          >
            <SnapshotSignalField className="h-full max-h-full w-full max-w-[640px]" />
          </motion.div>
        </div>

        <dl className="grid grid-cols-3 border-t border-ink-0/10 pt-6 [@media(max-height:760px)]:pt-4">
          {STATS.map((s, i) => (
            <motion.div
              key={s.label}
              className={`flex flex-col-reverse gap-1.5 ${i > 0 ? "border-l border-ink-0/10 pl-6" : "pr-6"}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.55 + i * 0.08, ease: EASE }}
            >
              <dt className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-0/45">{s.label}</dt>
              <dd className="font-display text-[24px] font-semibold leading-none tracking-[-0.02em]">{s.value}</dd>
            </motion.div>
          ))}
        </dl>
      </div>
    </aside>
  );
}
