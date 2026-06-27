"use client";

import * as simpleIcons from "simple-icons";

import { cn } from "@/lib/utils";

type SimpleIconData = {
  title: string;
  hex: string;
  path: string;
};

type ProviderLogoConfig =
  | { kind: "asset"; src: string }
  | { kind: "simple"; icon: SimpleIconData };

const simpleIconMap = simpleIcons as Record<string, SimpleIconData | undefined>;

const providerLogoConfig: Record<string, ProviderLogoConfig> = {
  "openai-codex": {
    kind: "asset",
    src: "/assets/provider-logos/openai.svg"
  },
  openai: {
    kind: "asset",
    src: "/assets/provider-logos/openai.svg"
  },
  anthropic: {
    kind: "simple",
    icon: requireSimpleIcon("siAnthropic", "Anthropic")
  },
  google: {
    kind: "simple",
    icon: requireSimpleIcon("siGooglegemini", "Gemini")
  },
  gemini: {
    kind: "simple",
    icon: requireSimpleIcon("siGooglegemini", "Gemini")
  },
  deepseek: {
    kind: "asset",
    src: "/assets/provider-logos/deepseek.svg"
  },
  mistral: {
    kind: "simple",
    icon: requireSimpleIcon("siMistralai", "Mistral")
  },
  openrouter: {
    kind: "simple",
    icon: requireSimpleIcon("siOpenrouter", "OpenRouter")
  },
  ollama: {
    kind: "simple",
    icon: requireSimpleIcon("siOllama", "Ollama")
  },
  xai: {
    kind: "asset",
    src: "/assets/provider-logos/xai.svg"
  }
};

function requireSimpleIcon(key: string, title: string): SimpleIconData {
  const icon = simpleIconMap[key];

  if (!icon) {
    return {
      title,
      hex: "ffffff",
      path: "M0 0h24v24H0z"
    };
  }

  return icon;
}

export function ProviderLogo({
  provider,
  className
}: {
  provider: string;
  className?: string;
}) {
  const config = providerLogoConfig[provider.trim().toLowerCase()];

  if (!config) {
    return null;
  }

  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-[16px] border border-black/5 bg-white/95 text-slate-900 shadow-[0_1px_1px_rgba(0,0,0,0.04)]",
        className
      )}
      aria-hidden="true"
    >
      {config.kind === "asset" ? (
        <span
          className="h-[72%] w-[72%] select-none bg-contain bg-center bg-no-repeat"
          style={{ backgroundImage: `url(${config.src})` }}
        />
      ) : (
        <svg viewBox="0 0 24 24" className="h-[72%] w-[72%] select-none" fill={`#${config.icon.hex}`}>
          <path d={config.icon.path} />
        </svg>
      )}
    </div>
  );
}
