import type { AgentRecord } from "@/lib/agentos/contracts";
import { cn } from "@/lib/utils";

export function EmployeeAvatar({ agent, name, className }: { agent?: AgentRecord | null; name: string; className?: string }) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map((part) => [...part][0]).join("").toUpperCase();
  const emoji = agent?.identity.emoji?.trim();

  return (
    <span aria-hidden="true" className={cn(
      "grid size-11 shrink-0 place-items-center rounded-xl border border-primary/15 bg-primary/[0.08] text-sm font-semibold text-primary",
      className
    )}>{emoji || initials || "•"}</span>
  );
}
