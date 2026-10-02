"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Mail, Lock, ArrowRight } from "lucide-react";
import { Button, Input } from "@bebest/ui";
import { apiClient } from "@/lib/api-client";

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
    <div className="flex flex-col items-center gap-7">
      {/* Logo mark */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-mark.png" alt="BeBest" className="size-10 object-contain" />

      {/* Heading */}
      <div className="flex flex-col items-center gap-1.5 text-center">
        <h1 className="font-display text-[38px] font-semibold text-foreground tracking-[-0.02em] leading-tight">
          Welcome back.
        </h1>
        <p className="text-[14px] text-muted-foreground">
          See how AI sees your brand.
        </p>
      </div>

      <div className="flex flex-col gap-4 w-full">
        <button
          type="button"
          onClick={() => { window.location.href = `${process.env.NEXT_PUBLIC_API_URL}/auth/google`; }}
          className="flex w-full items-center justify-center gap-3 rounded-xl border border-border bg-surface-raised py-3 text-[14px] font-medium text-foreground transition-colors hover:bg-surface"
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

        {/* Or divider */}
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-border" />
          <span className="text-[12px] text-subtle-foreground">or</span>
          <div className="flex-1 h-px bg-border" />
        </div>

        {/* Email form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
          {/* Mail icon inside input via relative wrapper */}
          <div className="relative">
            <Mail
              size={15}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle-foreground pointer-events-none"
              aria-hidden="true"
            />
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
              className="pl-9"
            />
          </div>

          <Button
            type="submit"
            size="lg"
            loading={submitting}
            className="w-full rounded-xl py-3.5 bg-verdant-700 hover:bg-verdant-800 text-ink-0 font-medium"
          >
            Continue with email <ArrowRight size={15} />
          </Button>
        </form>

        {/* Lock notice */}
        <div className="flex items-start gap-2">
          <Lock size={12} className="mt-0.5 shrink-0 text-subtle-foreground" aria-hidden="true" />
          <p className="text-[12.5px] text-subtle-foreground leading-relaxed">
            We&apos;ll send you a secure one-time link — no password required.
          </p>
        </div>
      </div>

      {/* Legal */}
      <p className="text-[11.5px] text-subtle-foreground text-center leading-relaxed">
        By continuing, you agree to our{" "}
        <a href="/terms" className="underline underline-offset-2 hover:text-foreground transition-colors">
          Terms
        </a>{" "}
        and{" "}
        <a href="/privacy-policy" className="underline underline-offset-2 hover:text-foreground transition-colors">
          Privacy Policy
        </a>
        .
      </p>
    </div>
  );
}
