"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@bebest/ui";

interface StepActionsProps {
  backHref?: string;
  continueLabel?: string;
  submitting?: boolean;
  onContinue?: () => void;
}

/** Shared footer for every wizard step — Back (plain link, never loses
 *  data since each step already saved before this renders) and Continue
 *  (the actual submit trigger, form-associated via `type="submit"` in the
 *  parent `<form>` unless `onContinue` is given for steps that validate
 *  something other than a single form, like a list's minimum count). */
export function StepActions({ backHref, continueLabel = "Continue", submitting, onContinue }: StepActionsProps) {
  return (
    <div className="mt-8 flex items-center justify-between border-t border-border pt-6">
      {backHref ? (
        <Button variant="ghost" size="md" asChild>
          <Link href={backHref}>Back</Link>
        </Button>
      ) : (
        <span />
      )}
      <Button type={onContinue ? "button" : "submit"} variant="primary" size="md" loading={submitting} onClick={onContinue}>
        {continueLabel} <ArrowRight size={15} />
      </Button>
    </div>
  );
}
