"use client";

import Link from "next/link";
import { ArrowRight, BarChart3, Search } from "lucide-react";
import { Button, Skeleton } from "@bebest/ui";
import { ErrorPanel } from "@/components/patterns/error-panel";
import { PageStack } from "@/components/patterns/motion";
import { Section } from "@/components/patterns/section";
import { typography } from "@/components/patterns/typography";
import { IntegrationStatusBadge } from "@/components/connectors/status-badges";
import { useAsyncData } from "@/lib/use-async-data";
import { formatDate } from "@/lib/format";
import { listIntegrations } from "@/data/integrations/client";
import { SUPPORTED_PROVIDERS, type Integration, type IntegrationStatus } from "@/data/integrations/types";

/**
 * Settings > Integrations — a read-only summary of which data sources are
 * connected. Connecting, disconnecting and the data itself live on
 * Connectors; this tab only answers "what's plugged in?" and links there.
 */
export function IntegrationsPanel() {
  const { reload, ...state } = useAsyncData(listIntegrations, []);

  const manageLink = (
    <Button variant="secondary" size="sm" asChild>
      <Link href="/connectors">
        Manage in Connectors <ArrowRight size={13} aria-hidden="true" />
      </Link>
    </Button>
  );

  if (state.status === "error") {
    return <ErrorPanel title="Integrations didn't load" message={state.error.message} onRetry={reload} />;
  }

  const byProvider =
    state.status === "success" ? new Map<string, Integration>(state.data.map((row) => [row.provider, row])) : null;

  return (
    <PageStack>
      <Section title="Data sources" description="First-party data BeBest reads to replace its own estimates." actions={manageLink} flush>
        <ul className="divide-y divide-border" aria-busy={!byProvider || undefined}>
          {SUPPORTED_PROVIDERS.map((provider) => {
            const row = byProvider?.get(provider.slug);
            const status: IntegrationStatus = row?.status ?? "disconnected";
            const Icon = provider.slug === "google_search_console" ? Search : BarChart3;
            const when =
              status === "connected" && row?.connectedAt
                ? `Connected ${formatDate(row.connectedAt)}`
                : status === "disconnected" && row?.disconnectedAt
                  ? `Disconnected ${formatDate(row.disconnectedAt)}`
                  : null;
            return (
              <li key={provider.slug} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:gap-4">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <span
                    className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-muted-foreground"
                    aria-hidden="true"
                  >
                    <Icon size={15} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[13.5px] font-medium text-foreground">{provider.label}</p>
                    <p className={typography.meta}>{provider.description}</p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3 pl-12 sm:pl-0">
                  {byProvider ? (
                    <>
                      {when && <span className={typography.meta}>{when}</span>}
                      <IntegrationStatusBadge status={status} size="sm" />
                    </>
                  ) : (
                    <Skeleton className="h-5 w-24 rounded-full" />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </Section>
    </PageStack>
  );
}
