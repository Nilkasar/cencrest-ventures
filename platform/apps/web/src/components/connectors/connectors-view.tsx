"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BarChart3, Check, Search } from "lucide-react";
import { Button, useToast } from "@bebest/ui";
import { ErrorPanel } from "@/components/patterns/error-panel";
import { PageStack, Reveal } from "@/components/patterns/motion";
import { PropertyList, Section } from "@/components/patterns/section";
import { SplitLayout } from "@/components/patterns/layout";
import { SectionSkeleton } from "@/components/patterns/states";
import { typography } from "@/components/patterns/typography";
import { ConfirmDialog } from "@/components/settings/confirm-dialog";
import { Notice } from "@/components/settings/form-controls";
import { useAsyncData } from "@/lib/use-async-data";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import { listIntegrations, disconnectIntegration } from "@/data/integrations/client";
import { CONNECTORS, type ConnectorInfo, type ConnectorProvider } from "@/data/connectors/types";
import type { Integration, IntegrationStatus } from "@/data/integrations/types";
import { getAuthorizeUrl, OAuthNotConfiguredError } from "@/data/connectors/client";
import { useSession } from "@/lib/session-context";
import { GSCStatsPanel } from "./gsc-stats-panel";
import { GA4StatsPanel } from "./ga4-stats-panel";
import { IntegrationStatusBadge } from "./status-badges";

const CATEGORY_LABEL: Record<ConnectorInfo["category"], string> = {
  seo: "Search",
  analytics: "Analytics",
};

function ConnectorIcon({ slug }: { slug: ConnectorProvider }) {
  return slug === "google_search_console" ? <Search size={14} /> : <BarChart3 size={14} />;
}

/** Loading shape for the whole page: the two connector cards side by side. */
export function ConnectorsSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-5">
      <span className="sr-only">Loading connectors…</span>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2" aria-hidden="true">
        <SectionSkeleton lines={5} titleWidth="w-44" />
        <SectionSkeleton lines={5} titleWidth="w-40" />
      </div>
    </div>
  );
}

/**
 * Connectors — "is my own search and traffic data flowing in, and what
 * does it say?" Two cards answer the first half at a glance (status,
 * permissions, last sync, the one action); every connected source then
 * gets its own real-data block below (period totals, daily trend, top
 * tables). Nothing renders for a source that isn't connected — its card's
 * Connect button is the empty state.
 */
export function ConnectorsView() {
  const { org } = useSession();
  const { reload, ...state } = useAsyncData(listIntegrations, []);
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [pendingDisconnect, setPendingDisconnect] = useState<ConnectorInfo | null>(null);
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const router = useRouter();
  const toastShown = useRef(false);

  const myRole = org?.role ?? "member";
  const isAdmin = myRole === "owner" || myRole === "admin";

  useEffect(() => {
    if (toastShown.current) return;
    const connected = searchParams.get("connected");
    const error = searchParams.get("error");

    if (connected === "gsc" || connected === "google_search_console") {
      toastShown.current = true;
      toast({ title: "Google Search Console connected", description: "Search data will appear below in a moment.", variant: "success" });
      router.replace("/connectors");
    } else if (connected === "google_analytics_4") {
      toastShown.current = true;
      toast({ title: "Google Analytics 4 connected", description: "Traffic data will appear below in a moment.", variant: "success" });
      router.replace("/connectors");
    } else if (error === "oauth_denied") {
      toastShown.current = true;
      toast({ title: "Authorization was cancelled", description: "Nothing was connected. You can try again anytime.", variant: "warning" });
      router.replace("/connectors");
    } else if (error === "oauth_failed") {
      toastShown.current = true;
      toast({ title: "Connection failed", description: "Google didn't complete the handshake. Please try again.", variant: "danger" });
      router.replace("/connectors");
    }
  }, [searchParams, toast, router]);

  async function handleConnect(slug: ConnectorProvider) {
    setBusySlug(slug);
    try {
      const { url } = await getAuthorizeUrl(slug);
      window.location.assign(url);
    } catch (err) {
      if (err instanceof OAuthNotConfiguredError) {
        toast({
          title: "OAuth not configured",
          description: "Contact your administrator to set up Google OAuth.",
          variant: "danger",
        });
      } else {
        toast({ title: "Couldn't start connection", description: "Try again in a moment.", variant: "danger" });
      }
      setBusySlug(null);
    }
  }

  async function handleDisconnect(connector: ConnectorInfo) {
    setBusySlug(connector.slug);
    try {
      await disconnectIntegration(connector.slug);
      toast({ title: `${connector.label} disconnected`, variant: "success" });
      reload();
    } catch {
      toast({ title: "Couldn't disconnect", description: "Try again in a moment.", variant: "danger" });
    } finally {
      setBusySlug(null);
    }
  }

  if (state.status === "loading") return <ConnectorsSkeleton />;

  if (state.status === "error") {
    return <ErrorPanel title="Connectors didn't load" message={state.error.message} onRetry={reload} />;
  }

  const byProvider = new Map<string, Integration>(state.data.map((row) => [row.provider, row]));
  const statusOf = (slug: ConnectorProvider): IntegrationStatus => byProvider.get(slug)?.status ?? "disconnected";
  const gscConnected = statusOf("google_search_console") === "connected";
  const ga4Connected = statusOf("google_analytics_4") === "connected";
  const connectedCount = CONNECTORS.filter((c) => statusOf(c.slug) === "connected").length;

  return (
    <PageStack>
      {!isAdmin && (
        <Reveal>
          <Notice tone="locked" title="View only">
            You&apos;re signed in as {myRole}. Only an organization admin or owner can connect or disconnect data sources.
          </Notice>
        </Reveal>
      )}

      {isAdmin && connectedCount === 0 && (
        <Reveal>
          <Notice tone="info" title="No data sources connected yet">
            Connect Search Console for real clicks, impressions and rankings, and Analytics 4 for sessions and channels. Until
            then SEO Intelligence uses BeBest&apos;s own estimates.
          </Notice>
        </Reveal>
      )}

      <SplitLayout className="items-stretch">
        {CONNECTORS.map((connector) => (
          <ConnectorCard
            key={connector.slug}
            connector={connector}
            integration={byProvider.get(connector.slug)}
            onConnect={() => handleConnect(connector.slug)}
            onDisconnect={() => setPendingDisconnect(connector)}
            busy={busySlug === connector.slug}
            canManage={isAdmin}
          />
        ))}
      </SplitLayout>

      {gscConnected && <GSCStatsPanel canManage={isAdmin} onReconnect={() => handleConnect("google_search_console")} />}
      {ga4Connected && <GA4StatsPanel canManage={isAdmin} onReconnect={() => handleConnect("google_analytics_4")} />}

      <ConfirmDialog
        open={pendingDisconnect !== null}
        onOpenChange={(open) => !open && setPendingDisconnect(null)}
        title={`Disconnect ${pendingDisconnect?.label ?? "this source"}?`}
        description="BeBest stops reading from this account immediately and its numbers disappear from this page and SEO Intelligence. Nothing in your Google account changes, and you can reconnect anytime."
        confirmLabel="Disconnect"
        onConfirm={() => (pendingDisconnect ? handleDisconnect(pendingDisconnect) : undefined)}
      />
    </PageStack>
  );
}

function ConnectorCard({
  connector,
  integration,
  onConnect,
  onDisconnect,
  busy,
  canManage,
}: {
  connector: ConnectorInfo;
  integration: Integration | undefined;
  onConnect: () => void;
  onDisconnect: () => void;
  busy: boolean;
  canManage: boolean;
}) {
  const status: IntegrationStatus = integration?.status ?? "disconnected";
  const connected = status === "connected";
  const errored = status === "error";

  const facts =
    connected || errored
      ? [
          { label: "Connected", value: integration?.connectedAt ? formatDateTime(integration.connectedAt) : null },
          {
            label: "Last synced",
            value: integration?.lastSyncedAt ? (
              <time dateTime={integration.lastSyncedAt} title={formatDateTime(integration.lastSyncedAt)}>
                {formatRelativeTime(integration.lastSyncedAt)}
              </time>
            ) : null,
          },
        ]
      : integration?.disconnectedAt
        ? [{ label: "Disconnected", value: formatDateTime(integration.disconnectedAt) }]
        : [];

  return (
    <Section
      title={connector.label}
      description={`${CATEGORY_LABEL[connector.category]} · Google`}
      icon={<ConnectorIcon slug={connector.slug} />}
      actions={<IntegrationStatusBadge status={status} />}
      footer={
        <>
          {(connected || errored) && (
            <Button variant="ghost" size="sm" onClick={onDisconnect} disabled={!canManage || busy}>
              Disconnect
            </Button>
          )}
          {!connected && (
            <Button variant="primary" size="sm" onClick={onConnect} loading={busy} disabled={!canManage || busy}>
              {errored ? "Reconnect" : `Connect ${connector.label.replace("Google ", "")}`}
            </Button>
          )}
        </>
      }
      className="h-full"
    >
      <div className="flex flex-col gap-4">
        <p className={typography.secondary}>{connector.description}</p>
        {errored && (
          <Notice tone="warning" title="This connection needs attention">
            Google rejected the last request. Reconnect to re-authorize access.
          </Notice>
        )}
        <div className="flex flex-col gap-2">
          <p className={typography.eyebrow}>Read-only access</p>
          <ul className="flex flex-col gap-1.5">
            {connector.scopes.map((scope) => (
              <li key={scope} className="flex items-start gap-2 text-[12.5px] text-muted-foreground">
                <Check size={13} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
                {scope}
              </li>
            ))}
          </ul>
        </div>
        {facts.length > 0 && <PropertyList items={facts} className="border-t border-border pt-4" />}
      </div>
    </Section>
  );
}
