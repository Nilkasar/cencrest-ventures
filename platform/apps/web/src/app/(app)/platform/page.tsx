import type { Metadata } from "next";
import { PageHeader } from "@/components/patterns/page-header";
import { PlatformHome } from "@/components/platform/platform-home";

export const metadata: Metadata = { title: "Platform" };

export default function PlatformPage() {
  return (
    <>
      <PageHeader
        eyebrow="Platform"
        title="BeBest Platform"
        description="The staff view across every organization. Access is granted per person and every request made here is audited."
      />
      <PlatformHome />
    </>
  );
}
