"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input, Textarea, useToast } from "@bebest/ui";
import { useOnboarding } from "@/components/onboarding/onboarding-context";
import { TagInput } from "@/components/onboarding/tag-input";
import { StepActions } from "@/components/onboarding/step-actions";
import { previousStepHref, nextStepHref } from "@/components/onboarding/steps";
import { saveBrandBasics, normalizeUrl } from "@/lib/onboarding-client";

interface FormState {
  name: string;
  websiteUrl: string;
  description: string;
  aliases: string[];
  positioning: string;
  differentiators: string[];
}

interface FormErrors {
  name?: string;
  websiteUrl?: string;
  description?: string;
}

export default function BrandBasicsStep() {
  const router = useRouter();
  const { organizationId, profile, setProfile } = useOnboarding();
  const { toast } = useToast();
  const brand = profile!.brand;

  const [form, setForm] = useState<FormState>({
    name: brand.name,
    websiteUrl: brand.websiteUrl,
    description: brand.description,
    aliases: brand.aliases,
    positioning: brand.positioning,
    differentiators: brand.differentiators,
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);

  function validate(): FormErrors {
    const next: FormErrors = {};
    if (!form.name.trim()) next.name = "Enter your company name.";
    if (!form.websiteUrl.trim()) {
      next.websiteUrl = "Enter your website.";
    } else if (!normalizeUrl(form.websiteUrl)) {
      next.websiteUrl = "Enter a valid website, e.g. acme.com.";
    }
    if (!form.description.trim()) {
      next.description = "Add a short description — this anchors every AI Visibility comparison.";
    } else if (form.description.trim().length < 20) {
      next.description = "Add a little more detail (at least 20 characters).";
    }
    return next;
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const validationErrors = validate();
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) return;

    setSubmitting(true);
    try {
      const normalizedUrl = normalizeUrl(form.websiteUrl) ?? form.websiteUrl;
      const updated = await saveBrandBasics(organizationId, { ...form, websiteUrl: normalizedUrl });
      setProfile(updated);
      router.push(nextStepHref("brand-basics"));
    } catch (error) {
      toast({
        title: "Couldn't save brand basics",
        description: error instanceof Error ? error.message : "Something went wrong — try again.",
        variant: "danger",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <p className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-subtle-foreground">Step 1 of 5</p>
        <h1 className="font-display text-[22px] font-semibold text-foreground tracking-[-0.015em]">Brand basics</h1>
        <p className="text-[13.5px] leading-relaxed text-muted-foreground">
          Confirm the essentials — this is what every downstream measurement in BeBest anchors to.
        </p>
      </div>

      <Input
        label="Company name"
        placeholder="Acme Inc."
        value={form.name}
        onChange={(event) => setForm({ ...form, name: event.target.value })}
        error={errors.name}
        autoFocus
      />
      <Input
        label="Website"
        placeholder="acme.com"
        value={form.websiteUrl}
        onChange={(event) => setForm({ ...form, websiteUrl: event.target.value })}
        error={errors.websiteUrl}
      />
      <Textarea
        label="Description"
        description="A sentence or two — how you'd describe the company to someone who's never heard of it."
        placeholder="Acme helps mid-market manufacturers track shipments in real time..."
        value={form.description}
        onChange={(event) => setForm({ ...form, description: event.target.value })}
        error={errors.description}
        rows={3}
      />
      <TagInput
        label="Aliases"
        description="Other names AI models might use for you — abbreviations, former names, product names."
        placeholder="Type a name and press Enter"
        value={form.aliases}
        onChange={(aliases) => setForm({ ...form, aliases })}
      />
      <Textarea
        label="Positioning statement"
        description="Optional — one sentence on how you want to be described."
        placeholder="The freight partner that tells you where your shipment is before you have to ask."
        value={form.positioning}
        onChange={(event) => setForm({ ...form, positioning: event.target.value })}
        rows={2}
      />
      <TagInput
        label="Key differentiators"
        description="Optional — what you'd point to first in a head-to-head comparison."
        placeholder="Type a differentiator and press Enter"
        value={form.differentiators}
        onChange={(differentiators) => setForm({ ...form, differentiators })}
      />

      <StepActions backHref={previousStepHref("brand-basics")} submitting={submitting} />
    </form>
  );
}
