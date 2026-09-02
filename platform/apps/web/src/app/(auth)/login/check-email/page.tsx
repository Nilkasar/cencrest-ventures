"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Mail } from "lucide-react";
import { Button } from "@bebest/ui";

function CheckEmailContent() {
  const searchParams = useSearchParams();
  const email = searchParams.get("email") ?? "your email";
  const [resent, setResent] = useState(false);

  return (
    <div className="flex flex-col items-center text-center gap-5">
      <div className="flex items-center justify-center size-12 rounded-full border border-border bg-surface text-accent">
        <Mail size={20} />
      </div>
      <div className="flex flex-col gap-1.5">
        <h1 className="font-display text-[22px] font-semibold text-foreground tracking-[-0.015em]">
          Check your email
        </h1>
        <p className="text-[13.5px] text-muted-foreground max-w-[36ch]">
          We sent a sign-in link to <span className="font-medium text-foreground">{email}</span>. It&apos;ll be
          valid for 15 minutes.
        </p>
      </div>

      <Button variant="secondary" size="sm" onClick={() => setResent(true)} disabled={resent}>
        {resent ? "Link resent" : "Resend link"}
      </Button>

      <Link
        href="/login"
        className="text-[12.5px] text-muted-foreground hover:text-foreground underline underline-offset-4"
      >
        Use a different email
      </Link>
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
