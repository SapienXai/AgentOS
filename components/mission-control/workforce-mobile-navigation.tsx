"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Ellipsis } from "lucide-react";

import { isNavigationItemActive, navigationItems } from "@/components/mission-control/navigation-config";
import { cn } from "@/lib/utils";

const mobileItemClassName = "flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5 rounded-md px-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring motion-reduce:transition-none";

export function WorkforceMobileNavigation({ open, onOpen }: { open: boolean; onOpen: () => void }) {
  const pathname = usePathname() ?? "/";
  const active = navigationItems.find((item) => isNavigationItemActive(item, pathname));

  return (
    <nav aria-label="Primary" className="workforce-mobile-navigation pointer-events-auto fixed inset-x-0 bottom-0 z-[35] flex items-center gap-1 border-t border-border bg-card px-2 pt-1 text-card-foreground lg:hidden">
      {navigationItems.filter((item) => item.mobileLabel).map((item) => {
        const Icon = item.icon;
        const current = item === active;
        return (
          <Link key={item.id} href={item.href} aria-current={current ? "page" : undefined}
            className={cn(mobileItemClassName, current && "bg-primary/10 text-primary")}>
            <Icon aria-hidden="true" className="size-[17px]" />
            {item.mobileLabel}
          </Link>
        );
      })}
      <button type="button" className={cn(mobileItemClassName, (open || (active && !active.mobileLabel)) && "bg-primary/10 text-primary")}
        aria-expanded={open} onClick={onOpen}>
        <Ellipsis aria-hidden="true" className="size-[17px]" />
        More
      </button>
    </nav>
  );
}
