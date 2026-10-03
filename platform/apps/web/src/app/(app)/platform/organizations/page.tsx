import type { Metadata } from "next";
import { OrgsView } from "@/components/platform/orgs-view";

export const metadata: Metadata = { title: "Organizations · Platform" };

export default function PlatformOrganizationsPage() {
  return <OrgsView />;
}
