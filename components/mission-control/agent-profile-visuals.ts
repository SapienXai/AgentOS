export type AgentProfileVisualStyle = Record<string, string>;

export type AgentVisualThemeOption = {
  value: string;
  label: string;
  accentA: string;
  accentB: string;
  accentC: string;
  glowRgb: string;
};

type AgentProfileTheme = {
  accentA: string;
  accentB: string;
  accentC: string;
  orbAX: string;
  orbAY: string;
  orbBX: string;
  orbBY: string;
  motionSpeed: string;
  glassAngle: string;
  glassBlur: string;
  glassAlpha: string;
  glassOpacity: string;
  darkWash: string;
};

export type AgentProfileVisual = {
  videoSrc: string;
  style: AgentProfileVisualStyle;
};

const AGENT_PROFILE_THEMES: AgentProfileTheme[] = [
  {
    accentA: "0, 0, 0",
    accentB: "104, 112, 124",
    accentC: "26, 28, 32",
    orbAX: "18%",
    orbAY: "22%",
    orbBX: "82%",
    orbBY: "18%",
    motionSpeed: "16s",
    glassAngle: "126deg",
    glassBlur: "6px",
    glassAlpha: "0.78",
    glassOpacity: "0.92",
    darkWash: "0.58"
  },
  {
    accentA: "255, 24, 72",
    accentB: "255, 116, 38",
    accentC: "255, 255, 255",
    orbAX: "16%",
    orbAY: "22%",
    orbBX: "74%",
    orbBY: "18%",
    motionSpeed: "18s",
    glassAngle: "92deg",
    glassBlur: "8px",
    glassAlpha: "0.62",
    glassOpacity: "0.86",
    darkWash: "0.5"
  },
  {
    accentA: "0, 238, 190",
    accentB: "0, 166, 255",
    accentC: "255, 255, 255",
    orbAX: "26%",
    orbAY: "14%",
    orbBX: "76%",
    orbBY: "28%",
    motionSpeed: "17s",
    glassAngle: "145deg",
    glassBlur: "7px",
    glassAlpha: "0.6",
    glassOpacity: "0.88",
    darkWash: "0.48"
  },
  {
    accentA: "160, 72, 255",
    accentB: "255, 150, 28",
    accentC: "255, 255, 255",
    orbAX: "24%",
    orbAY: "16%",
    orbBX: "84%",
    orbBY: "20%",
    motionSpeed: "19s",
    glassAngle: "58deg",
    glassBlur: "7px",
    glassAlpha: "0.64",
    glassOpacity: "0.88",
    darkWash: "0.5"
  },
  {
    accentA: "255, 174, 0",
    accentB: "255, 72, 20",
    accentC: "255, 255, 255",
    orbAX: "18%",
    orbAY: "26%",
    orbBX: "72%",
    orbBY: "16%",
    motionSpeed: "16.5s",
    glassAngle: "112deg",
    glassBlur: "8px",
    glassAlpha: "0.64",
    glassOpacity: "0.86",
    darkWash: "0.5"
  },
  {
    accentA: "0, 210, 118",
    accentB: "84, 96, 255",
    accentC: "255, 255, 255",
    orbAX: "22%",
    orbAY: "18%",
    orbBX: "78%",
    orbBY: "26%",
    motionSpeed: "20s",
    glassAngle: "132deg",
    glassBlur: "8px",
    glassAlpha: "0.62",
    glassOpacity: "0.88",
    darkWash: "0.48"
  },
  {
    accentA: "255, 54, 168",
    accentB: "255, 198, 226",
    accentC: "255, 255, 255",
    orbAX: "20%",
    orbAY: "18%",
    orbBX: "74%",
    orbBY: "24%",
    motionSpeed: "17.5s",
    glassAngle: "76deg",
    glassBlur: "8px",
    glassAlpha: "0.6",
    glassOpacity: "0.86",
    darkWash: "0.5"
  },
  {
    accentA: "255, 224, 64",
    accentB: "255, 128, 0",
    accentC: "255, 255, 255",
    orbAX: "18%",
    orbAY: "16%",
    orbBX: "80%",
    orbBY: "20%",
    motionSpeed: "18.5s",
    glassAngle: "102deg",
    glassBlur: "7px",
    glassAlpha: "0.64",
    glassOpacity: "0.86",
    darkWash: "0.48"
  }
];

export const AGENT_VISUAL_THEME_OPTIONS: AgentVisualThemeOption[] = [
  {
    value: "rose-red",
    label: "Rose Red",
    accentA: "255, 35, 83",
    accentB: "251, 113, 133",
    accentC: "255, 228, 232",
    glowRgb: "255, 35, 83"
  },
  {
    value: "violet",
    label: "Violet",
    accentA: "139, 92, 246",
    accentB: "196, 181, 253",
    accentC: "245, 243, 255",
    glowRgb: "139, 92, 246"
  },
  {
    value: "green-lantern",
    label: "Green Lantern",
    accentA: "34, 197, 94",
    accentB: "134, 239, 172",
    accentC: "240, 253, 244",
    glowRgb: "34, 197, 94"
  },
  {
    value: "amber-orange",
    label: "Amber Orange",
    accentA: "245, 158, 11",
    accentB: "251, 146, 60",
    accentC: "255, 251, 235",
    glowRgb: "245, 158, 11"
  },
  {
    value: "blue-eyes",
    label: "Blue Eyes",
    accentA: "14, 165, 233",
    accentB: "125, 211, 252",
    accentC: "240, 249, 255",
    glowRgb: "14, 165, 233"
  },
  {
    value: "yellow-snake",
    label: "Yellow Snake",
    accentA: "234, 179, 8",
    accentB: "253, 224, 71",
    accentC: "254, 252, 232",
    glowRgb: "234, 179, 8"
  }
];

export function resolveAgentProfileVisual(agentId: string, fallbackName = "", themeValue = ""): AgentProfileVisual {
  const variant = stableAgentProfileVariant(agentId || fallbackName);
  const fallbackTheme = AGENT_PROFILE_THEMES[variant];
  const visualTheme = resolveAgentVisualTheme(themeValue);

  return {
    videoSrc: `/assets/agentProfiles/agent${variant + 1}.webm`,
    style: {
      "--agent-profile-accent-a": visualTheme?.accentA ?? fallbackTheme.accentA,
      "--agent-profile-accent-b": visualTheme?.accentB ?? fallbackTheme.accentB,
      "--agent-profile-accent-c": visualTheme?.accentC ?? fallbackTheme.accentC,
      "--agent-profile-orb-a-x": fallbackTheme.orbAX,
      "--agent-profile-orb-a-y": fallbackTheme.orbAY,
      "--agent-profile-orb-b-x": fallbackTheme.orbBX,
      "--agent-profile-orb-b-y": fallbackTheme.orbBY,
      "--agent-profile-motion-speed": fallbackTheme.motionSpeed,
      "--agent-profile-glass-angle": fallbackTheme.glassAngle,
      "--agent-profile-glass-blur": fallbackTheme.glassBlur,
      "--agent-profile-glass-alpha": fallbackTheme.glassAlpha,
      "--agent-profile-glass-opacity": fallbackTheme.glassOpacity,
      "--agent-profile-dark-wash": fallbackTheme.darkWash,
      "--agent-theme-rgb": visualTheme?.glowRgb ?? fallbackTheme.accentA
    }
  };
}

export function resolveAgentVisualTheme(value: string | null | undefined) {
  const normalized = normalizeAgentVisualThemeValue(value);

  return AGENT_VISUAL_THEME_OPTIONS.find((theme) => theme.value === normalized) ?? null;
}

export function normalizeAgentVisualThemeValue(value: string | null | undefined) {
  const normalized = (value ?? "").trim().toLowerCase().replace(/[_\s]+/g, "-");

  if (normalized === "rose" || normalized === "red" || normalized === "rose-red") {
    return "rose-red";
  }

  if (normalized === "green" || normalized === "emerald" || normalized === "green-lantern") {
    return "green-lantern";
  }

  if (normalized === "amber" || normalized === "orange" || normalized === "amber-orange") {
    return "amber-orange";
  }

  if (normalized === "blue" || normalized === "cyan" || normalized === "sky" || normalized === "blue-eyes") {
    return "blue-eyes";
  }

  if (normalized === "yellow" || normalized === "yellow-snake") {
    return "yellow-snake";
  }

  if (normalized === "purple" || normalized === "violet") {
    return "violet";
  }

  return normalized;
}

function stableAgentProfileVariant(value: string) {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }

  return Math.abs(hash) % AGENT_PROFILE_THEMES.length;
}
