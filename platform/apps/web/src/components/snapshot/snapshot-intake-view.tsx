"use client";

import { useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { SnapshotIntakeForm } from "./snapshot-intake-form";
import { SnapshotConfirmation } from "./snapshot-confirmation";
import { SnapshotHeroPanel } from "./snapshot-hero-panel";
import type { SnapshotSubmitResponse } from "@/data/snapshot/types";

const EASE = [0.16, 1, 0.3, 1] as const;

/**
 * The public snapshot intake screen: dark hero on the left (desktop), the
 * form on the right. Owns its own split layout — the `(marketing)` route
 * group also serves the full-width report page, which must not inherit it.
 */
export function SnapshotIntakeView() {
  const [submitted, setSubmitted] = useState<SnapshotSubmitResponse | undefined>();

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <SnapshotHeroPanel />

      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <header className="flex items-center justify-between gap-4 px-6 pt-6 sm:px-10 lg:justify-end">
          <a href="https://bebestwithai.com" className="flex items-center gap-2 rounded-md lg:hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-mark.png" alt="" className="size-7 object-contain" />
            <span className="font-display text-[18px] font-semibold tracking-[-0.02em] text-foreground">BeBest</span>
          </a>
          <p className="text-[13px] text-muted-foreground">
            <span className="hidden sm:inline">Already a customer? </span>
            <Link
              href="/login"
              className="font-medium text-foreground underline-offset-4 transition-colors hover:text-accent hover:underline"
            >
              Sign in
            </Link>
          </p>
        </header>

        <div className="flex flex-1 items-center justify-center px-6 py-10 sm:px-10">
          <div className="w-full max-w-[440px]">
            <AnimatePresence mode="wait" initial={false}>
              {submitted ? (
                <motion.div
                  key="done"
                  initial={{ opacity: 0, y: 12, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ duration: 0.5, ease: EASE }}
                >
                  <SnapshotConfirmation response={submitted} />
                </motion.div>
              ) : (
                <motion.div
                  key="form"
                  className="flex flex-col gap-8"
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.25, ease: EASE }}
                >
                  <motion.div
                    className="flex flex-col gap-3"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.7, delay: 0.15, ease: EASE }}
                  >
                    <p className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-accent lg:hidden">
                      Free AI Visibility Snapshot
                    </p>
                    <h1 className="text-balance font-display text-[30px] font-semibold leading-[1.08] tracking-[-0.02em] text-foreground sm:text-[34px]">
                      Get your free snapshot
                    </h1>
                    <p className="text-pretty text-[14.5px] leading-relaxed text-muted-foreground">
                      Your AI Visibility Score across four models, benchmarked against your top competitors — with the
                      gaps worth fixing first.
                    </p>
                  </motion.div>

                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.7, delay: 0.25, ease: EASE }}
                  >
                    <SnapshotIntakeForm onSubmitted={setSubmitted} />
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </main>
    </div>
  );
}
