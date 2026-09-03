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
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  /** Which future epic (see platform/EPICS.md) delivers real data here. */
  epic?: number;
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
    label: "Execution",
    items: [
      { href: "/recommendations", label: "Recommendations", icon: Sparkles },
      { href: "/agents", label: "Agents", icon: Bot },
      { href: "/actions", label: "Actions", icon: ListChecks },
      { href: "/content", label: "Content", icon: FileText },
      { href: "/reports", label: "Reports", icon: BarChart3, epic: 15 },
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
