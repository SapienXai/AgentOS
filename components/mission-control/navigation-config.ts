import {
  BookOpen,
  ClipboardList,
  Gauge,
  MessageCircle,
  Plug,
  Settings2,
  Users,
  type LucideIcon
} from "lucide-react";

export type NavigationSectionId = "operate" | "system";

export type NavigationItem = {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
  aliases?: readonly string[];
  mobileLabel?: string;
  section: NavigationSectionId;
  badge?: number;
};

export const navigationSections = [
  { id: "operate", label: "Workspace" },
  { id: "system", label: "Settings" }
] as const;

export const navigationItems: readonly NavigationItem[] = [
  { id: "mission-control", label: "Mission Control", mobileLabel: "Canvas", href: "/", aliases: ["/mission-control", "/dashboard"], icon: Gauge, section: "operate" },
  { id: "chat", label: "Chat", mobileLabel: "Chat", href: "/chat", icon: MessageCircle, section: "operate" },
  { id: "agents", label: "Team", mobileLabel: "Team", href: "/team", aliases: ["/agents"], icon: Users, section: "operate" },
  { id: "missions", label: "Tasks", mobileLabel: "Tasks", href: "/missions", aliases: ["/tasks", "/human-control"], icon: ClipboardList, section: "operate" },
  { id: "files", label: "Knowledge", href: "/knowledge", aliases: ["/files"], icon: BookOpen, section: "operate" },
  { id: "integrations", label: "Integrations", href: "/integrations", aliases: ["/accounts", "/channels"], icon: Plug, section: "operate" },
  { id: "settings", label: "Settings", href: "/settings", aliases: ["/models", "/operations", "/updates", "/operator-access"], icon: Settings2, section: "system" }
];

export const collapsedNavigationItems = navigationItems;

export function isNavigationItemActive(item: NavigationItem, pathname: string) {
  return [item.href, ...(item.aliases ?? [])].some(
    (route) => route === pathname || (route !== "/" && pathname.startsWith(`${route}/`))
  );
}
