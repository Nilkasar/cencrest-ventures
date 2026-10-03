import type { Metadata } from "next";
import { SnapshotsView } from "@/components/platform/snapshots-view";

export const metadata: Metadata = { title: "Snapshots · Growth" };

export default function GrowthSnapshotsPage() {
  return <SnapshotsView />;
}
