"use client";

import { useState } from "react";
import { Bell, Loader2, Mail, MonitorSmartphone } from "lucide-react";
import { Button, EmptyState, useToast } from "@bebest/ui";
import { ErrorPanel } from "@/components/patterns/error-panel";
import { PageStack, Reveal } from "@/components/patterns/motion";
import { Section } from "@/components/patterns/section";
import { SectionSkeleton } from "@/components/patterns/states";
import {
  getNotificationPreferences,
  updateNotificationPreferences,
  type NotificationPreference,
} from "@/data/organization/client";
import { useSession } from "@/lib/session-context";
import { useAsyncData } from "@/lib/use-async-data";
import { Notice, Switch } from "./form-controls";

type Channel = "inApp" | "email";

const CHANNEL_LABEL: Record<Channel, string> = { inApp: "In-app", email: "Email" };

/**
 * Settings > Notifications — the caller's OWN preferences in the active
 * org (`GET|PUT /orgs/me/notification-preferences`). Every toggle saves on
 * its own, optimistically: the switch flips at once, the PUT carries only
 * that one channel, and a failure flips it back with a toast saying so.
 * While a toggle's request is in flight that switch is disabled, so two
 * writes for the same channel can never race. Email is disabled (and says
 * why) for org-wide types, which are never emailed (`emailApplicable`).
 */
export function NotificationsPanel() {
  const { org } = useSession();
  const { toast } = useToast();
  const { reload, ...state } = useAsyncData(getNotificationPreferences, []);
  const [seededFrom, setSeededFrom] = useState<NotificationPreference[] | null>(null);
  const [prefs, setPrefs] = useState<NotificationPreference[] | null>(null);
  const [pending, setPending] = useState<Set<string>>(() => new Set());

  if (state.status === "success" && state.data !== seededFrom) {
    setSeededFrom(state.data);
    setPrefs(state.data);
  }

  if (state.status === "error") {
    return <ErrorPanel title="Your notification settings didn't load" message={state.error.message} onRetry={reload} />;
  }

  if (!prefs) {
    return (
      <div aria-busy="true" className="flex flex-col gap-5">
        <span className="sr-only">Loading notification settings…</span>
        <SectionSkeleton lines={5} titleWidth="w-40" />
      </div>
    );
  }

  async function toggle(eventType: string, channel: Channel, value: boolean) {
    const key = `${eventType}:${channel}`;
    const label = prefs?.find((p) => p.eventType === eventType)?.label ?? "That notification";
    setPrefs((current) => current?.map((p) => (p.eventType === eventType ? { ...p, [channel]: value } : p)) ?? current);
    setPending((current) => new Set(current).add(key));
    try {
      const updated = await updateNotificationPreferences([{ eventType, [channel]: value }]);
      // Adopt the server's word for THIS channel only — another toggle may
      // still be in flight for a different one.
      const confirmed = updated.find((p) => p.eventType === eventType);
      if (confirmed) {
        setPrefs((current) => current?.map((p) => (p.eventType === eventType ? { ...p, [channel]: confirmed[channel] } : p)) ?? current);
      }
    } catch (err) {
      setPrefs((current) => current?.map((p) => (p.eventType === eventType ? { ...p, [channel]: !value } : p)) ?? current);
      toast({
        title: `Couldn't change ${label.toLowerCase()} ${CHANNEL_LABEL[channel].toLowerCase()} notifications`,
        description: err instanceof Error ? err.message : "Your previous setting is back in place. Try again in a moment.",
        variant: "danger",
      });
    } finally {
      setPending((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  }

  return (
    <PageStack>
      <Reveal>
        <Notice tone="info">
          These settings are yours alone and apply only in {org?.name ?? "this organization"}. Teammates choose their own.
        </Notice>
      </Reveal>

      {prefs.length === 0 ? (
        <Reveal>
          <EmptyState
            icon={<Bell size={20} />}
            title="Nothing to configure yet"
            description="No notification types are available for this organization. Reload to check again."
            action={
              <Button variant="secondary" size="sm" onClick={reload}>
                Reload
              </Button>
            }
          />
        </Reveal>
      ) : (
        <Section
          title="What you hear about"
          description={
            <span aria-live="polite" className="inline-flex items-center gap-1.5">
              {pending.size > 0 ? (
                <>
                  <Loader2 size={11} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> Saving…
                </>
              ) : (
                "Changes save as you make them."
              )}
            </span>
          }
          flush
        >
          <div role="table" aria-label="Notification preferences" className="flex flex-col">
            <div role="rowgroup" className="hidden sm:block">
              <div role="row" className="grid grid-cols-[minmax(0,1fr)_88px_88px] items-center gap-4 border-b border-border bg-surface/60 px-5 py-2">
                <span role="columnheader" className="text-[11.5px] font-medium uppercase tracking-[0.08em] text-subtle-foreground">
                  Event
                </span>
                <span role="columnheader" className="flex items-center justify-center gap-1.5 text-[11.5px] font-medium uppercase tracking-[0.08em] text-subtle-foreground">
                  <MonitorSmartphone size={12} aria-hidden="true" /> In-app
                </span>
                <span role="columnheader" className="flex items-center justify-center gap-1.5 text-[11.5px] font-medium uppercase tracking-[0.08em] text-subtle-foreground">
                  <Mail size={12} aria-hidden="true" /> Email
                </span>
              </div>
            </div>
            <div role="rowgroup" className="divide-y divide-border">
              {prefs.map((pref) => (
                <div
                  key={pref.eventType}
                  role="row"
                  className="grid grid-cols-1 gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_88px_88px] sm:items-center sm:gap-4"
                >
                  <div role="rowheader" className="min-w-0">
                    <p id={`np-${pref.eventType}`} className="text-[13.5px] font-medium text-foreground">
                      {pref.label}
                    </p>
                    <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">{pref.description}</p>
                  </div>
                  <div role="presentation" className="flex gap-6 sm:contents">
                    <ChannelCell
                      eventType={pref.eventType}
                      eventLabel={pref.label}
                      channel="inApp"
                      checked={pref.inApp}
                      disabled={pending.has(`${pref.eventType}:inApp`)}
                      onChange={(v) => toggle(pref.eventType, "inApp", v)}
                    />
                    <ChannelCell
                      eventType={pref.eventType}
                      eventLabel={pref.label}
                      channel="email"
                      checked={pref.emailApplicable && pref.email}
                      disabled={!pref.emailApplicable || pending.has(`${pref.eventType}:email`)}
                      unavailable={!pref.emailApplicable}
                      onChange={(v) => toggle(pref.eventType, "email", v)}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Section>
      )}
    </PageStack>
  );
}

function ChannelCell({
  eventType,
  eventLabel,
  channel,
  checked,
  disabled,
  unavailable = false,
  onChange,
}: {
  eventType: string;
  eventLabel: string;
  channel: Channel;
  checked: boolean;
  disabled: boolean;
  unavailable?: boolean;
  onChange: (value: boolean) => void;
}) {
  const noteId = `np-${eventType}-${channel}-note`;
  return (
    <div role="cell" className="flex items-center gap-2.5 sm:flex-col sm:items-center sm:gap-1">
      {/* 44px-tall hit area around the 24px switch for touch. */}
      <span className="flex min-h-[44px] items-center">
        <Switch
          checked={checked}
          onCheckedChange={onChange}
          disabled={disabled}
          aria-label={`${eventLabel}: ${CHANNEL_LABEL[channel]}`}
          aria-describedby={unavailable ? noteId : undefined}
        />
      </span>
      <span className="text-[12.5px] text-muted-foreground sm:hidden">{CHANNEL_LABEL[channel]}</span>
      {unavailable && (
        <span id={noteId} className="text-[11px] leading-tight text-subtle-foreground sm:text-center">
          Not emailed
          <span className="sr-only"> — shared with the whole organization in-app only</span>
        </span>
      )}
    </div>
  );
}
