"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, Search, BarChart3, AlertTriangle } from "lucide-react";
import { Badge, Button, Card, CardContent, Skeleton, useToast } from "@bebest/ui";
import { ErrorPanel } from "@/components/patterns/error-panel";
import { useAsyncData } from "@/lib/use-async-data";
import { formatDateTime } from "@/lib/format";
import { listIntegrations, disconnectIntegration } from "@/data/integrations/client";
import { CONNECTORS, type ConnectorProvider } from "@/data/connectors/types";
import type { Integration, IntegrationStatus } from "@/data/integrations/types";
import { getAuthorizeUrl, OAuthNotConfiguredError } from "@/data/connectors/client";
import { useSession } from "@/lib/session-context";
import { GSCStatsPanel } from "./gsc-stats-panel";
import { GA4StatsPanel } from "./ga4-stats-panel";

const STATUS_LABEL: Record<IntegrationStatus, string> = {
  connected: "Connected",
  disconnected: "Not connected",
  error: "Error",
};

const STATUS_VARIANT: Record<IntegrationStatus, "success" | "neutral" | "danger"> = {
  connected: "success",
  disconnected: "neutral",
  error: "danger",
};

const CATEGORY_LABEL: Record<"seo" | "analytics", string> = {
  seo: "SEO",
  analytics: "Analytics",
};

function ConnectorIcon({ slug }: { slug: ConnectorProvider }) {
  if (slug === "google_search_console") return <Search size={16} />;
  return <BarChart3 size={16} />;
}

function ConnectorCard({
  connector,
  integration,
  onConnect,
  onDisconnect,
  busy,
  isAdmin,
}: {
  connector: (typeof CONNECTORS)[number];
  integration: Integration | undefined;
  onConnect: (slug: ConnectorProvider) => void;
  onDisconnect: (slug: ConnectorProvider) => void;
  busy: boolean;
  isAdmin: boolean;
}) {
  const status: IntegrationStatus = integration?.status ?? "disconnected";
  const connected = status === "connected";

  return (
    <div className="flex flex-col gap-0">
      <Card>
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3 min-w-0">
              <div className="flex items-center justify-center size-10 rounded-lg border border-border bg-surface text-muted-foreground shrink-0">
                <ConnectorIcon slug={connector.slug} />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-[14px] font-semibold text-foreground">{connector.label}</p>
                  <Badge variant="neutral" size="sm">
                    {CATEGORY_LABEL[connector.category]}
                  </Badge>
                  <Badge variant={STATUS_VARIANT[status]} size="sm" dot>
                    {STATUS_LABEL[status]}
                  </Badge>
                </div>
                <p className="text-[12.5px] text-muted-foreground mt-1 leading-relaxed">{connector.description}</p>
                <div className="flex flex-wrap gap-2 mt-2">
                  {connector.scopes.map((scope) => (
                    <span
                      key={scope}
                      className="inline-flex items-center gap-1 text-[11px] text-subtle-foreground font-mono"
                    >
                      <CheckCircle2 size={10} className="text-success shrink-0" />
                      {scope}
                    </span>
                  ))}
                </div>
                {integration?.connectedAt && connected && (
                  <p className="text-[11.5px] text-subtle-foreground mt-2">
                    Connected {formatDateTime(integration.connectedAt)}
                    {integration.lastSyncedAt && (
                      <> &middot; Last synced {formatDateTime(integration.lastSyncedAt)}</>
                    )}
                  </p>
                )}
                {integration?.disconnectedAt && !connected && (
                  <p className="text-[11.5px] text-subtle-foreground mt-2">
                    Disconnected {formatDateTime(integration.disconnectedAt)}
                  </p>
                )}
              </div>
            </div>
            <div className="shrink-0">
              <Button
                variant={connected ? "outline" : "primary"}
                size="sm"
                loading={busy}
                disabled={!isAdmin || busy}
                onClick={() => (connected ? onDisconnect(connector.slug) : onConnect(connector.slug))}
              >
                {connected ? "Disconnect" : "Connect"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
      {connected && (
        <div className="mt-3">
          {connector.slug === "google_search_console" ? <GSCStatsPanel /> : <GA4StatsPanel />}
        </div>
      )}
    </div>
  );
}

export function ConnectorsView() {
  const { org } = useSession();
  const { reload, ...state } = useAsyncData(listIntegrations, []);
  const [busySlug, setBusySlug] = useState<string | null>(null);
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
      toast({ title: "Google Search Console connected!", variant: "success" });
      router.replace("/connectors");
    } else if (connected === "google_analytics_4") {
      toastShown.current = true;
      toast({ title: "Google Analytics 4 connected!", variant: "success" });
      router.replace("/connectors");
    } else if (error === "oauth_denied") {
      toastShown.current = true;
      toast({ title: "Authorization was cancelled.", variant: "warning" });
      router.replace("/connectors");
    } else if (error === "oauth_failed") {
      toastShown.current = true;
      toast({ title: "Connection failed. Please try again.", variant: "danger" });
      router.replace("/connectors");
    }
  }, [searchParams, toast, router]);

  async function handleConnect(slug: ConnectorProvider) {
    setBusySlug(slug);
    try {
      const { url } = await getAuthorizeUrl(slug);
      window.location.href = url;
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

  async function handleDisconnect(slug: ConnectorProvider) {
    setBusySlug(slug);
    try {
      await disconnectIntegration(slug);
      toast({ title: "Disconnected", variant: "success" });
      reload();
    } catch {
      toast({ title: "Couldn't disconnect", description: "Try again in a moment.", variant: "danger" });
    } finally {
      setBusySlug(null);
    }
  }

  if (state.status === "loading") {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }

  if (state.status === "error") {
    return <ErrorPanel message={state.error.message} onRetry={reload} />;
  }

  const byProvider = new Map<string, Integration>(state.data.map((row) => [row.provider, row]));

  return (
    <div className="flex flex-col gap-5">
      {!isAdmin && (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-4 py-3">
          <AlertTriangle size={14} className="text-warning shrink-0" />
          <p className="text-[12.5px] text-muted-foreground">
            You&apos;re viewing connectors as {myRole}. Only an admin or owner can connect or disconnect.
          </p>
        </div>
      )}
      {CONNECTORS.map((connector) => (
        <ConnectorCard
          key={connector.slug}
          connector={connector}
          integration={byProvider.get(connector.slug)}
          onConnect={handleConnect}
          onDisconnect={handleDisconnect}
          busy={busySlug === connector.slug}
          isAdmin={isAdmin}
        />
      ))}
    </div>
  );
}
