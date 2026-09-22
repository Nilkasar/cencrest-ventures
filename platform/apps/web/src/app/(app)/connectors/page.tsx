import { Suspense } from "react";
import type { Metadata } from "next";
import { PageHeader } from "@/components/patterns/page-header";
import { ConnectorsView } from "@/components/connectors/connectors-view";
import { Skeleton } from "@bebest/ui";

export const metadata: Metadata = { title: "Connectors" };

export default function ConnectorsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Integrations"
        title="Connectors"
        description="Connect your data sources. See your site's real search performance and traffic analytics in one place."
      />
      <Suspense fallback={<div className="flex flex-col gap-4"><Skeleton className="h-40 w-full rounded-xl" /><Skeleton className="h-40 w-full rounded-xl" /></div>}>
        <ConnectorsView />
      </Suspense>
    </>
  );
}
