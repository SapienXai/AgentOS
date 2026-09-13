"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { LoaderCircle, Puzzle, Wrench } from "lucide-react";
import { toast } from "sonner";

import { AgentCapabilityEditorColumn } from "@/components/mission-control/agent-capability-editor-column";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PikoLoader } from "@/components/ui/piko-loader";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { formatAgentPresetLabel, getAgentPresetMeta } from "@/lib/openclaw/agent-presets";
import { formatAgentDisplayName } from "@/lib/openclaw/presenters";
import {
  type CapabilityCatalogResponse,
  type CapabilityKind,
  areCapabilityListsEqual,
  buildCapabilityOptions,
  filterCapabilityOptions,
  formatSkillSourceLabel,
  formatToolSourceLabel,
  normalizeCapabilityValues,
  updateSnapshotAgentCapabilities
} from "@/lib/openclaw/capability-editor";
import { OPENCLAW_BUILTIN_TOOL_CATALOG, OPENCLAW_TOOL_GROUP_CATALOG } from "@/lib/openclaw/tool-catalog";
import type { MissionControlSnapshot } from "@/lib/agentos/contracts";
import type { PluginCatalogProjection } from "@/lib/openclaw/domains/plugin-catalog";
import { cn } from "@/lib/utils";

type CapabilityThemeStyle = CSSProperties & Record<`--cap-${string}`, string>;

const capabilityThemeStyles: Record<"dark" | "light", CapabilityThemeStyle> = {
  dark: {
    "--cap-surface": "radial-gradient(circle at 8% 0%, rgba(124,58,237,0.16), transparent 30%), linear-gradient(135deg, rgba(16,20,31,0.99), rgba(8,11,19,0.99) 66%)",
    "--cap-panel": "rgba(255,255,255,0.045)",
    "--cap-panel-strong": "rgba(2,6,23,0.62)",
    "--cap-panel-hover": "rgba(255,255,255,0.085)",
    "--cap-border": "rgba(255,255,255,0.11)",
    "--cap-border-subtle": "rgba(255,255,255,0.07)",
    "--cap-text-strong": "#f8fafc",
    "--cap-text": "#dbe4f0",
    "--cap-text-muted": "#9ba9ba",
    "--cap-text-subtle": "#69788b",
    "--cap-accent": "#c4b5fd",
    "--cap-accent-soft": "rgba(139,92,246,0.17)"
  },
  light: {
    "--cap-surface": "radial-gradient(circle at 8% 0%, rgba(124,58,237,0.1), transparent 32%), linear-gradient(135deg, rgba(255,253,251,0.99), rgba(248,244,240,0.99) 66%)",
    "--cap-panel": "rgba(255,255,255,0.72)",
    "--cap-panel-strong": "rgba(255,255,255,0.92)",
    "--cap-panel-hover": "rgba(109,40,217,0.09)",
    "--cap-border": "rgba(91,70,57,0.2)",
    "--cap-border-subtle": "rgba(91,70,57,0.13)",
    "--cap-text-strong": "#241b16",
    "--cap-text": "#493a31",
    "--cap-text-muted": "#736258",
    "--cap-text-subtle": "#927f73",
    "--cap-accent": "#6d28d9",
    "--cap-accent-soft": "rgba(109,40,217,0.1)"
  }
};

type AgentCapabilityEditorDialogProps = {
  open: boolean;
  agentId: string | null;
  initialFocus?: CapabilityKind;
  snapshot: MissionControlSnapshot;
  onOpenChange: (open: boolean) => void;
  onSnapshotChange?: (updater: (snapshot: MissionControlSnapshot) => MissionControlSnapshot) => void;
  onRefresh?: () => Promise<void>;
  onSaved?: () => void;
  surfaceTheme?: "dark" | "light";
};

export function AgentCapabilityEditorDialog({
  open,
  agentId,
  initialFocus = "skills",
  snapshot,
  onOpenChange,
  onSnapshotChange,
  onRefresh,
  onSaved,
  surfaceTheme = "dark"
}: AgentCapabilityEditorDialogProps) {
  const agent = agentId ? snapshot.agents.find((entry) => entry.id === agentId) ?? null : null;
  const workspace = snapshot.workspaces.find((entry) => entry.id === agent?.workspaceId);
  const [capabilityCatalog, setCapabilityCatalog] = useState<CapabilityCatalogResponse | null>(null);
  const [capabilityCatalogError, setCapabilityCatalogError] = useState<string | null>(null);
  const [capabilityCatalogLoading, setCapabilityCatalogLoading] = useState(false);
  const [pluginDetailLoading, setPluginDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skillInput, setSkillInput] = useState("");
  const [toolInput, setToolInput] = useState("");
  const [draftSkills, setDraftSkills] = useState<string[]>([]);
  const [draftTools, setDraftTools] = useState<string[]>([]);
  const skillInputRef = useRef<HTMLInputElement | null>(null);
  const toolInputRef = useRef<HTMLInputElement | null>(null);
  const snapshotRef = useRef(snapshot);
  const editorKind = initialFocus === "tools" ? "tools" : "skills";
  const isSkillsEditor = editorKind === "skills";
  const isToolsEditor = editorKind === "tools";
  const presetMeta = agent ? getAgentPresetMeta(agent.policy.preset) : null;

  const declaredSkills = normalizeCapabilityValues(agent?.skills ?? []);
  const declaredTools = normalizeCapabilityValues((agent?.tools ?? []).filter((tool) => tool !== "fs.workspaceOnly"));
  const effectiveSkills =
    declaredSkills.length > 0 ? declaredSkills : normalizeCapabilityValues(presetMeta?.skillIds ?? []);
  const effectiveTools =
    declaredTools.length > 0 ? declaredTools : normalizeCapabilityValues(presetMeta?.tools ?? []);
  const lockedTools = agent?.tools.includes("fs.workspaceOnly") ? ["fs.workspaceOnly"] : [];
  const observedTools = normalizeCapabilityValues(agent?.observedTools ?? []);
  const workspaceSkillIds = normalizeCapabilityValues(workspace?.bootstrap.localSkillIds ?? []);
  const fallbackToolEntries = useMemo(
    () =>
      capabilityCatalog?.toolSource === "openclaw-gateway"
        ? []
        : [...OPENCLAW_BUILTIN_TOOL_CATALOG, ...OPENCLAW_TOOL_GROUP_CATALOG],
    [capabilityCatalog?.toolSource]
  );

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    if (!open || !agentId) {
      return;
    }

    const currentAgent = snapshotRef.current.agents.find((entry) => entry.id === agentId) ?? null;

    if (!currentAgent) {
      return;
    }

    const currentPresetMeta = getAgentPresetMeta(currentAgent.policy.preset);
    const nextSkills = normalizeCapabilityValues(
      currentAgent.skills.length > 0 ? currentAgent.skills : currentPresetMeta.skillIds
    );
    const nextTools = normalizeCapabilityValues(
      currentAgent.tools.filter((tool) => tool !== "fs.workspaceOnly").length > 0
        ? currentAgent.tools.filter((tool) => tool !== "fs.workspaceOnly")
        : currentPresetMeta.tools
    );

    setDraftSkills(nextSkills);
    setDraftTools(nextTools);
    setSkillInput("");
    setToolInput("");
    setError(null);
  }, [agentId, open]);

  useEffect(() => {
    if (!open || !agent) {
      return;
    }

    const controller = new AbortController();
    setCapabilityCatalogLoading(true);
    setCapabilityCatalogError(null);
    const query = new URLSearchParams({ agentId: agent.id });
    if (workspace?.id) {
      query.set("workspaceId", workspace.id);
    }

    fetch(`/api/openclaw/capabilities?${query.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = (await response.json()) as CapabilityCatalogResponse & { error?: string };

        if (!response.ok) {
          throw new Error(payload.error || "Unable to load OpenClaw capability catalog.");
        }

        setCapabilityCatalog(payload);
        setCapabilityCatalogError(null);
      })
      .catch((err) => {
        if (controller.signal.aborted) {
          return;
        }

        setCapabilityCatalog(null);
        setCapabilityCatalogError(err instanceof Error ? err.message : "Unable to load OpenClaw capability catalog.");
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setCapabilityCatalogLoading(false);
        }
      });

    return () => controller.abort();
  }, [agent, open, workspace?.id]);

  const skillOptions = useMemo(
    () =>
      buildCapabilityOptions(
        [
          ...(capabilityCatalog?.skills ?? []).map((entry) => ({
            value: entry.name,
            label: entry.name,
            description: entry.description,
            sourceLabel: formatSkillSourceLabel(entry.source),
            sourceRank: entry.source === "openclaw-bundled" ? 0 : 1,
            kind: "skill" as const
          })),
          ...workspaceSkillIds.map((skillId) => ({
            value: skillId,
            label: skillId,
            description: "Workspace-local SKILL.md scaffold.",
            sourceLabel: "Workspace",
            sourceRank: 0,
            kind: "skill" as const,
            category: "workspace" as const
          })),
          ...draftSkills
            .filter((skillId) => !(capabilityCatalog?.skills ?? []).some((entry) => entry.name === skillId))
            .map((skillId) => ({
              value: skillId,
              label: skillId,
              description: "Already configured on this agent.",
              sourceLabel: "Current agent",
              sourceRank: 2,
              kind: "skill" as const,
              category: "custom" as const
            }))
        ],
        "skill"
      ),
    [capabilityCatalog?.skills, draftSkills, workspaceSkillIds]
  );

  const toolOptions = useMemo(
    () =>
      buildCapabilityOptions(
        [
          ...fallbackToolEntries.map((entry) => ({
            value: entry.name,
            label: entry.name,
            description: entry.description,
            sourceLabel: formatToolSourceLabel(entry),
            sourceRank: entry.category === "builtin" ? 0 : entry.category === "plugin" ? 1 : 2,
            kind: "tool" as const,
            category: entry.category
          })),
          ...(capabilityCatalog?.tools ?? []).map((entry) => ({
            value: entry.name,
            label: entry.name,
            description: entry.description,
            sourceLabel: formatToolSourceLabel(entry),
            sourceRank: entry.category === "builtin" ? 0 : entry.category === "plugin" ? 1 : 2,
            kind: "tool" as const,
            category: entry.category
          })),
          ...draftTools
            .filter((toolId) => toolId !== "fs.workspaceOnly" && !(capabilityCatalog?.tools ?? []).some((entry) => entry.name === toolId))
            .map((toolId) => ({
              value: toolId,
              label: toolId,
              description: "Already configured on this agent.",
              sourceLabel: "Current agent",
              sourceRank: 3,
              kind: "tool" as const,
              category: "custom" as const
            })),
          ...observedTools
            .filter(
              (toolId) =>
                toolId !== "fs.workspaceOnly" &&
                !(capabilityCatalog?.tools ?? []).some((entry) => entry.name === toolId) &&
                !declaredTools.includes(toolId)
            )
            .map((toolId) => ({
              value: toolId,
              label: toolId,
              description: "Recovered from runtime transcripts.",
              sourceLabel: "Observed",
              sourceRank: 4,
              kind: "tool" as const,
              category: "custom" as const
            }))
        ],
        "tool"
      ),
    [capabilityCatalog?.tools, declaredTools, draftTools, fallbackToolEntries, observedTools]
  );

  const skillSuggestions = useMemo(
    () => filterCapabilityOptions(skillOptions, skillInput, draftSkills, Number.POSITIVE_INFINITY),
    [draftSkills, skillInput, skillOptions]
  );
  const toolSuggestions = useMemo(
    () => filterCapabilityOptions(toolOptions, toolInput, draftTools, Number.POSITIVE_INFINITY),
    [draftTools, toolInput, toolOptions]
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    if (initialFocus === "skills") {
      skillInputRef.current?.focus();
      return;
    }

    toolInputRef.current?.focus();
  }, [initialFocus, open]);

  if (!agent) {
    return null;
  }

  const inspectPlugin = async (pluginId: string) => {
    setPluginDetailLoading(true);
    try {
      const query = new URLSearchParams({ agentId: agent.id, pluginId });
      if (workspace?.id) {
        query.set("workspaceId", workspace.id);
      }

      const response = await fetch(`/api/openclaw/capabilities?${query.toString()}`);
      const payload = (await response.json()) as CapabilityCatalogResponse & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Unable to inspect the OpenClaw plugin.");
      }

      setCapabilityCatalog(payload);
      setCapabilityCatalogError(null);
    } catch (err) {
      setCapabilityCatalogError(err instanceof Error ? err.message : "Unable to inspect the OpenClaw plugin.");
    } finally {
      setPluginDetailLoading(false);
    }
  };

  const baselineSkills = isSkillsEditor ? effectiveSkills : declaredSkills;
  const baselineTools = isToolsEditor ? effectiveTools : declaredTools;
  const nextSkills = isSkillsEditor ? normalizeCapabilityValues(draftSkills) : declaredSkills;
  const nextTools = isToolsEditor ? normalizeCapabilityValues(draftTools) : declaredTools;
  const hasChanges =
    !areCapabilityListsEqual(nextSkills, baselineSkills) || !areCapabilityListsEqual(nextTools, baselineTools);
  const headerBadgeClassName =
    "h-5 border-white/[0.08] px-2 py-0 text-[10px] font-normal tracking-[0.06em] normal-case";

  const saveCapabilities = async () => {
    if (areCapabilityListsEqual(nextSkills, baselineSkills) && areCapabilityListsEqual(nextTools, baselineTools)) {
      onOpenChange(false);
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const body: {
        id: string;
        skills?: string[];
        tools?: string[];
      } = {
        id: agent.id
      };

      if (isSkillsEditor) {
        body.skills = nextSkills;
      } else {
        body.tools = nextTools;
      }

      const response = await fetch("/api/agents", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });
      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error || "Unable to update agent capabilities.");
      }

      onSnapshotChange?.((current) => updateSnapshotAgentCapabilities(current, agent.id, nextSkills, nextTools));
      onSaved?.();
      toast.success("Agent capabilities updated.");
      onOpenChange(false);

      const refreshPromise = onRefresh?.();
      if (refreshPromise) {
        void refreshPromise.catch(() => undefined);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to update agent capabilities.";
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PikoLoader
        open={open && saving}
        title={isSkillsEditor ? "Saving skills" : "Saving tools"}
        description={
          isSkillsEditor
            ? "Updating this agent's skill configuration."
            : "Updating this agent's tool configuration."
        }
      />
      <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "flex h-dvh max-h-dvh w-screen max-w-none flex-col overflow-hidden rounded-none border-0 bg-[image:var(--cap-surface)] p-0 text-[var(--cap-text)] shadow-[0_0_0_1px_rgba(124,58,237,0.12),0_24px_80px_rgba(0,0,0,0.42)] sm:h-auto sm:max-h-[calc(100dvh-1.5rem)] sm:w-[min(680px,calc(100vw-1.5rem))] sm:rounded-[24px] sm:border-[var(--cap-border)]"
        )}
        style={capabilityThemeStyles[surfaceTheme]}
        overlayClassName="bg-black/78 backdrop-blur-lg"
        closeClassName="right-[max(0.75rem,env(safe-area-inset-right))] top-[max(0.75rem,env(safe-area-inset-top))] z-20 h-9 w-9 text-[var(--cap-text)] hover:bg-[var(--cap-panel-hover)] hover:text-[var(--cap-text-strong)]"
      >
        <div className="flex min-h-0 flex-1 flex-col">
          <DialogHeader className="border-b border-[var(--cap-border-subtle)] px-4 pb-3 pt-[max(0.875rem,env(safe-area-inset-top))] pr-12 sm:py-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-[var(--cap-accent-soft)] text-[var(--cap-accent)] shadow-[0_0_20px_rgba(124,58,237,0.2)]">
                {isSkillsEditor ? <Puzzle className="h-4 w-4" /> : <Wrench className="h-4 w-4" />}
              </div>
              <div className="min-w-0">
                <DialogTitle className="truncate font-display text-[17px] font-semibold leading-5 text-[var(--cap-text-strong)]">
                  {`Edit ${isSkillsEditor ? "skills" : "tools"}`}
                </DialogTitle>
                <p className="mt-0.5 truncate text-xs text-[var(--cap-text-muted)]">{formatAgentDisplayName(agent)}</p>
              </div>
            </div>
            <DialogDescription className="sr-only">
              Edit the selected agent&apos;s skills or tools and save the updated capability set.
            </DialogDescription>
            <div className="flex flex-wrap gap-1 pt-0.5">
              <Badge variant="muted" className={cn(headerBadgeClassName, "border-[var(--cap-border)] bg-[var(--cap-panel)] text-[var(--cap-text-muted)]")}>
                {formatAgentPresetLabel(agent.policy.preset)}
              </Badge>
            </div>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="px-4 py-4 sm:px-5">
              <AgentCapabilityEditorColumn
                title={isSkillsEditor ? "Skills" : "Tools"}
                selectedValues={isSkillsEditor ? draftSkills : draftTools}
                selectedTone={isSkillsEditor ? "cyan" : "amber"}
                selectedEmptyLabel={isSkillsEditor ? "No explicit skills" : "No explicit tools configured"}
                lockedValues={isToolsEditor ? lockedTools : []}
                observedValues={isToolsEditor ? observedTools : []}
                inputRef={isSkillsEditor ? skillInputRef : toolInputRef}
                inputValue={isSkillsEditor ? skillInput : toolInput}
                onInputValueChange={isSkillsEditor ? setSkillInput : setToolInput}
                onRemove={(value) => {
                  if (isSkillsEditor) {
                    setDraftSkills((current) => current.filter((entry) => entry !== value));
                  } else {
                    setDraftTools((current) => current.filter((entry) => entry !== value));
                  }
                }}
                onPick={(value) => {
                  if (isSkillsEditor) {
                    setDraftSkills((current) => normalizeCapabilityValues([value, ...current]));
                    setSkillInput("");
                  } else {
                    setDraftTools((current) => normalizeCapabilityValues([value, ...current]));
                    setToolInput("");
                  }
                }}
                suggestions={isSkillsEditor ? skillSuggestions : toolSuggestions}
                emptySuggestionLabel={
                  capabilityCatalogLoading && (isSkillsEditor ? skillSuggestions.length : toolSuggestions.length) === 0
                    ? isSkillsEditor
                      ? "Loading OpenClaw skill catalog..."
                      : "Loading OpenClaw tool catalog..."
                    : isSkillsEditor
                      ? "No matching skills found."
                      : "No matching tools found."
                }
                loading={capabilityCatalogLoading}
                catalogError={capabilityCatalogError}
                helperLabel={
                  isSkillsEditor
                    ? "Workspace skills and OpenClaw skills are shown first in Available to add."
                    : `${capabilityCatalog?.toolSource === "static-fallback" ? "OpenClaw tool discovery is unavailable; showing static fallback metadata. " : ""}Built-ins, plugins, and groups are shown first in Available to add. Observed tools are read-only.`
                }
                currentHintLabel={
                  isSkillsEditor
                    ? "Click × on a current skill to remove it."
                    : "Click × on a current tool to remove it."
                }
              />

              <PluginCatalogPanel
                catalog={capabilityCatalog?.pluginCatalog ?? null}
                loading={capabilityCatalogLoading}
                detailLoading={pluginDetailLoading}
                error={capabilityCatalogError}
                onInspect={inspectPlugin}
              />
            </div>

            {error ? (
              <div className="border-t border-[var(--cap-border-subtle)] px-4 py-3">
                <p className="text-[12px] leading-5 text-rose-300 dark:text-rose-300">{error}</p>
              </div>
            ) : null}
          </div>

          <DialogFooter className="!flex-row border-t border-[var(--cap-border-subtle)] px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 sm:justify-end sm:py-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
              disabled={saving}
              className="h-10 flex-1 rounded-[8px] border-[var(--cap-border)] bg-[var(--cap-panel)] px-3 text-xs text-[var(--cap-text)] hover:bg-[var(--cap-panel-hover)] hover:text-[var(--cap-text-strong)] sm:h-8 sm:flex-none sm:px-2.5 sm:text-[10px]"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                void saveCapabilities();
              }}
              disabled={saving || !hasChanges}
              className="h-10 flex-1 rounded-[8px] border border-violet-200/35 bg-[linear-gradient(180deg,rgba(139,92,246,0.98),rgba(109,40,217,0.96))] px-3 text-xs text-white shadow-[0_6px_16px_rgba(124,58,237,0.28)] hover:bg-violet-500 sm:h-8 sm:flex-none sm:px-2.5 sm:text-[10px]"
            >
              {saving ? <LoaderCircle className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
              Save changes
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
      </Dialog>
    </>
  );
}

function PluginCatalogPanel({
  catalog,
  loading,
  detailLoading,
  error,
  onInspect
}: {
  catalog: PluginCatalogProjection | null;
  loading: boolean;
  detailLoading: boolean;
  error: string | null;
  onInspect: (pluginId: string) => void;
}) {
  if (!catalog && !loading && !error) {
    return null;
  }

  const visibleItems = catalog?.items.slice(0, 8) ?? [];

  return (
    <section
      aria-labelledby="native-plugin-catalog-heading"
      className="mt-5 space-y-3 rounded-[14px] border border-[var(--cap-border)] bg-[var(--cap-panel)] p-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id="native-plugin-catalog-heading" className="font-display text-[13px] font-semibold text-[var(--cap-text-strong)]">
            Native OpenClaw plugin catalog
          </h2>
          <p className="mt-1 text-[11px] leading-5 text-[var(--cap-text-muted)]">
            Read-only discovery from OpenClaw. Plugin installation and lifecycle changes stay with OpenClaw.
          </p>
        </div>
        {catalog ? (
          <Badge variant={getPluginCatalogStateVariant(catalog.state)} className="shrink-0">
            {getPluginCatalogStateLabel(catalog.state)}
          </Badge>
        ) : null}
      </div>

      {loading && !catalog ? (
        <p className="rounded-[10px] border border-[var(--cap-border-subtle)] bg-[var(--cap-panel-strong)] px-3 py-2 text-[11px] text-[var(--cap-text-muted)]" role="status" aria-live="polite">
          Loading the native OpenClaw plugin catalog…
        </p>
      ) : null}

      {error && !catalog ? (
        <div className="rounded-[10px] border border-rose-300/25 bg-rose-400/[0.06] px-3 py-2 text-[11px] leading-5 text-[var(--cap-text-muted)]" role="alert">
          <p className="font-medium text-[var(--cap-text-strong)]">Plugin catalog unavailable.</p>
          <p className="mt-1">{error}</p>
          <p className="mt-1">Retry the dialog to request the native OpenClaw catalog again.</p>
        </div>
      ) : null}

      {catalog ? (
        <div className="space-y-3" aria-live="polite">
          <p className="text-[11px] leading-5 text-[var(--cap-text-muted)]">
            {catalog.context
              ? "Relevance is evaluated against the selected workspace and agent context."
              : "Relevance is unknown because no valid workspace-agent context was available."}
          </p>

          {catalog.failures.length > 0 || catalog.remoteError ? (
            <div className="rounded-[10px] border border-amber-300/25 bg-amber-400/[0.06] px-3 py-2 text-[11px] leading-5 text-[var(--cap-text-muted)]" role="status">
              <p className="font-medium text-[var(--cap-text-strong)]">Some native catalog data needs attention.</p>
              {catalog.remoteError ? <p className="mt-1">OpenClaw remote catalog: {catalog.remoteError}</p> : null}
              {catalog.failures.slice(0, 3).map((failure) => (
                <p key={`${failure.operation}:${failure.state}`} className="mt-1">
                  {failure.operation}: {failure.message} {failure.recovery}
                </p>
              ))}
            </div>
          ) : null}

          {visibleItems.length > 0 ? (
            <div className="space-y-2">
              {visibleItems.map((entry) => (
                <PluginCatalogItem
                  key={entry.id}
                  entry={entry}
                  detailLoading={detailLoading}
                  onInspect={onInspect}
                />
              ))}
              {catalog.items.length > visibleItems.length || catalog.nextCursor ? (
                <p className="text-[10px] leading-4 text-[var(--cap-text-subtle)]">
                  Showing {visibleItems.length} of {catalog.items.length} native entries. More results remain behind OpenClaw&apos;s opaque pagination cursor.
                </p>
              ) : null}
            </div>
          ) : (
            <p className="rounded-[10px] border border-[var(--cap-border-subtle)] bg-[var(--cap-panel-strong)] px-3 py-2 text-[11px] text-[var(--cap-text-muted)]">
              {catalog.state === "ready" ? "OpenClaw returned no plugins for this catalog query." : "OpenClaw did not return plugin entries."}
            </p>
          )}

          {catalog.detail ? (
            <div className="rounded-[10px] border border-[var(--cap-border-subtle)] bg-[var(--cap-panel-strong)] px-3 py-2 text-[11px] leading-5 text-[var(--cap-text-muted)]">
              <p className="font-medium text-[var(--cap-text-strong)]">Inspected plugin: {catalog.detail.plugin.catalog.name}</p>
              <p className="mt-1 break-words">OpenClaw ID: {catalog.detail.plugin.id} · Origin: {catalog.detail.detail.origin}</p>
              {catalog.detail.detail.packageName ? <p className="break-words">Package: {catalog.detail.detail.packageName}</p> : null}
              {catalog.detail.detail.topics.length > 0 ? <p>Topics: {catalog.detail.detail.topics.slice(0, 6).join(" · ")}</p> : null}
              <p className="mt-1">Configuration values are not displayed here; OpenClaw remains the configuration authority.</p>
            </div>
          ) : null}

          {catalog.detailError ? (
            <p className="text-[11px] leading-5 text-[var(--cap-text-muted)]" role="status">
              Plugin detail unavailable: {catalog.detailError.message} {catalog.detailError.recovery}
            </p>
          ) : null}

          {detailLoading ? <p className="text-[11px] text-[var(--cap-text-muted)]" role="status">Inspecting the native plugin detail…</p> : null}
        </div>
      ) : null}
    </section>
  );
}

function PluginCatalogItem({
  entry,
  detailLoading,
  onInspect
}: {
  entry: PluginCatalogProjection["items"][number];
  detailLoading: boolean;
  onInspect: (pluginId: string) => void;
}) {
  const relevanceLabel = entry.relevance.state === "relevant"
    ? "Relevant to current context"
    : "Relevance unknown";
  const localStateLabel = entry.local.action === "unavailable"
    ? "Unavailable"
    : formatPluginLocalState(entry.local.state);

  return (
    <article className="rounded-[11px] border border-[var(--cap-border-subtle)] bg-[var(--cap-panel-strong)] p-3">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-words text-[12px] font-medium text-[var(--cap-text-strong)]">{entry.catalog.name}</p>
          <p className="mt-1 break-all text-[10px] text-[var(--cap-text-subtle)]">OpenClaw ID: {entry.id}</p>
          {entry.catalog.packageName ? <p className="break-all text-[10px] text-[var(--cap-text-subtle)]">Package: {entry.catalog.packageName}</p> : null}
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
          <Badge
            variant={entry.local.action === "unavailable" ? "muted" : formatPluginLocalStateVariant(entry.local.state)}
          >
            {localStateLabel}
          </Badge>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-[10px] text-[var(--cap-accent)] hover:bg-[var(--cap-accent-soft)] hover:text-[var(--cap-text-strong)]"
            onClick={() => onInspect(entry.id)}
            disabled={detailLoading}
            aria-label={`Inspect ${entry.catalog.name} in OpenClaw`}
          >
            Inspect
          </Button>
        </div>
      </div>

      {entry.catalog.summary ? <p className="mt-2 text-[11px] leading-5 text-[var(--cap-text-muted)]">{entry.catalog.summary}</p> : null}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {entry.catalog.categories.slice(0, 3).map((category) => <Badge key={category} variant="muted">{category}</Badge>)}
        {entry.catalog.official ? <Badge variant="default">OpenClaw official</Badge> : null}
      </div>
      <div className="mt-2 text-[11px] leading-5 text-[var(--cap-text-muted)]">
        <p><span className="text-[var(--cap-text-subtle)]">Relevance:</span> {relevanceLabel}</p>
        {entry.relevance.evidence.length > 0 ? (
          <details className="mt-1">
            <summary className="cursor-pointer font-medium text-[var(--cap-accent)]">Why this plugin</summary>
            <ul className="mt-1 list-disc space-y-1 pl-4">
              {entry.relevance.evidence.slice(0, 3).map((evidence) => <li key={evidence}>{evidence}</li>)}
            </ul>
          </details>
        ) : null}
      </div>
      <p className="mt-2 text-[10px] leading-4 text-[var(--cap-text-subtle)]">
        {entry.local.action === "manage"
          ? "OpenClaw reports this plugin locally; manage its lifecycle through OpenClaw."
          : entry.local.action === "install"
            ? "OpenClaw reports this plugin as installable; AgentOS does not start installation here."
            : "OpenClaw has not exposed a lifecycle action for this plugin."}
      </p>
    </article>
  );
}

function getPluginCatalogStateLabel(state: PluginCatalogProjection["state"]) {
  if (state === "ready") return "Native ready";
  if (state === "degraded") return "Degraded";
  if (state === "denied") return "Access denied";
  if (state === "unsupported") return "Unsupported";
  if (state === "failed") return "Failed";
  return "Unknown";
}

function getPluginCatalogStateVariant(state: PluginCatalogProjection["state"]): BadgeProps["variant"] {
  if (state === "ready") return "success";
  if (state === "degraded") return "warning";
  if (state === "denied" || state === "failed") return "danger";
  return "muted";
}

function formatPluginLocalState(state: PluginCatalogProjection["items"][number]["local"]["state"]) {
  if (state === "enabled") return "Installed · enabled";
  if (state === "disabled") return "Installed · disabled";
  if (state === "needs-setup") return "Needs setup";
  if (state === "error") return "Unavailable";
  return "Not installed";
}

function formatPluginLocalStateVariant(state: PluginCatalogProjection["items"][number]["local"]["state"]): BadgeProps["variant"] {
  if (state === "enabled") return "success";
  if (state === "needs-setup") return "warning";
  if (state === "error") return "danger";
  return "muted";
}
