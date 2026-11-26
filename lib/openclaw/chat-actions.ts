export const MISSION_CONTROL_ACTION_TAG = "mission-control-action";

export type MissionControlAction =
  | {
      type: "rename_agent";
      name: string;
    };

export function extractDirectAgentRenameName(value: string) {
  const message = value.trim();
  if (/[?？\r\n]/u.test(message)) return null;

  // Only a complete, standalone operator command can change agent identity.
  const patterns = [
    /^(?:please\s+)?(?:rename (?:yourself|you|this agent|agent) to|set (?:your )?(?:display )?name to|call yourself)\s+(.+?)[.!]*$/iu,
    /^(?:lütfen\s+)?(?:ad[ıi]n|[iİ]sm[ıi]n)\s+(.+?)\s+olsun[.!]*$/iu,
    /^(?:lütfen\s+)?(?:ad[ıi]n[ıi]|[iİ]sm[ıi]n[ıi])\s+(.+?)\s+(?:yap|koy|değiştir|degistir)[.!]*$/iu
  ];

  for (const pattern of patterns) {
    const name = normalizeActionName(message.match(pattern)?.[1]);
    if (name && name.length <= 48 &&
        /^[\p{L}\p{N}][\p{L}\p{M}\p{N} .’'-]*$/u.test(name) &&
        !/(?:^|\s)(?:and|then|but|ve|sonra|ama|ne|what|who|kim|neden|why)(?:\s|$)/iu.test(name)) {
      return name;
    }
  }

  return null;
}

export function extractMissionControlAction(text: unknown): {
  action: MissionControlAction | null;
  cleanText: string;
} {
  if (typeof text !== "string" || !text.trim()) {
    return {
      action: null,
      cleanText: ""
    };
  }

  const pattern = new RegExp(
    `<${MISSION_CONTROL_ACTION_TAG}>\\s*([\\s\\S]*?)\\s*<\\/${MISSION_CONTROL_ACTION_TAG}>`,
    "gi"
  );
  let action: MissionControlAction | null = null;

  const cleanText = text
    .replace(pattern, (_match, payload: string) => {
      if (!action) {
        action = parseMissionControlActionPayload(payload);
      }

      return "";
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return {
    action,
    cleanText
  };
}

function parseMissionControlActionPayload(payload: string): MissionControlAction | null {
  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>;

    if (parsed.type !== "rename_agent") {
      return null;
    }

    const normalizedName = normalizeActionName(parsed.name);

    if (!normalizedName) {
      return null;
    }

    return {
      type: "rename_agent",
      name: normalizedName
    };
  } catch {
    return null;
  }
}

function normalizeActionName(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim().replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, "").trim();
  return trimmed.length > 0 ? trimmed : null;
}
