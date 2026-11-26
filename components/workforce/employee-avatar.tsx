"use client";

import { useState, type CSSProperties } from "react";

import { resolveAgentProfileVisual } from "@/components/mission-control/agent-profile-visuals";
import type { AgentRecord } from "@/lib/agentos/contracts";
import { cn } from "@/lib/utils";

function nativePortrait(value: string | undefined | null) {
  if (!value) return null;
  if (value.startsWith("/assets/") && !value.includes("..")) return value;
  if (/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/i.test(value)) return value;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

export const EMPLOYEE_PORTRAITS = Array.from({ length: 8 }, (_, index) => `/assets/workforce/agent${index + 1}.webp`);

export function EmployeeAvatar({ agent, name, avatar, className }: {
  agent?: AgentRecord | null;
  name: string;
  avatar?: string;
  className?: string;
}) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const initials = name.trim().split(/\s+/).slice(0, 2).map((part) => [...part][0]).join("").toUpperCase();
  const emoji = agent?.workerProfile?.identity.emoji?.trim() || agent?.identity.emoji?.trim();
  const custom = nativePortrait(avatar ?? agent?.workerProfile?.identity.avatar ?? agent?.identity.avatar);
  const visual = resolveAgentProfileVisual(agent?.id ?? "", name, agent?.identity.theme);
  const portrait = visual.videoSrc.replace("/agentProfiles/", "/workforce/").replace(/\.webm$/, ".webp");
  const source = custom && failedSource !== custom ? custom : portrait;

  return (
    <span aria-hidden="true" className={cn("workforce-portrait relative isolate grid size-11 shrink-0 place-items-center overflow-hidden rounded-[28%] bg-muted text-sm font-semibold text-foreground",
      source === portrait && failedSource !== source && "workforce-portrait-bundled", className)}
      style={{ "--portrait-accent": `rgb(${visual.style["--agent-profile-accent-a"]})` } as CSSProperties}>
      <span>{initials || "•"}</span>
      {failedSource !== source && (
        // Native identity supports operator-supplied HTTPS images as well as bundled portraits.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={source} alt="" width={192} height={192} decoding="async" loading="lazy" referrerPolicy="no-referrer"
          className="absolute inset-0 size-full object-cover" onError={() => setFailedSource(source)} />
      )}
      {emoji ? <span className="absolute bottom-0 right-0 grid min-h-[32%] min-w-[32%] place-items-center rounded-tl-md bg-card px-0.5 text-[0.7em] leading-none">{emoji}</span> : null}
    </span>
  );
}
