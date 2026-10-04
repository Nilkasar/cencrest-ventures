"use client";

import { useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Input, useToast } from "@bebest/ui";
import { ErrorPanel } from "@/components/patterns/error-panel";
import { FormRow, FormSection } from "@/components/patterns/form-layout";
import { PageStack, Reveal } from "@/components/patterns/motion";
import { SectionSkeleton } from "@/components/patterns/states";
import { useAsyncData } from "@/lib/use-async-data";
import {
  WhiteLabelForbiddenError,
  WhiteLabelNotAvailableError,
  WhiteLabelValidationError,
  getWhiteLabel,
  updateWhiteLabel,
} from "@/data/white-label/client";
import type { WhiteLabelBranding, WhiteLabelPatch } from "@/data/white-label/types";
import { useSession } from "@/lib/session-context";
import { Notice, Switch } from "./form-controls";

/**
 * Settings > White label — `GET/PATCH /orgs/me/settings/white-label`
 * (Epic 18). `PATCH` accepts any subset of fields, so each FormSection saves
 * only its own fields with its own footer (README §3.5), and is disabled
 * until something in it changed. The on/off switch saves immediately.
 *
 * Client-side checks mirror the route's zod `patchSchema` exactly (name
 * 1–255 chars, http(s) URLs ≤ 2048, 6-digit hex, email, domain ≤ 255) so
 * errors appear as you type, not after a round trip. A plan without the
 * `white_label` entitlement gets a 402, surfaced as an upsell to Billing.
 */

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const IDENTITY_FIELDS = ["brandName", "logoUrl", "primaryColor", "secondaryColor"] as const;
const CONTACT_FIELDS = ["supportEmail", "customDomain", "customTermsUrl", "customPrivacyUrl", "hidePoweredBy"] as const;
type FieldKey = (typeof IDENTITY_FIELDS)[number] | (typeof CONTACT_FIELDS)[number];

function isUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function validate(draft: WhiteLabelBranding): Partial<Record<FieldKey, string>> {
  const errors: Partial<Record<FieldKey, string>> = {};
  const name = draft.brandName.trim();
  if (!name) errors.brandName = "Enter the name clients should see.";
  else if (name.length > 255) errors.brandName = "Keep it under 255 characters.";
  for (const key of ["logoUrl", "customTermsUrl", "customPrivacyUrl"] as const) {
    const value = draft[key];
    if (value !== null && (!isUrl(value) || value.length > 2048)) errors[key] = "Enter a full URL starting with https://";
  }
  for (const key of ["primaryColor", "secondaryColor"] as const) {
    const value = draft[key];
    if (value !== null && !HEX_COLOR.test(value)) errors[key] = "Use a 6-digit hex color, e.g. #1F6F5C.";
  }
  if (draft.supportEmail !== null && !EMAIL.test(draft.supportEmail)) errors.supportEmail = "Enter a valid email address.";
  if (draft.customDomain !== null && draft.customDomain.trim().length > 255) errors.customDomain = "Keep it under 255 characters.";
  return errors;
}

function pick(source: WhiteLabelBranding, keys: readonly FieldKey[]): WhiteLabelPatch {
  const patch: WhiteLabelPatch = {};
  for (const key of keys) (patch as Record<string, unknown>)[key] = source[key];
  return patch;
}

function isDirty(draft: WhiteLabelBranding, saved: WhiteLabelBranding, keys: readonly FieldKey[]): boolean {
  return keys.some((key) => draft[key] !== saved[key]);
}

export function WhiteLabelPanel() {
  const router = useRouter();
  const { org } = useSession();
  const { reload, ...state } = useAsyncData(getWhiteLabel, []);
  const [seededFrom, setSeededFrom] = useState<WhiteLabelBranding | null>(null);
  const [saved, setSaved] = useState<WhiteLabelBranding | null>(null);
  const [draft, setDraft] = useState<WhiteLabelBranding | null>(null);
  const [saving, setSaving] = useState<"toggle" | "identity" | "contact" | null>(null);
  const [notAvailable, setNotAvailable] = useState<{ message: string; plan: string } | null>(null);
  const { toast } = useToast();

  // Seed the saved copy and the editable draft from each fresh fetch
  // (render-time sync to a new external value — no effect needed).
  if (state.status === "success" && state.data !== seededFrom) {
    setSeededFrom(state.data);
    setSaved(state.data);
    setDraft(state.data);
  }

  const myRole = org?.role ?? "member";
  const isAdmin = myRole === "owner" || myRole === "admin";

  if (state.status === "error") {
    return <ErrorPanel title="Branding didn't load" message={state.error.message} onRetry={reload} />;
  }

  if (!saved || !draft) {
    return (
      <div aria-busy="true" className="flex flex-col gap-5">
        <span className="sr-only">Loading branding…</span>
        <SectionSkeleton lines={2} titleWidth="w-44" />
        <SectionSkeleton lines={6} titleWidth="w-28" />
      </div>
    );
  }

  const errors = validate(draft);
  const hasErrorIn = (keys: readonly FieldKey[]) => keys.some((key) => errors[key]);
  // Only flag a field once it differs from what's saved — no red on load.
  const shown = (key: FieldKey) => (draft[key] !== saved[key] ? errors[key] : undefined);

  function patchField<K extends keyof WhiteLabelBranding>(key: K, value: WhiteLabelBranding[K]) {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  }

  function handleError(err: unknown, fallback: string) {
    if (err instanceof WhiteLabelNotAvailableError) {
      setNotAvailable({ message: err.message, plan: err.plan });
    } else if (err instanceof WhiteLabelForbiddenError || err instanceof WhiteLabelValidationError) {
      toast({ title: "Couldn't save", description: err.message, variant: "danger" });
    } else {
      toast({ title: fallback, description: "Try again in a moment.", variant: "danger" });
    }
  }

  async function saveSection(section: "identity" | "contact", keys: readonly FieldKey[], e?: FormEvent) {
    e?.preventDefault();
    if (!draft || hasErrorIn(keys)) return;
    setSaving(section);
    setNotAvailable(null);
    try {
      const patch = pick(draft, keys);
      if (typeof patch.brandName === "string") patch.brandName = patch.brandName.trim();
      if (typeof patch.customDomain === "string") patch.customDomain = patch.customDomain.trim() || null;
      const updated = await updateWhiteLabel(patch);
      setSaved(updated);
      setDraft((current) => (current ? { ...current, ...pick(updated, keys) } : updated));
      toast({ title: "Branding saved", variant: "success" });
    } catch (err) {
      handleError(err, "Couldn't save branding");
    } finally {
      setSaving(null);
    }
  }

  function resetSection(keys: readonly FieldKey[]) {
    if (!saved) return;
    setDraft((current) => (current ? { ...current, ...pick(saved, keys) } : saved));
  }

  async function handleToggleEnabled(next: boolean) {
    setSaving("toggle");
    setNotAvailable(null);
    try {
      const updated = await updateWhiteLabel({ enabled: next });
      setSaved((current) => (current ? { ...current, enabled: updated.enabled } : updated));
      setDraft((current) => (current ? { ...current, enabled: updated.enabled } : updated));
      toast({ title: updated.enabled ? "White-label branding on" : "White-label branding off", variant: "success" });
    } catch (err) {
      handleError(err, "Couldn't change that");
    } finally {
      setSaving(null);
    }
  }

  const identityDirty = isDirty(draft, saved, IDENTITY_FIELDS);
  const contactDirty = isDirty(draft, saved, CONTACT_FIELDS);
  const disabled = !isAdmin;

  return (
    <PageStack>
      {!isAdmin && (
        <Reveal>
          <Notice tone="locked" title="View only">
            Only an organization admin or owner can change branding.
          </Notice>
        </Reveal>
      )}

      {notAvailable && (
        <Reveal>
          <Notice
            tone="warning"
            title={`White label isn't included in the ${notAvailable.plan} plan`}
            action={
              <Button variant="secondary" size="sm" onClick={() => router.push("/settings?tab=billing")}>
                View plans
              </Button>
            }
          >
            {notAvailable.message}
          </Notice>
        </Reveal>
      )}

      <FormSection
        title="White-label branding"
        description="Show your agency's brand instead of BeBest's on client-facing reports and the public snapshot page."
        actions={
          <Badge variant={saved.enabled ? "success" : "neutral"} size="sm" dot>
            {saved.enabled ? "On" : "Off"}
          </Badge>
        }
      >
        <SwitchRow
          label="Use my branding"
          description="Takes effect immediately. Your settings below are kept either way."
          checked={saved.enabled}
          onCheckedChange={handleToggleEnabled}
          disabled={disabled || saving !== null}
        />
      </FormSection>

      <form onSubmit={(e) => saveSection("identity", IDENTITY_FIELDS, e)} noValidate>
        <FormSection
          title="Identity"
          description="How your brand appears to clients."
          footer={
            <>
              <Button type="button" variant="ghost" size="sm" onClick={() => resetSection(IDENTITY_FIELDS)} disabled={!identityDirty || saving !== null}>
                Cancel
              </Button>
              <Button type="submit" size="sm" loading={saving === "identity"} disabled={disabled || !identityDirty || hasErrorIn(IDENTITY_FIELDS) || saving !== null}>
                Save changes
              </Button>
            </>
          }
        >
          <FormRow label="Brand name" htmlFor="wl-brand-name" description="Replaces “BeBest” in headers and titles." error={shown("brandName")} required>
            <Input
              id="wl-brand-name"
              value={draft.brandName}
              onChange={(e) => patchField("brandName", e.target.value)}
              disabled={disabled}
              aria-invalid={!!shown("brandName") || undefined}
              maxLength={255}
            />
          </FormRow>
          <FormRow label="Logo URL" htmlFor="wl-logo" description="A hosted PNG or SVG, ideally on a transparent background." error={shown("logoUrl")}>
            <div className="flex items-center gap-3">
              <Input
                id="wl-logo"
                type="url"
                inputMode="url"
                placeholder="https://example.com/logo.png"
                value={draft.logoUrl ?? ""}
                onChange={(e) => patchField("logoUrl", e.target.value || null)}
                disabled={disabled}
                aria-invalid={!!shown("logoUrl") || undefined}
                containerClassName="flex-1"
              />
              {draft.logoUrl && !errors.logoUrl && (
                // eslint-disable-next-line @next/next/no-img-element -- an arbitrary external URL the admin typed; next/image would need it allow-listed
                <img
                  src={draft.logoUrl}
                  alt="Logo preview"
                  className="h-9 max-w-[96px] shrink-0 rounded-md border border-border bg-surface object-contain p-1"
                />
              )}
            </div>
          </FormRow>
          <ColorRow
            label="Primary color"
            id="wl-primary"
            description="Headings, links and chart highlights."
            value={draft.primaryColor}
            onChange={(v) => patchField("primaryColor", v)}
            error={shown("primaryColor")}
            disabled={disabled}
          />
          <ColorRow
            label="Secondary color"
            id="wl-secondary"
            description="Accents and secondary series."
            value={draft.secondaryColor}
            onChange={(v) => patchField("secondaryColor", v)}
            error={shown("secondaryColor")}
            disabled={disabled}
          />
        </FormSection>
      </form>

      <form onSubmit={(e) => saveSection("contact", CONTACT_FIELDS, e)} noValidate>
        <FormSection
          title="Contact & legal"
          description="Where clients go for help, and the terms they see."
          footer={
            <>
              <Button type="button" variant="ghost" size="sm" onClick={() => resetSection(CONTACT_FIELDS)} disabled={!contactDirty || saving !== null}>
                Cancel
              </Button>
              <Button type="submit" size="sm" loading={saving === "contact"} disabled={disabled || !contactDirty || hasErrorIn(CONTACT_FIELDS) || saving !== null}>
                Save changes
              </Button>
            </>
          }
        >
          <FormRow label="Support email" htmlFor="wl-email" description="Shown wherever clients are told to get in touch." error={shown("supportEmail")}>
            <Input
              id="wl-email"
              type="email"
              placeholder="support@example.com"
              value={draft.supportEmail ?? ""}
              onChange={(e) => patchField("supportEmail", e.target.value || null)}
              disabled={disabled}
              aria-invalid={!!shown("supportEmail") || undefined}
            />
          </FormRow>
          <FormRow
            label="Custom domain"
            htmlFor="wl-domain"
            description="Recorded for reference — reports aren't served from it yet."
            error={shown("customDomain")}
          >
            <Input
              id="wl-domain"
              placeholder="reports.example.com"
              value={draft.customDomain ?? ""}
              onChange={(e) => patchField("customDomain", e.target.value || null)}
              disabled={disabled}
              aria-invalid={!!shown("customDomain") || undefined}
              maxLength={255}
            />
          </FormRow>
          <FormRow label="Terms URL" htmlFor="wl-terms" error={shown("customTermsUrl")}>
            <Input
              id="wl-terms"
              type="url"
              inputMode="url"
              placeholder="https://example.com/terms"
              value={draft.customTermsUrl ?? ""}
              onChange={(e) => patchField("customTermsUrl", e.target.value || null)}
              disabled={disabled}
              aria-invalid={!!shown("customTermsUrl") || undefined}
            />
          </FormRow>
          <FormRow label="Privacy URL" htmlFor="wl-privacy" error={shown("customPrivacyUrl")}>
            <Input
              id="wl-privacy"
              type="url"
              inputMode="url"
              placeholder="https://example.com/privacy"
              value={draft.customPrivacyUrl ?? ""}
              onChange={(e) => patchField("customPrivacyUrl", e.target.value || null)}
              disabled={disabled}
              aria-invalid={!!shown("customPrivacyUrl") || undefined}
            />
          </FormRow>
          <SwitchRow
            label="Hide “Powered by BeBest”"
            description="Removes the footer credit from client-facing output."
            checked={draft.hidePoweredBy}
            onCheckedChange={(v) => patchField("hidePoweredBy", v)}
            disabled={disabled}
          />
        </FormSection>
      </form>
    </PageStack>
  );
}

function SwitchRow({
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
}: {
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <FormRow label={label} htmlFor={id} description={<span id={`${id}-desc`}>{description}</span>}>
      <div className="flex h-9 items-center">
        <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} aria-describedby={`${id}-desc`} />
      </div>
    </FormRow>
  );
}

function ColorRow({
  label,
  id,
  description,
  value,
  onChange,
  error,
  disabled,
}: {
  label: string;
  id: string;
  description: string;
  value: string | null;
  onChange: (value: string | null) => void;
  error?: string;
  disabled?: boolean;
}) {
  const valid = value !== null && HEX_COLOR.test(value);
  return (
    <FormRow label={label} htmlFor={id} description={description} error={error}>
      <div className="flex items-center gap-2">
        <label className="relative size-9 shrink-0 cursor-pointer overflow-hidden rounded-md border border-border focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50">
          <span className="sr-only">Pick {label.toLowerCase()}</span>
          <span
            aria-hidden="true"
            className="absolute inset-0 bg-surface"
            style={valid ? { background: value } : undefined}
          />
          <input
            type="color"
            value={valid ? value.toLowerCase() : "#000000"}
            onChange={(e) => onChange(e.target.value.toUpperCase())}
            disabled={disabled}
            className="absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
          />
        </label>
        <Input
          id={id}
          placeholder="#1F6F5C"
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value.trim() || null)}
          disabled={disabled}
          aria-invalid={!!error || undefined}
          spellCheck={false}
          className="font-mono"
          containerClassName="w-36"
          maxLength={7}
        />
      </div>
    </FormRow>
  );
}
