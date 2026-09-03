"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
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
    </div>
  );
}
