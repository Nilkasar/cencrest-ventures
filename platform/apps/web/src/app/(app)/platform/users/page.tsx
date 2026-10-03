import type { Metadata } from "next";
import { UsersView } from "@/components/platform/users-view";

export const metadata: Metadata = { title: "Users · Platform" };

export default function PlatformUsersPage() {
  return <UsersView />;
}
