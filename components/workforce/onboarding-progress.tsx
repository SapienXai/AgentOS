import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

const stages = ["Connect your AI", "Create your workspace", "Build your team"];

export function OnboardingProgress({ current }: { current: 1 | 2 | 3 }) {
  return (
    <ol aria-label="Onboarding progress" className="mx-auto grid w-full max-w-xl grid-cols-3 gap-2 sm:gap-4">
      {stages.map((stage, index) => (
        <li key={stage} aria-current={current === index + 1 ? "step" : undefined} className={cn(
          "flex min-w-0 items-start gap-1.5 border-t-2 py-2 text-[11px] font-medium leading-4 sm:gap-2 sm:text-xs",
          current === index + 1 ? "border-primary text-foreground" : "border-border text-muted-foreground"
        )}>
          {current > index + 1 ? <Check className="mt-0.5 size-3 shrink-0 text-primary" aria-label="Complete" /> :
            <span aria-hidden="true" className="tabular-nums">{index + 1}</span>}
          {stage}
        </li>
      ))}
    </ol>
  );
}
