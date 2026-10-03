import type { Metadata } from "next";
import { UserDetailView } from "@/components/platform/user-detail-view";

export const metadata: Metadata = { title: "User · Platform" };

export default async function PlatformUserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <UserDetailView userId={id} />;
}
