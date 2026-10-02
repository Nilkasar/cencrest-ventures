"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Check, Plus } from "lucide-react";
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

const EASE = [0.16, 1, 0.3, 1] as const;
const INPUT_CLASS = "h-11 rounded-lg text-[14px]";

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
 * (optional), biggest competitor (optional). The two optional fields sit
 * behind a disclosure so the form reads as four questions, not six. Calls
 * the real `POST /api/snapshot` and hands the caller the confirmation
 * payload (including the tokenized report link) the instant the lead is
 * created; `SnapshotIntakeView` decides what happens next.
 */
export function SnapshotIntakeForm({ onSubmitted }: { onSubmitted: (response: SnapshotSubmitResponse) => void }) {
  const [values, setValues] = useState<FormValues>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);
  const [showContext, setShowContext] = useState(false);

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
    <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Name"
          name="name"
          autoComplete="name"
          placeholder="Jane Rivera"
          className={INPUT_CLASS}
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
          className={INPUT_CLASS}
          value={values.email}
          onChange={(e) => setField("email", e.target.value)}
          error={fieldErrors.email}
        />
        <Input
          label="Company"
          name="company"
          autoComplete="organization"
          placeholder="Acme Inc."
          className={INPUT_CLASS}
          value={values.company}
          onChange={(e) => setField("company", e.target.value)}
          error={fieldErrors.company}
        />
        <Input
          label="Website"
          name="website"
          autoComplete="url"
          inputMode="url"
          placeholder="acme.com"
          className={INPUT_CLASS}
          value={values.website}
          onChange={(e) => setField("website", e.target.value)}
          error={fieldErrors.website}
        />
      </div>

      <div className="flex flex-col">
        <button
          type="button"
          onClick={() => setShowContext((v) => !v)}
          aria-expanded={showContext}
          aria-controls="snapshot-optional-context"
          className="group flex w-fit items-center gap-2 rounded-md text-left text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-border transition-colors group-hover:border-border-strong">
            <Plus
              size={12}
              className={`transition-transform duration-300 ease-[var(--ease-emphasized)] ${showContext ? "rotate-45" : ""}`}
              aria-hidden="true"
            />
          </span>
          <span>
            Add your category &amp; main competitor{" "}
            <span className="font-normal text-subtle-foreground">· optional</span>
          </span>
        </button>

        <AnimatePresence initial={false}>
          {showContext && (
            <motion.div
              id="snapshot-optional-context"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.35, ease: EASE }}
              className="overflow-hidden"
            >
              <div className="grid gap-4 px-0.5 pb-0.5 pt-4 sm:grid-cols-2">
                <Input
                  label="Industry / category"
                  name="category"
                  placeholder="Project management software"
                  className={INPUT_CLASS}
                  value={values.category}
                  onChange={(e) => setField("category", e.target.value)}
                />
                <Input
                  label="Biggest competitor"
                  name="biggestCompetitor"
                  placeholder="Asana"
                  className={INPUT_CLASS}
                  value={values.biggestCompetitor}
                  onChange={(e) => setField("biggestCompetitor", e.target.value)}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence initial={false}>
        {formError && (
          <motion.p
            role="alert"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25, ease: EASE }}
            className="rounded-lg border border-danger/30 bg-danger-muted px-4 py-3 text-[13px] text-danger"
          >
            {formError}
          </motion.p>
        )}
      </AnimatePresence>

      <div className="flex flex-col gap-4 pt-1">
        <Button
          type="submit"
          variant="primary"
          size="lg"
          loading={submitting}
          className="group h-12 w-full rounded-xl text-[15px] shadow-md hover:shadow-lg"
        >
          {submitting ? "Starting your snapshot…" : "Get my free snapshot"}
          {!submitting && (
            <ArrowRight
              size={16}
              className="transition-transform duration-300 ease-[var(--ease-emphasized)] group-hover:translate-x-1"
              aria-hidden="true"
            />
          )}
        </Button>
        <ul className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5 text-[12.5px] text-subtle-foreground">
          {["Free, no credit card", "Results within 24h", "No spam"].map((item) => (
            <li key={item} className="flex items-center gap-1.5">
              <Check size={13} className="text-accent" aria-hidden="true" />
              {item}
            </li>
          ))}
        </ul>
      </div>
    </form>
  );
}
