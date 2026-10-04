import { Suspense } from "react";
import type { Metadata } from "next";
import { PageHeader } from "@/components/patterns/page-header";
import { ConnectorsSkeleton, ConnectorsView } from "@/components/connectors/connectors-view";

export const metadata: Metadata = { title: "Connectors" };

export default function ConnectorsPage() {
  return (
    <>
      <PageHeader
        title="Connectors"
        description="Connect your own Google accounts so search and traffic numbers come from first-party data, not estimates."
      />
      <Suspense fallback={<ConnectorsSkeleton />}>
        <ConnectorsView />
      </Suspense>
    </>
  );
}
