import type { ComponentType } from "react";
import {
  LayoutGrid,
  ListTree,
  Radar,
  Search,
  Globe,
  Users,
  Target,
  ListChecks,
  FileText,
  BarChart3,
  Settings,
  UserPlus,
  Building2,
  Handshake,
  Network,
  Sparkles,
  Bot,
  Cable,
  Gauge,
  Building,
  UsersRound,
  Briefcase,
  TrendingUp,
  Activity,
  ScrollText,
} from "lucide-react";
import type { OrgKind } from "@/lib/session-context";

export interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  /** Which future epic (see platform/EPICS.md) delivers real data here. */
  epic?: number;
  /** Listed so the shape of the view is visible, but not built yet —
   *  rendered as a non-interactive row, never a link to a 404. */
  comingSoon?: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const navGroups: NavGroup[] = [
  {
    label: "Workspace",
    items: [{ href: "/overview", label: "Overview", icon: LayoutGrid }],
  },
  {
    label: "Intelligence",
    items: [
      { href: "/query-universe", label: "Query Universe", icon: ListTree },
      { href: "/ai-visibility", label: "AI Visibility", icon: Radar },
      { href: "/website-intelligence", label: "Website Intelligence", icon: Globe },
      { href: "/seo-intelligence", label: "SEO Intelligence", icon: Search },
      { href: "/competitors", label: "Competitors", icon: Users },
      { href: "/opportunities", label: "Opportunities", icon: Target },
    ],
  },
  {
    label: "Data",
    items: [{ href: "/connectors", label: "Connectors", icon: Cable }],
  },
  {
    label: "Execution",
    items: [
      { href: "/recommendations", label: "Recommendations", icon: Sparkles },
      { href: "/agents", label: "Agents", icon: Bot },
      { href: "/actions", label: "Actions", icon: ListChecks },
      { href: "/content", label: "Content", icon: FileText },
      { href: "/reports", label: "Reports", icon: BarChart3 },
    ],
  },
  {
    label: "CRM",
    items: [
      { href: "/crm/leads", label: "Leads", icon: UserPlus },
      { href: "/crm/accounts", label: "Accounts", icon: Building2 },
      { href: "/crm/deals", label: "Deals", icon: Handshake },
    ],
  },
  {
    label: "Agency",
    items: [{ href: "/agency", label: "Clients", icon: Network }],
  },
];

export const settingsItem: NavItem = { href: "/settings", label: "Settings", icon: Settings };

/**
 * Organization view (Epic 22): the full nav minus the groups the active
 * org's kind doesn't entitle — CRM is BeBest's own internal sales tool
 * (`kind === 'internal'`), Agency is the client portfolio
 * (`kind === 'agency'`). The API enforces both independently.
 */
export function orgNavGroups(kind: OrgKind | null | undefined): NavGroup[] {
  return navGroups.filter((group) => {
    if (group.label === "CRM") return kind === "internal";
    if (group.label === "Agency") return kind === "agency";
    return true;
  });
}

/** Platform view (BeBest staff). Phase 0 ships the landing page only; the
 *  Phase 1 sections are listed, marked as coming. */
export const platformNavGroups: NavGroup[] = [
  {
    label: "Platform",
    items: [{ href: "/platform", label: "Overview", icon: Gauge }],
  },
  {
    label: "Phase 1",
    items: [
      { href: "/platform/organizations", label: "Organizations", icon: Building, comingSoon: "Phase 1" },
      { href: "/platform/users", label: "Users", icon: UsersRound, comingSoon: "Phase 1" },
      { href: "/platform/agencies", label: "Agencies", icon: Briefcase, comingSoon: "Phase 1" },
      { href: "/platform/growth", label: "Growth", icon: TrendingUp, comingSoon: "Phase 1" },
      { href: "/platform/operations", label: "Operations", icon: Activity, comingSoon: "Phase 1" },
      { href: "/platform/audit", label: "Audit log", icon: ScrollText, comingSoon: "Phase 1" },
    ],
  },
];
