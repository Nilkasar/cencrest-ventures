"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowRight, Lock } from "lucide-react";
import { Button, Input } from "@bebest/ui";
import { apiClient } from "@/lib/api-client";

const EASE = [0.16, 1, 0.3, 1] as const;

const rise = (delay: number) => ({
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.7, delay, ease: EASE },
});

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!email.trim() || !email.includes("@")) {
      setError("Enter a valid work email.");
      return;
    }
    setError(undefined);
    setSubmitting(true);
    try {
      // Real call: `POST /auth/magic-link` (apps/api/src/routes/auth.ts).
      // Always resolves `{ success: true }` whether or not the email
      // exists — the backend deliberately can't be used to enumerate
      // accounts — so there's no "email not found" branch to handle here.
      await apiClient.post("/auth/magic-link", { email: email.trim() });
      router.push(`/login/check-email?email=${encodeURIComponent(email.trim())}`);
    } catch {
      setError("Couldn't send the link right now. Try again in a moment.");
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <motion.div className="flex flex-col gap-3" {...rise(0.15)}>
        <p className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-accent lg:hidden">
          AI Visibility Platform
        </p>
        <h1 className="font-display text-[30px] font-semibold leading-[1.08] tracking-[-0.02em] text-foreground sm:text-[34px]">
          Welcome back
        </h1>
        <p className="text-[14.5px] leading-relaxed text-muted-foreground">
          Sign in with a one-time link sent to your work email.
        </p>
      </motion.div>

      <motion.form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate {...rise(0.25)}>
        <Input
          label="Work email"
          type="email"
          name="email"
          placeholder="you@company.com"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={error}
          autoFocus
          className="h-11 rounded-lg text-[14px]"
        />

        <div className="flex flex-col gap-4">
          <Button
            type="submit"
            variant="primary"
            size="lg"
            loading={submitting}
            className="group h-12 w-full rounded-xl text-[15px] shadow-md hover:shadow-lg"
          >
            {submitting ? "Sending your link…" : "Continue with email"}
            {!submitting && (
              <ArrowRight
                size={16}
                className="transition-transform duration-300 ease-[var(--ease-emphasized)] group-hover:translate-x-1"
                aria-hidden="true"
              />
            )}
          </Button>
          <p className="flex items-center justify-center gap-1.5 text-[12.5px] text-subtle-foreground">
            <Lock size={12} className="text-accent" aria-hidden="true" />
            No password — we email you a secure link
          </p>
        </div>
      </motion.form>

      <motion.p
        className="border-t border-border pt-6 text-[12px] leading-relaxed text-subtle-foreground"
        {...rise(0.35)}
      >
        By continuing, you agree to our{" "}
        <a
          href="https://bebestwithai.com/terms.html"
          className="underline underline-offset-2 transition-colors hover:text-foreground"
        >
          Terms
        </a>{" "}
        and{" "}
        <a
          href="https://bebestwithai.com/privacy-policy.html"
          className="underline underline-offset-2 transition-colors hover:text-foreground"
        >
          Privacy Policy
        </a>
        .
      </motion.p>
    </div>
  );
}
