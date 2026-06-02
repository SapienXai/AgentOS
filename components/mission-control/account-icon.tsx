"use client";

import { type ReactNode, useMemo, useState } from "react";
import * as simpleIcons from "simple-icons";
import { KeyRound } from "lucide-react";

import {
  resolveAccountFaviconSources,
  resolveAccountIconKey
} from "@/components/mission-control/account-icon.utils";
import { cn } from "@/lib/utils";

type SimpleIconData = {
  title: string;
  hex: string;
  path: string;
};

const simpleIconMap = simpleIcons as Record<string, SimpleIconData | undefined>;

export function AccountIcon({
  serviceId,
  serviceName,
  primaryDomain,
  className
}: {
  serviceId?: string | null;
  serviceName?: string | null;
  primaryDomain?: string | null;
  className?: string;
}) {
  const faviconSources = useMemo(
    () => resolveAccountFaviconSources({ serviceId, serviceName, primaryDomain }),
    [primaryDomain, serviceId, serviceName]
  );
  const faviconSourcesKey = faviconSources.join("\u0000");
  const iconKey = resolveAccountIconKey({ serviceId, primaryDomain, serviceName });
  const icon = iconKey ? simpleIconMap[iconKey] : undefined;
  const fallbackLabel = (serviceName || primaryDomain || serviceId || "Account").trim().slice(0, 1).toUpperCase();
  const fallbackIcon = icon ? (
    <svg
      viewBox="0 0 24 24"
      className="h-[58%] w-[58%] select-none"
      fill={`#${icon.hex}`}
    >
      <path d={icon.path} />
    </svg>
  ) : fallbackLabel ? (
    <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/88">
      {fallbackLabel}
    </span>
  ) : (
    <KeyRound className="h-[54%] w-[54%] text-white/88" />
  );

  return (
    <div
      className={cn(
        "flex items-center justify-center overflow-hidden rounded-full border border-white/12 bg-slate-950/72 text-white shadow-[0_8px_18px_rgba(0,0,0,0.28)] backdrop-blur-xl",
        className
      )}
      aria-hidden="true"
    >
      {faviconSources.length > 0 ? (
        <AccountFavicon key={faviconSourcesKey} sources={faviconSources} fallback={fallbackIcon} />
      ) : (
        fallbackIcon
      )}
    </div>
  );
}

export function resolveAccountAccentColor(input: {
  serviceId?: string | null;
  primaryDomain?: string | null;
  serviceName?: string | null;
}) {
  const iconKey = resolveAccountIconKey(input);
  const icon = iconKey ? simpleIconMap[iconKey] : undefined;
  return icon ? `#${icon.hex}` : "#facc15";
}

function AccountFavicon({ sources, fallback }: { sources: string[]; fallback: ReactNode }) {
  const [sourceIndex, setSourceIndex] = useState(0);
  const source = sources[sourceIndex];

  if (!source) {
    return fallback;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- Account favicons are dynamic remote URLs and should not require Next image host configuration.
    <img
      src={source}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      className="h-[70%] w-[70%] select-none rounded-[4px] object-contain"
      onError={() => setSourceIndex((current) => current + 1)}
    />
  );
}
