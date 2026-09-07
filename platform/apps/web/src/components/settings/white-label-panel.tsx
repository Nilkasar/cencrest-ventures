"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Palette } from "lucide-react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Skeleton, useToast } from "@bebest/ui";
import { ErrorPanel } from "@/components/patterns/error-panel";
import { useAsyncData } from "@/lib/use-async-data";
import { WhiteLabelForbiddenError, WhiteLabelNotAvailableError, getWhiteLabel, updateWhiteLabel } from "@/data/white-label/client";
import type { WhiteLabelBranding } from "@/data/white-label/types";
import { useSession } from "@/lib/session-context";

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const valid = value === "" || HEX_COLOR.test(value);
  return (
    <div className="flex flex-col gap-1.5">
      <Input
        label={label}
        placeholder="#112233"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        error={!valid ? "Use a 6-digit hex color, e.g. #112233" : undefined}
        containerClassName="flex-1"
      />
      {valid && value !== "" && (
        <span className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <span aria-hidden className="size-3.5 rounded-full border border-border" style={{ backgroundColor: value }} />
          Preview
        </span>
      )}
    </div>
  );
}

/** Settings > White label. Wires directly into the real Epic 18 route
 *  (`GET/PATCH /orgs/me/settings/white-label`). `PATCH` is gated by the
 *  real `white_label` plan entitlement (Epic 16) — a plan without it gets
 *  a `402`, surfaced here as an upsell rather than a generic error, same
 *  register `BillingPanel` uses for `manage_billing`. */
export function WhiteLabelPanel() {
  const router = useRouter();
  const { org } = useSession();
  const { reload, ...state } = useAsyncData(getWhiteLabel, []);
  const [form, setForm] = useState<WhiteLabelBranding | null>(null);
  const [saving, setSaving] = useState(false);
  const [notAvailable, setNotAvailable] = useState<{ message: string; plan: string } | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    // Seeding the editable draft from a fresh fetch is the same legitimate
    // "sync local state to a new external value" case `use-async-data.ts`
    // itself documents an exception for — there's no render-time value this
    // could be derived from instead (the draft must then diverge from
    // `state.data` as the admin edits fields).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (state.status === "success") setForm(state.data);
  }, [state]);

  const myRole = org?.role ?? "member";
  const isAdmin = myRole === "owner" || myRole === "admin";

  function patchField<K extends keyof WhiteLabelBranding>(key: K, value: WhiteLabelBranding[K]) {
    setForm((current) => (current ? { ...current, [key]: value } : current));
  }

  async function handleSave() {
    if (!form) return;
    setSaving(true);
    setNotAvailable(null);
    try {
      const updated = await updateWhiteLabel(form);
      setForm(updated);
      toast({ title: "Branding saved", variant: "success" });
    } catch (err) {
      if (err instanceof WhiteLabelNotAvailableError) {
        setNotAvailable({ message: err.message, plan: err.plan });
      } else if (err instanceof WhiteLabelForbiddenError) {
        toast({ title: "Couldn't save", description: err.message, variant: "danger" });
      } else {
        toast({ title: "Couldn't save branding", description: "Try again in a moment.", variant: "danger" });
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleEnabled() {
    if (!form) return;
    setSaving(true);
    setNotAvailable(null);
    try {
      const updated = await updateWhiteLabel({ enabled: !form.enabled });
      setForm(updated);
      toast({ title: updated.enabled ? "White-label branding enabled" : "White-label branding disabled", variant: "success" });
    } catch (err) {
      if (err instanceof WhiteLabelNotAvailableError) {
        setNotAvailable({ message: err.message, plan: err.plan });
      } else {
        toast({ title: "Couldn't change that", description: "Try again in a moment.", variant: "danger" });
      }
    } finally {
      setSaving(false);
    }
  }

  if (state.status === "loading" || !form) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-28 w-full rounded-xl" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
    );
  }

  if (state.status === "error") {
    return <ErrorPanel message={state.error.message} onRetry={reload} />;
  }

  const colorsValid = (form.primaryColor === null || HEX_COLOR.test(form.primaryColor)) && (form.secondaryColor === null || HEX_COLOR.test(form.secondaryColor));

  return (
    <div className="flex flex-col gap-6">
      {!isAdmin && (
        <p className="text-[12.5px] text-subtle-foreground">
          You&apos;re viewing branding as {myRole}. Only an organization admin or owner can change it.
        </p>
      )}

      {notAvailable && (
        <Card className="border-warning/30 bg-warning-muted">
          <CardContent className="flex items-center justify-between gap-4 p-4">
            <div>
              <p className="text-[13px] font-medium text-foreground">Not available on the {notAvailable.plan} plan</p>
              <p className="text-[12.5px] text-muted-foreground">{notAvailable.message}</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => router.push("/settings?tab=billing")}>
              View plans
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <CardTitle>White-label branding</CardTitle>
            <Badge variant={form.enabled ? "success" : "neutral"} size="sm">
              {form.enabled ? "Enabled" : "Disabled"}
            </Badge>
          </div>
          <Button variant="outline" size="sm" onClick={handleToggleEnabled} loading={saving} disabled={!isAdmin || saving}>
            {form.enabled ? "Disable" : "Enable"}
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-[12.5px] text-muted-foreground -mt-1">
            When enabled, reports and the public snapshot page for this organization will render with the branding
            below instead of default BeBest branding, once a future epic wires a report renderer to
            `resolveWhiteLabelBranding` (not yet — see this epic&apos;s completion notes).
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="Brand name"
              value={form.brandName}
              onChange={(event) => patchField("brandName", event.target.value)}
              disabled={!isAdmin}
            />
            <Input
              label="Support email"
              type="email"
              placeholder="support@example.com"
              value={form.supportEmail ?? ""}
              onChange={(event) => patchField("supportEmail", event.target.value || null)}
              disabled={!isAdmin}
            />
            <Input
              label="Logo URL"
              placeholder="https://example.com/logo.png"
              value={form.logoUrl ?? ""}
              onChange={(event) => patchField("logoUrl", event.target.value || null)}
              disabled={!isAdmin}
              containerClassName="sm:col-span-2"
            />
            <ColorField label="Primary color" value={form.primaryColor ?? ""} onChange={(v) => patchField("primaryColor", v || null)} />
            <ColorField label="Secondary color" value={form.secondaryColor ?? ""} onChange={(v) => patchField("secondaryColor", v || null)} />
            <Input
              label="Custom domain"
              description="Display-only in this build — no real DNS/routing."
              placeholder="reports.example.com"
              value={form.customDomain ?? ""}
              onChange={(event) => patchField("customDomain", event.target.value || null)}
              disabled={!isAdmin}
            />
            <div />
            <Input
              label="Custom terms URL"
              placeholder="https://example.com/terms"
              value={form.customTermsUrl ?? ""}
              onChange={(event) => patchField("customTermsUrl", event.target.value || null)}
              disabled={!isAdmin}
            />
            <Input
              label="Custom privacy URL"
              placeholder="https://example.com/privacy"
              value={form.customPrivacyUrl ?? ""}
              onChange={(event) => patchField("customPrivacyUrl", event.target.value || null)}
              disabled={!isAdmin}
            />
          </div>
          <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
            <div>
              <p className="text-[13px] font-medium text-foreground">Hide &quot;Powered by BeBest&quot;</p>
              <p className="text-[12px] text-muted-foreground">Removes the default footer credit from client-facing output.</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => patchField("hidePoweredBy", !form.hidePoweredBy)}
              disabled={!isAdmin}
            >
              {form.hidePoweredBy ? "Shown: no" : "Shown: yes"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button variant="primary" onClick={handleSave} loading={saving} disabled={!isAdmin || saving || !colorsValid}>
          <Palette size={14} /> Save changes
        </Button>
      </div>
    </div>
  );
}
