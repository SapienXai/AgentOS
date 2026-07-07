export type AgentProfileVisualStyle = Record<string, string>;

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

export function resolveAgentProfileVisual(agentId: string, fallbackName = ""): AgentProfileVisual {
  const variant = stableAgentProfileVariant(agentId || fallbackName);
  const theme = AGENT_PROFILE_THEMES[variant];

  return {
    videoSrc: `/assets/agentProfiles/agent${variant + 1}.webm`,
    style: {
      "--agent-profile-accent-a": theme.accentA,
      "--agent-profile-accent-b": theme.accentB,
      "--agent-profile-accent-c": theme.accentC,
      "--agent-profile-orb-a-x": theme.orbAX,
      "--agent-profile-orb-a-y": theme.orbAY,
      "--agent-profile-orb-b-x": theme.orbBX,
      "--agent-profile-orb-b-y": theme.orbBY,
      "--agent-profile-motion-speed": theme.motionSpeed,
      "--agent-profile-glass-angle": theme.glassAngle,
      "--agent-profile-glass-blur": theme.glassBlur,
      "--agent-profile-glass-alpha": theme.glassAlpha,
      "--agent-profile-glass-opacity": theme.glassOpacity,
      "--agent-profile-dark-wash": theme.darkWash
    }
  };
}

function stableAgentProfileVariant(value: string) {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }

  return Math.abs(hash) % AGENT_PROFILE_THEMES.length;
}
