"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { Button, Input } from "@bebest/ui";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!email.trim() || !email.includes("@")) {
      setError("Enter a valid work email.");
      return;
    }
    setError(undefined);
    setSubmitting(true);
    // Stub: no backend call yet. Epic 0's auth service issues the real
    // magic link; this just simulates the request/redirect shape.
    window.setTimeout(() => {
      router.push(`/login/check-email?email=${encodeURIComponent(email)}`);
    }, 500);
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2 lg:hidden">
        <div className="flex items-center gap-2">
          <span className="font-display text-[19px] font-semibold text-foreground tracking-[-0.02em]">BeBest</span>
          <span className="size-1.5 rounded-full bg-accent" aria-hidden="true" />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <h1 className="font-display text-[24px] font-semibold text-foreground tracking-[-0.015em]">Sign in</h1>
        <p className="text-[13.5px] text-muted-foreground">
          We&apos;ll email you a one-time link — no password to remember.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
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
        />
        <Button type="submit" variant="primary" size="lg" loading={submitting} className="w-full">
          Continue with email <ArrowRight size={15} />
        </Button>
      </form>

      <p className="text-[12px] text-subtle-foreground leading-relaxed">
        This is a visual preview — sign-in isn&apos;t wired to a real auth service yet (that&apos;s Epic 0&apos;s
        backend, landing alongside this UI). Continuing takes you straight to the confirmation screen.
      </p>
    </div>
  );
}
