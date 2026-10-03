import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Bot,
  ClipboardList,
  Cpu,
  Download,
  FileText,
  Gauge,
  Inbox,
  KeyRound,
  MessageCircle,
  Plug,
  Settings2,
  ShieldAlert
} from "lucide-react";

export type NavigationSectionId = "operate" | "connect" | "system";

export type NavigationSection = {
  id: NavigationSectionId;
  label: string;
};

export type NavigationItem = {
  id: string;
  label: string;
  href: string;
  hash?: string;
  icon: LucideIcon;
  badge?: number;
  section: NavigationSectionId;
  rail: boolean;
};

export const navigationSections: readonly NavigationSection[] = [
  { id: "operate", label: "Operate" },
  { id: "connect", label: "Connect" },
  { id: "system", label: "System" }
];

export const navigationItems: readonly NavigationItem[] = [
  { id: "home", label: "Home", href: "/dashboard", icon: Inbox, section: "operate", rail: true },
  { id: "mission-control", label: "Mission Control", href: "/", icon: Gauge, section: "operate", rail: true },
  { id: "agents", label: "Agents", href: "/agents", icon: Bot, section: "operate", rail: true },
  { id: "missions", label: "Tasks", href: "/missions", icon: ClipboardList, section: "operate", rail: true },
  { id: "human-control", label: "Human Control", href: "/human-control", icon: ShieldAlert, section: "operate", rail: true },
  { id: "channels", label: "Channels", href: "/channels", icon: MessageCircle, section: "connect", rail: true },
  { id: "accounts", label: "Accounts", href: "/accounts", icon: KeyRound, section: "connect", rail: true },
  { id: "models", label: "Models", href: "/models", icon: Cpu, section: "system", rail: false },
  { id: "integrations", label: "Integrations", href: "/integrations", icon: Plug, section: "system", rail: false },
  { id: "files", label: "Files", href: "/files", icon: FileText, section: "system", rail: false },
  { id: "operations", label: "Operations", href: "/operations", icon: Activity, section: "system", rail: false },
  { id: "updates", label: "Updates", href: "/updates", icon: Download, section: "system", rail: true },
  { id: "settings", label: "Settings", href: "/settings", icon: Settings2, section: "system", rail: true }
];

export const collapsedNavigationItems = navigationItems.filter((item) => item.rail);

export function isNavigationItemActive(item: NavigationItem, pathname: string, activeHash: string) {
  if (item.id === "mission-control") {
    return (pathname === "/" || pathname === "/mission-control") && !activeHash;
  }

  if (item.id === "home") {
    return pathname === "/dashboard";
  }

  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
