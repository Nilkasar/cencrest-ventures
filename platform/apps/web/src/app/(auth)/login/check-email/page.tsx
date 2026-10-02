"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import { Mail } from "lucide-react";
import { Button } from "@bebest/ui";
import { apiClient } from "@/lib/api-client";

const EASE = [0.16, 1, 0.3, 1] as const;

function CheckEmailContent() {
  const searchParams = useSearchParams();
  const email = searchParams.get("email") ?? "your email";
  const [resent, setResent] = useState(false);
  const [resending, setResending] = useState(false);

  async function handleResend() {
    if (resent || resending) return;
    setResending(true);
    try {
      // Same real `POST /auth/magic-link` call the login screen makes —
      // always "succeeds" from the caller's side (see that endpoint's
      // account-enumeration note in apps/api/src/routes/auth.ts).
      await apiClient.post("/auth/magic-link", { email });
      setResent(true);
    } finally {
      setResending(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-7 text-center">
      <motion.div
        className="relative flex size-16 items-center justify-center rounded-full bg-accent-muted text-accent"
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.6, ease: EASE }}
        aria-hidden="true"
      >
        <span className="absolute inset-0 animate-ping rounded-full bg-accent-muted [animation-duration:2.4s]" />
        <Mail size={24} className="relative" />
      </motion.div>

      <motion.div
        className="flex flex-col gap-3"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.2, ease: EASE }}
      >
        <h1 className="font-display text-[28px] font-semibold leading-[1.1] tracking-[-0.02em] text-foreground">
          Check your email
        </h1>
        <p className="text-pretty text-[14.5px] leading-relaxed text-muted-foreground">
          We sent a sign-in link to <span className="font-medium text-foreground">{email}</span>. It&apos;s valid
          for 15 minutes.
        </p>
      </motion.div>

      <motion.div
        className="flex w-full flex-col items-center gap-4"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.35, ease: EASE }}
      >
        <Button
          variant="secondary"
          size="lg"
          className="h-11 w-full rounded-xl"
          onClick={handleResend}
          loading={resending}
          disabled={resent}
        >
          {resent ? "Link resent" : "Resend link"}
        </Button>
        <Link
          href="/login"
          className="text-[13px] text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
        >
          Use a different email
        </Link>
      </motion.div>
    </div>
  );
}

export default function CheckEmailPage() {
  return (
    <Suspense fallback={null}>
      <CheckEmailContent />
    </Suspense>
  );
}
