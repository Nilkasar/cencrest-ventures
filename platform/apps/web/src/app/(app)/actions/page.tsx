import type { Metadata } from "next";
import { ActionsView } from "@/components/actions/actions-view";

export const metadata: Metadata = { title: "Actions" };

export default function ActionsPage() {
  return <ActionsView />;
}
