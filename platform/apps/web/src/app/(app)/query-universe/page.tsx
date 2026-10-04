import type { Metadata } from "next";
import { QueryUniverseView } from "@/components/query-universe/query-universe-view";

export const metadata: Metadata = { title: "Query Universe" };

/** The header lives in the view: its meta (set status, version) and its
 *  lifecycle actions depend on the loaded set. */
export default function QueryUniversePage() {
  return <QueryUniverseView />;
}
