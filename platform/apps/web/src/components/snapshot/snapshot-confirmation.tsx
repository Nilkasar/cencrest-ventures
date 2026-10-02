"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { Button } from "@bebest/ui";
import type { SnapshotSubmitResponse } from "@/data/snapshot/types";

const EASE = [0.16, 1, 0.3, 1] as const;

/**
 * `docs/09-ux/CUSTOMER_JOURNEY.md` Stage 2 step 4's confirmation screen —
 * the spec's literal copy (`response.message`, sourced from the backend's
 * `CONFIRMATION_MESSAGE` constant, never re-typed here) shown the instant
 * `POST /snapshot` returns, before the orchestrated pipeline has finished.
 *
 * The report link is surfaced here too, so a visitor can watch their own
 * snapshot go from "preparing" to "ready" on the report page itself rather
 * than waiting on the email.
 */
export function SnapshotConfirmation({ response }: { response: SnapshotSubmitResponse }) {
  return (
    <div className="flex flex-col items-center gap-7 text-center">
      <div className="relative flex size-16 items-center justify-center" aria-hidden="true">
        <motion.span
          className="absolute inset-0 rounded-full bg-accent-muted"
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.6, ease: EASE }}
        />
        <svg viewBox="0 0 64 64" className="relative size-16" fill="none">
          <motion.circle
            cx="32"
            cy="32"
            r="30"
            stroke="var(--accent)"
            strokeWidth="1.5"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.8, delay: 0.1, ease: EASE }}
            transform="rotate(-90 32 32)"
          />
          <motion.path
            d="M22 33 L29 40 L43 25"
            stroke="var(--accent)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.45, delay: 0.6, ease: EASE }}
          />
        </svg>
      </div>

      <motion.div
        className="flex flex-col gap-3"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.3, ease: EASE }}
      >
        <h1 className="text-balance font-display text-[28px] font-semibold leading-[1.1] tracking-[-0.02em] text-foreground">
          {response.message}
        </h1>
        <p className="text-pretty text-[14.5px] leading-relaxed text-muted-foreground">
          We&apos;re crawling your site, sampling AI answers across four models and running a basic SEO pass. This
          usually takes a few minutes.
        </p>
      </motion.div>

      <motion.div
        className="w-full"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.45, ease: EASE }}
      >
        <Button asChild variant="primary" size="lg" className="group h-12 w-full rounded-xl text-[15px] shadow-md">
          <Link href={`/snapshot/${response.token}`}>
            Watch your snapshot come together
            <ArrowRight
              size={16}
              className="transition-transform duration-300 ease-[var(--ease-emphasized)] group-hover:translate-x-1"
              aria-hidden="true"
            />
          </Link>
        </Button>
      </motion.div>
    </div>
  );
}
