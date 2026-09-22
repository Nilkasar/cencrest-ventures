"use client";

import Link from "next/link";
import { Plug, PlugZap, ExternalLink } from "lucide-react";
import { Badge, Button, Card, CardContent, Skeleton } from "@bebest/ui";
import { ErrorPanel } from "@/components/patterns/error-panel";
import { useAsyncData } from "@/lib/use-async-data";
import { formatDateTime } from "@/lib/format";
import { listIntegrations } from "@/data/integrations/client";
import { SUPPORTED_PROVIDERS, type Integration, type IntegrationStatus } from "@/data/integrations/types";

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

export function IntegrationsPanel() {
  const { reload, ...state } = useAsyncData(listIntegrations, []);

  if (state.status === "loading") {
    return <Skeleton className="h-48 w-full rounded-xl" />;
  }

  if (state.status === "error") {
    return <ErrorPanel message={state.error.message} onRetry={reload} />;
  }

  const byProvider = new Map<string, Integration>(state.data.map((row) => [row.provider, row]));

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[12.5px] text-muted-foreground">
        Connect Google Search Console and Google Analytics 4 from the Connectors page to see your site&apos;s real
        performance data.
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
                    <p className="text-[11.5px] text-subtle-foreground mt-1">
                      Connected {formatDateTime(row.connectedAt)}
                    </p>
                  )}
                  {row?.disconnectedAt && !connected && (
                    <p className="text-[11.5px] text-subtle-foreground mt-1">
                      Disconnected {formatDateTime(row.disconnectedAt)}
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
      <Button variant="outline" size="sm" className="self-start" asChild>
        <Link href="/connectors">
          Manage in Connectors
          <ExternalLink size={12} className="ml-1.5" />
        </Link>
      </Button>
    </div>
  );
}
