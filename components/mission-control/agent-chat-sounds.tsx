"use client";

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Volume2, VolumeX } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  agentChatMessageStoragePrefix,
  agentChatStateEventName,
  readAgentChatMessages,
  type AgentChatMessage
} from "@/components/mission-control/agent-chat-storage";
import { cn } from "@/lib/utils";

export type AgentChatSoundCue = "open" | "send" | "incoming" | "notification" | "preview";

type AgentChatSoundSettings = {
  enabled: boolean;
  volume: number;
};

type AgentChatSoundContextValue = {
  settings: AgentChatSoundSettings;
  updateSettings: (patch: Partial<AgentChatSoundSettings>) => void;
  preview: () => void;
};

const settingsStorageKey = "agentos:chat-sounds:v1";
const settingsEventName = "agentos:chat-sound-settings-change";
const soundRequestEventName = "agentos:chat-sound-request";
const chatVisibilityEventName = "agentos:chat-visibility-change";
const defaultSettings: AgentChatSoundSettings = { enabled: true, volume: 0.32 };
let settingsSnapshot = defaultSettings;
let hasLoadedSettings = false;

const AgentChatSoundContext = createContext<AgentChatSoundContextValue>({
  settings: defaultSettings,
  updateSettings: () => undefined,
  preview: () => undefined
});

const soundProfiles: Record<AgentChatSoundCue, Array<{ frequency: number; offset: number; duration: number; level: number }>> = {
  open: [{ frequency: 720, offset: 0, duration: 0.055, level: 0.56 }],
  send: [
    { frequency: 670, offset: 0, duration: 0.075, level: 0.46 },
    { frequency: 500, offset: 0.045, duration: 0.085, level: 0.42 }
  ],
  incoming: [
    { frequency: 590, offset: 0, duration: 0.12, level: 0.58 },
    { frequency: 740, offset: 0.085, duration: 0.14, level: 0.48 }
  ],
  notification: [
    { frequency: 494, offset: 0, duration: 0.105, level: 0.42 },
    { frequency: 622, offset: 0.09, duration: 0.12, level: 0.36 },
    { frequency: 740, offset: 0.18, duration: 0.14, level: 0.3 }
  ],
  preview: [
    { frequency: 494, offset: 0, duration: 0.105, level: 0.42 },
    { frequency: 622, offset: 0.09, duration: 0.12, level: 0.36 },
    { frequency: 740, offset: 0.18, duration: 0.14, level: 0.3 }
  ]
};

function normalizeSettings(value: unknown): AgentChatSoundSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return defaultSettings;
  }

  const candidate = value as Partial<AgentChatSoundSettings>;
  return {
    enabled: typeof candidate.enabled === "boolean" ? candidate.enabled : defaultSettings.enabled,
    volume:
      typeof candidate.volume === "number" && Number.isFinite(candidate.volume)
        ? Math.min(1, Math.max(0, candidate.volume))
        : defaultSettings.volume
  };
}

function readSettings(): AgentChatSoundSettings {
  try {
    const raw = window.localStorage.getItem(settingsStorageKey);
    return raw ? normalizeSettings(JSON.parse(raw)) : defaultSettings;
  } catch {
    return defaultSettings;
  }
}

function getSettingsSnapshot() {
  if (!hasLoadedSettings && typeof window !== "undefined") {
    settingsSnapshot = readSettings();
    hasLoadedSettings = true;
  }

  return settingsSnapshot;
}

function subscribeToSettings(onChange: () => void) {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const handleSettingsChange = (event: Event) => {
    if (event.type === "storage" && (event as StorageEvent).key !== settingsStorageKey) {
      return;
    }

    const detail = (event as CustomEvent<AgentChatSoundSettings>).detail;
    settingsSnapshot = detail ? normalizeSettings(detail) : readSettings();
    hasLoadedSettings = true;
    onChange();
  };

  window.addEventListener(settingsEventName, handleSettingsChange);
  window.addEventListener("storage", handleSettingsChange);
  return () => {
    window.removeEventListener(settingsEventName, handleSettingsChange);
    window.removeEventListener("storage", handleSettingsChange);
  };
}

function updateStoredSettings(patch: Partial<AgentChatSoundSettings>) {
  const nextSettings = normalizeSettings({ ...getSettingsSnapshot(), ...patch });
  settingsSnapshot = nextSettings;
  hasLoadedSettings = true;

  try {
    window.localStorage.setItem(settingsStorageKey, JSON.stringify(nextSettings));
  } catch {
    // Keep the in-memory preference available if storage is blocked.
  }

  window.dispatchEvent(new CustomEvent(settingsEventName, { detail: nextSettings }));
}

function playTone(context: AudioContext, cue: AgentChatSoundCue, settings: AgentChatSoundSettings) {
  const now = context.currentTime + 0.012;

  for (const note of soundProfiles[cue]) {
    const oscillator = context.createOscillator();
    const filter = context.createBiquadFilter();
    const envelope = context.createGain();
    const startAt = now + note.offset;
    const peak = Math.max(0.0001, settings.volume * note.level * 0.19);
    const endAt = startAt + note.duration;

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(note.frequency, startAt);
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(1_850, startAt);
    filter.Q.setValueAtTime(0.55, startAt);
    envelope.gain.setValueAtTime(0.0001, startAt);
    envelope.gain.exponentialRampToValueAtTime(peak, startAt + 0.012);
    envelope.gain.exponentialRampToValueAtTime(0.0001, endAt);

    oscillator.connect(filter);
    filter.connect(envelope);
    envelope.connect(context.destination);
    oscillator.start(startAt);
    oscillator.stop(endAt + 0.015);
  }
}

function normalizeMessageState(messages: readonly AgentChatMessage[]) {
  return new Map(messages.map((message) => [message.id, message.status ?? "sent"]));
}

function findCompletedIncomingMessages(
  messages: readonly AgentChatMessage[],
  previous: Map<string, AgentChatMessage["status"]> | undefined
) {
  if (!previous) {
    return false;
  }

  return messages.some(
    (message) =>
      message.role === "assistant" &&
      message.status === "sent" &&
      message.text.trim().length > 0 &&
      previous.get(message.id) !== "sent"
  );
}

export function requestAgentChatSound(cue: AgentChatSoundCue) {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent(soundRequestEventName, { detail: { cue } }));
}

export function reportAgentChatVisibility(agentId: string, isVisible: boolean) {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent(chatVisibilityEventName, { detail: { agentId, isVisible } }));
}

export function AgentChatSoundProvider({ children }: { children: ReactNode }) {
  const settings = useSyncExternalStore(subscribeToSettings, getSettingsSnapshot, () => defaultSettings);
  const audioContextRef = useRef<AudioContext | null>(null);
  const seenMessageStatesRef = useRef(new Map<string, Map<string, AgentChatMessage["status"]>>());
  const visibleChatAgentIdsRef = useRef(new Set<string>());

  const playCue = useCallback((cue: AgentChatSoundCue) => {
    const currentSettings = getSettingsSnapshot();
    if (!currentSettings.enabled || currentSettings.volume <= 0 || typeof window === "undefined") {
      return;
    }

    try {
      const AudioContextConstructor = window.AudioContext;
      if (!AudioContextConstructor) {
        return;
      }

      const context = audioContextRef.current ?? new AudioContextConstructor();
      audioContextRef.current = context;
      if (context.state === "running") {
        playTone(context, cue, currentSettings);
        return;
      }

      void context.resume().then(() => playTone(context, cue, currentSettings)).catch(() => undefined);
    } catch {
      // Audio is optional; browser policy or device support must not interrupt chat.
    }
  }, []);

  useEffect(() => {
    const handleSoundRequest = (event: Event) => {
      const cue = (event as CustomEvent<{ cue?: AgentChatSoundCue }>).detail?.cue;
      if (cue && cue in soundProfiles) {
        playCue(cue);
      }
    };

    const handleChatVisibility = (event: Event) => {
      const detail = (event as CustomEvent<{ agentId?: string; isVisible?: boolean }>).detail;
      if (!detail?.agentId) {
        return;
      }

      if (detail.isVisible) {
        visibleChatAgentIdsRef.current.add(detail.agentId);
      } else {
        visibleChatAgentIdsRef.current.delete(detail.agentId);
      }
    };

    const handleAgentChatChange = (agentId: string) => {
      const messages = readAgentChatMessages(agentId);
      const previous = seenMessageStatesRef.current.get(agentId);
      const hasCompletedIncoming = findCompletedIncomingMessages(messages, previous);
      seenMessageStatesRef.current.set(agentId, normalizeMessageState(messages));

      if (hasCompletedIncoming) {
        const isChatFocused =
          visibleChatAgentIdsRef.current.has(agentId) &&
          document.visibilityState === "visible" &&
          document.hasFocus();
        playCue(isChatFocused ? "incoming" : "notification");
      }
    };

    const handleAgentChatStateChange = (event: Event) => {
      const agentId = (event as CustomEvent<{ agentId?: string }>).detail?.agentId;
      if (agentId) {
        handleAgentChatChange(agentId);
      }
    };

    const handleStorage = (event: StorageEvent) => {
      const messageKeyPrefix = `${agentChatMessageStoragePrefix}:`;
      if (event.key?.startsWith(messageKeyPrefix)) {
        handleAgentChatChange(event.key.slice(messageKeyPrefix.length));
      }
    };

    window.addEventListener(soundRequestEventName, handleSoundRequest);
    window.addEventListener(chatVisibilityEventName, handleChatVisibility);
    window.addEventListener(agentChatStateEventName, handleAgentChatStateChange);
    window.addEventListener("storage", handleStorage);

    return () => {
      window.removeEventListener(soundRequestEventName, handleSoundRequest);
      window.removeEventListener(chatVisibilityEventName, handleChatVisibility);
      window.removeEventListener(agentChatStateEventName, handleAgentChatStateChange);
      window.removeEventListener("storage", handleStorage);
      void audioContextRef.current?.close().catch(() => undefined);
      audioContextRef.current = null;
    };
  }, [playCue]);

  const preview = useCallback(() => playCue("preview"), [playCue]);

  return (
    <AgentChatSoundContext.Provider value={{ settings, updateSettings: updateStoredSettings, preview }}>
      {children}
    </AgentChatSoundContext.Provider>
  );
}

export function AgentChatSoundSettings() {
  const { settings, updateSettings, preview } = useContext(AgentChatSoundContext);
  const [isOpen, setIsOpen] = useState(false);
  const [panelPosition, setPanelPosition] = useState({ left: 16, bottom: 96 });
  const settingsId = useId();
  const detailsRef = useRef<HTMLDetailsElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const summaryRef = useRef<HTMLElement | null>(null);

  const updatePanelPosition = useCallback(() => {
    const rect = summaryRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }

    const panelWidth = Math.min(288, window.innerWidth - 32);
    const panelHeight = Math.min(252, window.innerHeight - 32);
    const left = Math.max(16, Math.min(rect.left, window.innerWidth - panelWidth - 16));
    const maxBottom = window.innerHeight - panelHeight - 16;
    const bottom = Math.max(16, Math.min(window.innerHeight - rect.top + 8, maxBottom));
    setPanelPosition({ left, bottom });
  }, []);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const closeOnOutsidePointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !detailsRef.current?.contains(event.target) &&
        !panelRef.current?.contains(event.target)
      ) {
        setIsOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
        detailsRef.current?.querySelector("summary")?.focus();
      }
    };

    document.addEventListener("pointerdown", closeOnOutsidePointerDown);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", updatePanelPosition);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointerDown);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", updatePanelPosition);
    };
  }, [isOpen, updatePanelPosition]);

  return (
    <details
      ref={detailsRef}
      open={isOpen}
      onToggle={(event) => setIsOpen(event.currentTarget.open)}
      className="relative"
    >
      <summary
        ref={summaryRef}
        aria-label={settings.enabled ? "Chat sounds on. Open sound settings." : "Chat sounds off. Open sound settings."}
        title="Chat sound settings"
        onClick={updatePanelPosition}
        className={cn(
          "flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          "[&::-webkit-details-marker]:hidden"
        )}
      >
        {settings.enabled ? <Volume2 className="h-4 w-4" aria-hidden="true" /> : <VolumeX className="h-4 w-4" aria-hidden="true" />}
        <span className="sr-only">Chat sound settings</span>
      </summary>
      {isOpen ? createPortal(
        <div
          ref={panelRef}
          role="group"
          aria-label="Chat sound settings"
          style={{ left: `${panelPosition.left}px`, bottom: `${panelPosition.bottom}px` }}
          className="fixed z-[100] max-h-[calc(100dvh-2rem)] w-[min(18rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-xl"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold">Chat sounds</p>
              <p className="mt-0.5 text-xs leading-5 text-muted-foreground">Quiet cues for sending and replies.</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-label="Enable chat sounds"
              aria-checked={settings.enabled}
              onClick={() => updateSettings({ enabled: !settings.enabled })}
              className={cn(
                "relative h-6 w-10 shrink-0 rounded-full border border-border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                settings.enabled ? "bg-violet-600" : "bg-muted"
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform",
                  settings.enabled && "translate-x-4"
                )}
              />
            </button>
          </div>

          <label htmlFor={`${settingsId}-volume`} className="mt-4 flex items-center justify-between text-xs font-medium">
            <span>Volume</span>
            <span className="tabular-nums text-muted-foreground">{Math.round(settings.volume * 100)}%</span>
          </label>
          <input
            id={`${settingsId}-volume`}
            type="range"
            min="0"
            max="100"
            step="1"
            value={Math.round(settings.volume * 100)}
            disabled={!settings.enabled}
            onChange={(event) => updateSettings({ volume: Number(event.target.value) / 100 })}
            className="mt-2 h-5 w-full cursor-pointer accent-violet-600 disabled:cursor-not-allowed disabled:opacity-50"
          />

          <div className="mt-3 flex items-center justify-between gap-3 border-t border-border/70 pt-3">
            <p className="text-[11px] leading-4 text-muted-foreground">Background replies use a softer alert tone.</p>
            <Button type="button" variant="secondary" size="sm" disabled={!settings.enabled || settings.volume === 0} onClick={preview} className="shrink-0">
              Preview
            </Button>
          </div>
        </div>,
        document.body
      ) : null}
    </details>
  );
}
