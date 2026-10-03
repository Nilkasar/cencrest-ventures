import type { Metadata } from "next";
import { AgenciesView } from "@/components/platform/agencies-view";

export const metadata: Metadata = { title: "Agencies · Platform" };

export default function PlatformAgenciesPage() {
  return <AgenciesView />;
}
