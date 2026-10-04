import type { Metadata } from "next";
import { AgencyClientsView } from "@/components/agency/agency-clients-view";

export const metadata: Metadata = { title: "Agency" };

/** The header lives in `AgencyClientsView` — it carries the page's tab
 *  bar, which has to sit inside the client-side `<Tabs>` root (README §3.5). */
export default function AgencyPage() {
  return <AgencyClientsView />;
}
