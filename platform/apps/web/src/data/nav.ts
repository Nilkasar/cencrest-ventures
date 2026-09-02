import type { ComponentType } from "react";
import {
  LayoutGrid,
  Radar,
  Search,
  Users,
  Target,
  ListChecks,
  FileText,
  BarChart3,
  Settings,
  UserPlus,
  Building2,
  Handshake,
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
      { href: "/ai-visibility", label: "AI Visibility", icon: Radar, epic: 7 },
      { href: "/seo-intelligence", label: "SEO Intelligence", icon: Search, epic: 4 },
      { href: "/competitors", label: "Competitors", icon: Users, epic: 8 },
      { href: "/opportunities", label: "Opportunities", icon: Target, epic: 9 },
    ],
  },
  {
    label: "Execution",
    items: [
      { href: "/actions", label: "Actions", icon: ListChecks, epic: 13 },
      { href: "/content", label: "Content", icon: FileText, epic: 11 },
      { href: "/reports", label: "Reports", icon: BarChart3, epic: 15 },
    ],
  },
  {
    label: "CRM",
    items: [
      { href: "/crm/leads", label: "Leads", icon: UserPlus, epic: 1 },
      { href: "/crm/accounts", label: "Accounts", icon: Building2, epic: 1 },
      { href: "/crm/deals", label: "Deals", icon: Handshake, epic: 1 },
    ],
  },
];

export const settingsItem: NavItem = { href: "/settings", label: "Settings", icon: Settings };
