import type { Metadata } from "next";
import { AuditView } from "@/components/platform/audit-view";

export const metadata: Metadata = { title: "Audit log · Platform" };

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function PlatformAuditPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  return <AuditView initial={{ orgId: one(sp.orgId), userId: one(sp.userId), source: one(sp.source), action: one(sp.action) }} />;
}
