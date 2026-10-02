"use client";

import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { Button, Input } from "@bebest/ui";
import { normalizeUrl } from "@/lib/onboarding-client";
import { submitFreeSnapshot, SnapshotRateLimitedError, SnapshotValidationError } from "@/data/snapshot/client";
import type { SnapshotSubmitResponse } from "@/data/snapshot/types";

interface FormValues {
  name: string;
  email: string;
  company: string;
  website: string;
  category: string;
  biggestCompetitor: string;
}

const EMPTY_FORM: FormValues = { name: "", email: "", company: "", website: "", category: "", biggestCompetitor: "" };

type FieldErrors = Partial<Record<keyof FormValues, string>>;

/** Client-side pass before the network round trip — the same fields the
 *  server re-validates (`routes/snapshot.ts`'s `snapshotRequestSchema`),
 *  checked here only so a visitor sees a mistake instantly rather than
 *  waiting on a request that was always going to 422. The server's
 *  `isSafePublicHttpUrl` SSRF check on `website` is NOT duplicated here —
 *  that guard resolves DNS and is deliberately server-only; this just
 *  confirms the string parses as a URL at all (`normalizeUrl`, the same
 *  "add https:// if missing, require a dotted hostname" helper the
 *  authenticated competitor-website field already uses). */
function validate(values: FormValues): FieldErrors {
  const errors: FieldErrors = {};
  if (!values.name.trim()) errors.name = "Enter your name.";
  if (!values.email.trim() || !/^\S+@\S+\.\S+$/.test(values.email)) errors.email = "Enter a valid work email.";
  if (!values.company.trim()) errors.company = "Enter your company name.";
  if (!values.website.trim() || !normalizeUrl(values.website)) errors.website = "Enter a valid website (e.g. yourcompany.com).";
  return errors;
}

/**
 * `docs/09-ux/CUSTOMER_JOURNEY.md` Stage 2's intake form, field-for-field:
 * name, work email, company name, website URL, industry/category
 * (optional), biggest competitor (optional). Calls the real
 * `POST /api/snapshot` from the first submit — no fixture layer, per this
 * epic's standing rule — and hands the caller the confirmation payload
 * (including the tokenized report link) the instant the lead is created,
 * rather than owning any post-submit UI itself; `SnapshotIntakeView` (the
 * page-level component) decides what happens next.
 */
export function SnapshotIntakeForm({ onSubmitted }: { onSubmitted: (response: SnapshotSubmitResponse) => void }) {
  const [values, setValues] = useState<FormValues>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);

  function setField<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const errors = validate(values);
    setFieldErrors(errors);
    setFormError(undefined);
    if (Object.keys(errors).length > 0) return;

    setSubmitting(true);
    try {
      const normalizedWebsite = normalizeUrl(values.website) ?? values.website;
      const response = await submitFreeSnapshot({
        name: values.name.trim(),
        email: values.email.trim(),
        company: values.company.trim(),
        website: normalizedWebsite,
        category: values.category.trim() || undefined,
        biggestCompetitor: values.biggestCompetitor.trim() || undefined,
      });
      onSubmitted(response);
    } catch (err) {
      if (err instanceof SnapshotValidationError) {
        setFormError(err.message);
      } else if (err instanceof SnapshotRateLimitedError) {
        setFormError(err.message);
      } else {
        setFormError("Something went wrong submitting your snapshot. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3" noValidate>
      <div className="flex flex-col gap-1.5">
        <p className="text-[11px] font-mono font-medium uppercase tracking-[0.1em] text-subtle-foreground">About you</p>
        <div className="grid gap-2.5 sm:grid-cols-2">
          <Input
            label="Name"
            name="name"
            autoComplete="name"
            placeholder="Jane Rivera"
            value={values.name}
            onChange={(e) => setField("name", e.target.value)}
            error={fieldErrors.name}
          />
          <Input
            label="Work email"
            type="email"
            name="email"
            autoComplete="email"
            placeholder="jane@company.com"
            value={values.email}
            onChange={(e) => setField("email", e.target.value)}
            error={fieldErrors.email}
          />
        </div>
      </div>

      <div className="border-t border-border pt-3 flex flex-col gap-1.5">
        <p className="text-[11px] font-mono font-medium uppercase tracking-[0.1em] text-subtle-foreground">Your brand</p>
        <div className="grid gap-2.5 sm:grid-cols-2">
          <Input
            label="Company name"
            name="company"
            autoComplete="organization"
            placeholder="Acme Inc."
            value={values.company}
            onChange={(e) => setField("company", e.target.value)}
            error={fieldErrors.company}
          />
          <Input
            label="Website URL"
            name="website"
            autoComplete="url"
            placeholder="acme.com"
            value={values.website}
            onChange={(e) => setField("website", e.target.value)}
            error={fieldErrors.website}
          />
          <Input
            label="Industry / category"
            description="Optional — helps us pick the right prompts"
            name="category"
            placeholder="e.g. Project management software"
            value={values.category}
            onChange={(e) => setField("category", e.target.value)}
          />
          <Input
            label="Biggest competitor"
            description="Optional — we'll include them in the comparison"
            name="biggestCompetitor"
            placeholder="e.g. Asana"
            value={values.biggestCompetitor}
            onChange={(e) => setField("biggestCompetitor", e.target.value)}
          />
        </div>
      </div>

      {formError && (
        <p role="alert" className="rounded-lg border border-danger/30 bg-danger/5 px-4 py-3 text-[13px] text-danger">
          {formError}
        </p>
      )}

      <div className="border-t border-border pt-3 flex flex-col gap-2">
        <Button
          type="submit"
          variant="primary"
          size="lg"
          loading={submitting}
          className="w-full rounded-xl bg-verdant-700 hover:bg-verdant-800 text-ink-0"
        >
          Get my free snapshot <ArrowRight size={15} />
        </Button>
        <p className="text-[11.5px] text-subtle-foreground text-center">
          No spam · No credit card · Results in 24 hrs
        </p>
      </div>
    </form>
  );
}
