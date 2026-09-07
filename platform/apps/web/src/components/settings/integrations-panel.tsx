"use client";

import { useState } from "react";
import { Plug, PlugZap } from "lucide-react";
import { Badge, Button, Card, CardContent, Skeleton, useToast } from "@bebest/ui";
import { ErrorPanel } from "@/components/patterns/error-panel";
import { useAsyncData } from "@/lib/use-async-data";
import { formatDateTime } from "@/lib/format";
import { connectIntegration, disconnectIntegration, listIntegrations } from "@/data/integrations/client";
import { SUPPORTED_PROVIDERS, type Integration, type IntegrationStatus } from "@/data/integrations/types";
import { useSession } from "@/lib/session-context";

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

/** Settings > Integrations. Wires directly into the real Epic 18 routes
 *  (`GET /integrations`, `POST /integrations/:provider/{connect,disconnect}`)
 *  — mock connect/disconnect, no OAuth redirect. Connecting here is what
 *  `apps/api/src/lib/seo/resolve-provider-for-org.ts` checks before
 *  preferring `MockSearchConsoleProvider` over the estimate-only
 *  `NullSEODataProvider` on the next SEO keyword-group generation. */
export function IntegrationsPanel() {
  const { org } = useSession();
  const { reload, ...state } = useAsyncData(listIntegrations, []);
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const { toast } = useToast();

  const myRole = org?.role ?? "member";
  const isAdmin = myRole === "owner" || myRole === "admin";

  async function handleConnect(slug: string) {
    setBusySlug(slug);
    try {
      await connectIntegration(slug);
      toast({ title: "Connected", description: "Rankings will now use this connection's data.", variant: "success" });
      reload();
    } catch {
      toast({ title: "Couldn't connect", description: "Try again in a moment.", variant: "danger" });
    } finally {
      setBusySlug(null);
    }
  }

  async function handleDisconnect(slug: string) {
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
    return <Skeleton className="h-48 w-full rounded-xl" />;
  }

  if (state.status === "error") {
    return <ErrorPanel message={state.error.message} onRetry={reload} />;
  }

  const byProvider = new Map<string, Integration>(state.data.map((row) => [row.provider, row]));

  return (
    <div className="flex flex-col gap-4">
      {!isAdmin && (
        <p className="text-[12.5px] text-subtle-foreground">
          You&apos;re viewing integrations as {myRole}. Only an organization admin or owner can connect or
          disconnect one.
        </p>
      )}
      <p className="text-[12.5px] text-muted-foreground">
        No real OAuth handshake happens in this build — connecting simulates a completed authorization so the data
        model and provider-selection logic can be exercised end-to-end. A real Google/Bing OAuth flow is the
        deployment-time integration point.
      </p>
      {SUPPORTED_PROVIDERS.map((provider) => {
        const row = byProvider.get(provider.slug);
        const status: IntegrationStatus = row?.status ?? "disconnected";
        const connected = status === "connected";
        return (
          <Card key={provider.slug}>
            <CardContent className="flex items-center justify-between gap-4 p-5">
              <div className="flex items-start gap-3 min-w-0">
                <div className="flex items-center justify-center size-9 rounded-lg border border-border bg-surface text-muted-foreground shrink-0">
                  {connected ? <PlugZap size={16} /> : <Plug size={16} />}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-[13.5px] font-medium text-foreground">{provider.label}</p>
                    <Badge variant={STATUS_VARIANT[status]} size="sm" dot>
                      {STATUS_LABEL[status]}
                    </Badge>
                  </div>
                  <p className="text-[12.5px] text-muted-foreground mt-0.5">{provider.description}</p>
                  {row?.connectedAt && connected && (
                    <p className="text-[11.5px] text-subtle-foreground mt-1">Connected {formatDateTime(row.connectedAt)}</p>
                  )}
                  {row?.disconnectedAt && !connected && (
                    <p className="text-[11.5px] text-subtle-foreground mt-1">Disconnected {formatDateTime(row.disconnectedAt)}</p>
                  )}
                </div>
              </div>
              <Button
                variant={connected ? "outline" : "primary"}
                size="sm"
                className="shrink-0"
                loading={busySlug === provider.slug}
                disabled={!isAdmin || busySlug !== null}
                onClick={() => (connected ? handleDisconnect(provider.slug) : handleConnect(provider.slug))}
              >
                {connected ? "Disconnect" : "Connect"}
              </Button>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
