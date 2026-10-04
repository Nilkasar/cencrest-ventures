"use client";

import { useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Trash2 } from "lucide-react";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  useToast,
} from "@bebest/ui";
import { FormRow, FormSection } from "@/components/patterns/form-layout";
import { PageStack, Reveal } from "@/components/patterns/motion";
import { Section } from "@/components/patterns/section";
import { SectionSkeleton } from "@/components/patterns/states";
import {
  deleteOrganization,
  OrganizationSettingsError,
  renameOrganization,
  validateOrganizationName,
} from "@/data/organization/client";
import { ROLE_LABELS, type MembershipRole } from "@/data/team/types";
import { apiClient } from "@/lib/api-client";
import { clearSession, getRefreshToken } from "@/lib/auth-state";
import { useSession, type SessionMembership } from "@/lib/session-context";
import { Notice } from "./form-controls";

const KIND_LABEL = { customer: "Brand", agency: "Agency", internal: "BeBest internal" } as const;

/**
 * Settings > Organization (Epic 22 Phase 2).
 *
 * Rename: `PATCH /orgs/:slug { name }` (admin+). Client checks mirror the
 * route's zod rule; after a save the SESSION is refreshed (`/auth/me`) so
 * the workspace switcher and header pick up the new name without a reload.
 * The slug is immutable and shown read-only, with the reason.
 *
 * Delete: owner-only danger zone. `DELETE /orgs/:slug { confirmName }` —
 * the dialog requires the exact name typed (the server re-checks it). On
 * success the user is moved into another membership, or signed out if this
 * was their only workspace (every org-scoped screen needs one).
 */
export function OrganizationPanel() {
  const { org, memberships, loading, refresh, applyOrgRename } = useSession();
  const { toast } = useToast();
  const nameId = useId();

  const [seededFrom, setSeededFrom] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | undefined>();
  const [deleteOpen, setDeleteOpen] = useState(false);

  // Seed (and re-seed after a refresh brings a new name) — render-time sync,
  // never clobbering an edit in progress.
  const savedName = org?.name ?? null;
  if (savedName !== null && savedName !== seededFrom) {
    setSeededFrom(savedName);
    if (!touched || draft.trim() === savedName) {
      setDraft(savedName);
      setTouched(false);
    }
  }

  if (!org) {
    if (loading) {
      return (
        <div aria-busy="true" className="flex flex-col gap-5">
          <span className="sr-only">Loading organization…</span>
          <SectionSkeleton lines={3} titleWidth="w-40" />
          <SectionSkeleton lines={2} titleWidth="w-28" />
        </div>
      );
    }
    return (
      <Notice tone="info" title="No organization selected">
        Choose a workspace from the switcher to manage its settings.
      </Notice>
    );
  }

  const role = org.role as MembershipRole | undefined;
  const canRename = !org.viaAgency && (role === "owner" || role === "admin");
  const isOwner = !org.viaAgency && role === "owner";
  const dirty = draft.trim() !== org.name;
  const clientError = validateOrganizationName(draft);
  const shownError = touched && dirty ? (clientError ?? serverError) : undefined;

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!org || !dirty || clientError || saving) return;
    setSaving(true);
    setServerError(undefined);
    try {
      const updated = await renameOrganization(org.slug, draft);
      toast({ title: "Organization renamed", description: `It's now “${updated.name}” everywhere.`, variant: "success" });
      setTouched(false);
      applyOrgRename(org.id, updated.name);
      refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Couldn't rename the organization.";
      setServerError(message);
      toast({ title: "Couldn't rename", description: message, variant: "danger" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageStack>
      {!canRename && (
        <Reveal>
          <Notice tone="locked" title="View only">
            {org.viaAgency
              ? "You're managing this organization through your agency. Its owner controls the organization profile."
              : `You're signed in as ${ROLE_LABELS[role ?? "viewer"] ?? role}. Only an owner or admin can rename the organization.`}
          </Notice>
        </Reveal>
      )}

      <form onSubmit={handleSave} noValidate>
        <FormSection
          title="Organization profile"
          description="How this workspace is named across BeBest — in the switcher, reports and invitations."
          footer={
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setDraft(org.name);
                  setTouched(false);
                  setServerError(undefined);
                }}
                disabled={!dirty || saving}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" loading={saving} disabled={!canRename || !dirty || !!clientError || saving}>
                Save changes
              </Button>
            </>
          }
        >
          <FormRow label="Name" htmlFor={nameId} description="2–100 characters." error={shownError} required>
            <Input
              id={nameId}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setTouched(true);
                setServerError(undefined);
              }}
              onBlur={() => setTouched(true)}
              disabled={!canRename || saving}
              maxLength={120}
              autoComplete="organization"
              aria-invalid={!!shownError || undefined}
            />
          </FormRow>
          <FormRow
            label="URL slug"
            htmlFor={`${nameId}-slug`}
            description="Fixed when the organization was created. Renaming doesn't change it, so links and integrations keep working."
          >
            <Input id={`${nameId}-slug`} value={org.slug} readOnly className="font-mono text-[12.5px]" aria-readonly="true" />
          </FormRow>
          <FormRow label="Type">
            <div className="flex h-9 items-center gap-2">
              <Badge variant="outline" size="sm">
                {KIND_LABEL[org.kind]}
              </Badge>
              {role && (
                <span className="text-[12.5px] text-muted-foreground">
                  You&apos;re the {(ROLE_LABELS[role] ?? role).toLowerCase()}
                </span>
              )}
            </div>
          </FormRow>
        </FormSection>
      </form>

      {isOwner && (
        <Section
          title="Danger zone"
          description="Irreversible from here. Contact support if you need a deleted organization back."
          className="[&>div]:border-danger/30"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-[13.5px] font-medium text-foreground">Delete this organization</p>
              <p className="mt-0.5 max-w-[60ch] text-[12.5px] leading-relaxed text-muted-foreground">
                Everyone loses access to {org.name} immediately and pending invitations stop working. Members keep their other workspaces.
              </p>
            </div>
            <Button variant="danger" size="sm" className="shrink-0" onClick={() => setDeleteOpen(true)}>
              <Trash2 size={13} aria-hidden="true" /> Delete organization
            </Button>
          </div>
        </Section>
      )}

      {isOwner && (
        <DeleteOrganizationDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          orgName={org.name}
          orgSlug={org.slug}
          otherMemberships={memberships.filter((m) => m.slug !== org.slug)}
        />
      )}
    </PageStack>
  );
}

function DeleteOrganizationDialog({
  open,
  onOpenChange,
  orgName,
  orgSlug,
  otherMemberships,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgName: string;
  orgSlug: string;
  otherMemberships: SessionMembership[];
}) {
  const router = useRouter();
  const { switchOrg } = useSession();
  const { toast } = useToast();
  const inputId = useId();
  const [typed, setTyped] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const matches = typed.trim() === orgName.trim();
  const mismatch = typed.trim().length > 0 && !matches;
  const next = otherMemberships[0];

  function close(nextOpen: boolean) {
    if (pending) return;
    onOpenChange(nextOpen);
    if (!nextOpen) {
      setTyped("");
      setError(undefined);
    }
  }

  async function handleDelete(e: FormEvent) {
    e.preventDefault();
    if (!matches || pending) return;
    setPending(true);
    setError(undefined);
    try {
      await deleteOrganization(orgSlug, typed);
    } catch (err) {
      setPending(false);
      setError(
        err instanceof OrganizationSettingsError && err.code === "confirmation_mismatch"
          ? "That doesn't match the organization's current name. It may have just been renamed — check and try again."
          : err instanceof Error
            ? err.message
            : "Couldn't delete the organization.",
      );
      return;
    }

    if (next) {
      try {
        const selected = await switchOrg(next.slug);
        toast({ title: `${orgName} was deleted`, description: `You're now in ${selected.name}.`, variant: "success" });
        router.replace(selected.needsOnboarding ? "/onboarding" : "/overview");
        return;
      } catch {
        // Fall through to a clean sign-out below — never leave the user on
        // a token for an org that no longer exists.
      }
    }
    const refreshToken = getRefreshToken();
    if (refreshToken) await apiClient.post("/auth/logout", { refreshToken }).catch(() => undefined);
    clearSession();
    router.replace("/login");
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <form onSubmit={handleDelete} noValidate className="contents">
          <DialogHeader>
            <DialogTitle>Delete {orgName}?</DialogTitle>
            <DialogDescription>
              Everyone loses access immediately, pending invitations are revoked, and its data stops being shown anywhere.{" "}
              {next ? `You'll be moved to ${next.name}.` : "This is your only workspace, so you'll be signed out."}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={inputId} className="text-[13px] text-foreground">
              Type <span className="select-all rounded bg-surface px-1 py-0.5 font-mono text-[12.5px] font-medium">{orgName}</span> to confirm
            </label>
            <Input
              id={inputId}
              value={typed}
              onChange={(e) => {
                setTyped(e.target.value);
                setError(undefined);
              }}
              autoComplete="off"
              spellCheck={false}
              disabled={pending}
              aria-invalid={mismatch || !!error || undefined}
              aria-describedby={`${inputId}-hint`}
            />
            <p id={`${inputId}-hint`} role={mismatch || error ? "alert" : undefined} className={`text-[12px] ${mismatch || error ? "text-danger" : "text-muted-foreground"}`}>
              {error ? (
                <span className="inline-flex items-start gap-1.5">
                  <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
                  {error}
                </span>
              ) : mismatch ? (
                "That doesn't match the organization name yet."
              ) : (
                "Exactly as shown — this is case-sensitive."
              )}
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={() => close(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" variant="danger" size="sm" loading={pending} disabled={!matches || pending}>
              Delete organization
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
