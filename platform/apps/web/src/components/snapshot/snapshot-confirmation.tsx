import Link from "next/link";
import { Mail } from "lucide-react";
import { Button } from "@bebest/ui";
import type { SnapshotSubmitResponse } from "@/data/snapshot/types";

/**
 * `docs/09-ux/CUSTOMER_JOURNEY.md` Stage 2 step 4's confirmation screen —
 * the spec's literal copy (`response.message`, sourced from the backend's
 * `CONFIRMATION_MESSAGE` constant, never re-typed here) shown the instant
 * `POST /snapshot` returns, before the orchestrated pipeline has finished.
 *
 * The report link below is a bonus, not a spec requirement: because this
 * environment's `EmailSender` is `ConsoleEmailSender` (no real inbox to
 * check), the response already carries the token/report URL the real email
 * will eventually contain — surfacing it here lets a visitor watch their
 * own snapshot go from "preparing" to "ready" on the report page itself
 * (which polls and renders its own pending state) rather than staring at a
 * dead end while an email that isn't really being delivered "arrives."
 */
export function SnapshotConfirmation({ response }: { response: SnapshotSubmitResponse }) {
  return (
    <div className="flex flex-col items-center text-center gap-6 rounded-xl border border-border bg-surface-raised px-8 py-14">
      <div className="flex items-center justify-center size-12 rounded-full border border-border bg-surface text-accent" aria-hidden="true">
        <Mail size={20} />
      </div>
      <div className="flex flex-col gap-2 max-w-md">
        <p className="font-display text-[20px] font-semibold text-foreground tracking-[-0.01em]">{response.message}</p>
        <p className="text-[13.5px] text-muted-foreground leading-relaxed">
          We&apos;re crawling your site, sampling AI queries across four models, and running a basic SEO pass. This
          usually takes a few minutes.
        </p>
      </div>
      <Button asChild variant="primary" size="lg">
        <Link href={`/snapshot/${response.token}`}>Watch your snapshot come together</Link>
      </Button>
    </div>
  );
}
