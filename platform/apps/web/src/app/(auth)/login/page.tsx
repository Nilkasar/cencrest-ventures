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
          Sign in with Google, or with a one-time link sent to your work email.
        </p>
      </motion.div>

      <motion.div className="flex flex-col gap-5" {...rise(0.2)}>
        <button
          type="button"
          onClick={() => {
            window.location.href = `${process.env.NEXT_PUBLIC_API_URL}/auth/google`;
          }}
          className="flex h-12 w-full items-center justify-center gap-3 rounded-xl border border-border bg-surface-raised text-[15px] font-medium text-foreground shadow-sm transition-colors hover:border-border-strong hover:bg-surface"
        >
          {/* Google G logo */}
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
            <path
              d="M17.64 9.205c0-.638-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
              fill="#4285F4"
            />
            <path
              d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
              fill="#34A853"
            />
            <path
              d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
              fill="#FBBC05"
            />
            <path
              d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
              fill="#EA4335"
            />
          </svg>
          Continue with Google
        </button>

        <div className="flex items-center gap-3" aria-hidden="true">
          <div className="h-px flex-1 bg-border" />
          <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-subtle-foreground">or</span>
          <div className="h-px flex-1 bg-border" />
        </div>
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
