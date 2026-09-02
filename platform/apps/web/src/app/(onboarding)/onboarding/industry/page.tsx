"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Badge, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, useToast } from "@bebest/ui";
import { useOnboarding } from "@/components/onboarding/onboarding-context";
import { TagInput } from "@/components/onboarding/tag-input";
import { StepActions } from "@/components/onboarding/step-actions";
import { previousStepHref, nextStepHref } from "@/components/onboarding/steps";
import { saveIndustryCategory } from "@/lib/onboarding-client";
import { INDUSTRY_OPTIONS } from "@/data/brand-constants";

const MAX_INDUSTRIES = 3;

export default function IndustryStep() {
  const router = useRouter();
  const { organizationId, profile, setProfile } = useOnboarding();
  const { toast } = useToast();
  const brand = profile!.brand;

  const [industries, setIndustries] = useState<string[]>(brand.industries);
  const [categories, setCategories] = useState<string[]>(brand.categories);
  const [markets, setMarkets] = useState<string[]>(brand.markets);
  const [error, setError] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);

  function addIndustry(value: string) {
    if (industries.includes(value) || industries.length >= MAX_INDUSTRIES) return;
    setIndustries([...industries, value]);
    setError(undefined);
  }

  function removeIndustry(value: string) {
    setIndustries(industries.filter((i) => i !== value));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (industries.length === 0) {
      setError("Select at least one industry.");
      return;
    }
    setSubmitting(true);
    try {
      const updated = await saveIndustryCategory(organizationId, { industries, categories, markets });
      setProfile(updated);
      router.push(nextStepHref("industry"));
    } catch (err) {
      toast({
        title: "Couldn't save",
        description: err instanceof Error ? err.message : "Something went wrong — try again.",
        variant: "danger",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <p className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-subtle-foreground">Step 3 of 5</p>
        <h1 className="font-display text-[22px] font-semibold text-foreground tracking-[-0.015em]">Industry &amp; category</h1>
        <p className="text-[13.5px] leading-relaxed text-muted-foreground">
          This scopes which buying questions and AI comparisons apply to you.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between">
          <label className="text-[12.5px] font-medium text-foreground">Industry</label>
          <span className="font-mono text-[11px] text-subtle-foreground">
            {industries.length}/{MAX_INDUSTRIES}
          </span>
        </div>
        <Select value="" onValueChange={addIndustry}>
          <SelectTrigger disabled={industries.length >= MAX_INDUSTRIES}>
            <SelectValue placeholder={industries.length >= MAX_INDUSTRIES ? "Maximum reached" : "Add an industry"} />
          </SelectTrigger>
          <SelectContent>
            {INDUSTRY_OPTIONS.filter((option) => !industries.includes(option)).map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {industries.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1.5">
            {industries.map((industry) => (
              <Badge key={industry} variant="accent" size="sm" className="gap-1 pr-1">
                {industry}
                <button
                  type="button"
                  onClick={() => removeIndustry(industry)}
                  className="rounded-full p-0.5 hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`Remove ${industry}`}
                >
                  <X size={10} />
                </button>
              </Badge>
            ))}
          </div>
        )}
        {error && (
          <p role="alert" className="text-[12px] text-danger">
            {error}
          </p>
        )}
      </div>

      <TagInput
        label="Categories"
        description="Optional — the specific product/service categories you compete in."
        placeholder="e.g. Freight brokerage — press Enter"
        value={categories}
        onChange={setCategories}
      />

      <TagInput
        label="Markets"
        description="Optional — the geographies you sell into."
        placeholder="e.g. North America — press Enter"
        value={markets}
        onChange={setMarkets}
      />

      <StepActions backHref={previousStepHref("industry")} submitting={submitting} />
    </form>
  );
}
