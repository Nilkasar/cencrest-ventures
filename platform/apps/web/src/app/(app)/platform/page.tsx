import type { Metadata } from "next";
import { PlatformOverview } from "@/components/platform/platform-overview";

export const metadata: Metadata = { title: "Platform" };

export default function PlatformPage() {
  return <PlatformOverview />;
}
