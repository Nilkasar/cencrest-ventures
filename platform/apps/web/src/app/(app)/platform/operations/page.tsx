import type { Metadata } from "next";
import { OperationsView } from "@/components/platform/operations-view";

export const metadata: Metadata = { title: "Operations · Platform" };

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function PlatformOperationsPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  return (
    <OperationsView
      initial={{ type: one(sp.type), status: one(sp.status), orgId: one(sp.orgId), stuck: one(sp.stuck) === "true" }}
    />
  );
}
