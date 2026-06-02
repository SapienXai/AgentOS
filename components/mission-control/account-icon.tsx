"use client";

import * as simpleIcons from "simple-icons";
import { KeyRound } from "lucide-react";

import { cn } from "@/lib/utils";

type SimpleIconData = {
  title: string;
  hex: string;
  path: string;
};

const simpleIconMap = simpleIcons as Record<string, SimpleIconData | undefined>;

const accountIconKeys: Record<string, string> = {
  "product-hunt": "siProducthunt",
  "producthunt.com": "siProducthunt",
  gmail: "siGmail",
  "mail.google.com": "siGmail",
  "accounts.google.com": "siGmail",
  "x-twitter": "siX",
  "x.com": "siX",
  "twitter.com": "siX",
  github: "siGithub",
  "github.com": "siGithub",
  discord: "siDiscord",
  "discord.com": "siDiscord",
  telegram: "siTelegram",
  "web.telegram.org": "siTelegram"
};

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
  const iconKey = resolveAccountIconKey(serviceId, primaryDomain, serviceName);
  const icon = iconKey ? simpleIconMap[iconKey] : undefined;
  const fallbackLabel = (serviceName || primaryDomain || serviceId || "Account").trim().slice(0, 1).toUpperCase();

  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-full border border-white/12 bg-slate-950/72 text-white shadow-[0_8px_18px_rgba(0,0,0,0.28)] backdrop-blur-xl",
        className
      )}
      aria-hidden="true"
    >
      {icon ? (
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
      )}
    </div>
  );
}

export function resolveAccountAccentColor(input: {
  serviceId?: string | null;
  primaryDomain?: string | null;
  serviceName?: string | null;
}) {
  const iconKey = resolveAccountIconKey(input.serviceId, input.primaryDomain, input.serviceName);
  const icon = iconKey ? simpleIconMap[iconKey] : undefined;
  return icon ? `#${icon.hex}` : "#facc15";
}

function resolveAccountIconKey(
  serviceId?: string | null,
  primaryDomain?: string | null,
  serviceName?: string | null
) {
  const candidates = [
    normalizeIconLookupKey(serviceId),
    normalizeIconLookupKey(primaryDomain),
    normalizeIconLookupKey(serviceName)
  ].filter((entry): entry is string => Boolean(entry));

  for (const candidate of candidates) {
    const direct = accountIconKeys[candidate];
    if (direct) {
      return direct;
    }

    const withoutWww = candidate.replace(/^www\./, "");
    if (accountIconKeys[withoutWww]) {
      return accountIconKeys[withoutWww];
    }
  }

  return null;
}

function normalizeIconLookupKey(value?: string | null) {
  const normalized = value?.trim().toLowerCase();
  return normalized || null;
}
