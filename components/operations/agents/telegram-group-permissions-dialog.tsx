"use client";

import { useEffect, useState } from "react";
import { ChevronDown, LoaderCircle, Plus, Save, ShieldCheck, Trash2, Users, Wrench } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";

type KnownGroup = {
  accountId: string;
  chatId: string;
  title: string;
};

type ToolCatalog = {
  source: "openclaw-gateway" | "unavailable";
  groups: Array<{
    id: string;
    label: string;
    tools: Array<{ id: string; label: string; description: string; risk?: "low" | "medium" | "high" }>;
  }>;
  error: string | null;
};

type PermissionPayload = {
  access: { mode: "anyone" | "selected" | "nobody"; senderIds: string[] };
  response: { requireMention: boolean };
  capabilities: { preset: "agent-defaults" | "chat-only" | "research" | "selected-tools" | "custom"; selectedToolIds: string[] };
  memberOverrides: Array<{ key: string; policy: { allow?: string[]; alsoAllow?: string[]; deny?: string[] }; preset: "agent-defaults" | "chat-only" | "research" | "selected-tools" | "custom" }>;
  skills: { selected: string[] };
  instructions: { text: string };
  topics: Array<{ id: string; requireMention: boolean | null; skills: string[]; hasInstructions: boolean; groupPolicy: string | null }>;
  toolCatalog: ToolCatalog;
  skillsCatalog: { source: "openclaw-gateway" | "unavailable"; skills: Array<{ name: string; description?: string; emoji?: string }>; error: string | null };
  agent: { label: string };
  warnings: string[];
};

type AccessMode = PermissionPayload["access"]["mode"];
type CapabilityPreset = Exclude<PermissionPayload["capabilities"]["preset"], "custom">;
type OverrideDraft = { key: string; preset: CapabilityPreset };

export function TelegramGroupPermissionsDialog({
  open,
  onOpenChange,
  group,
  agentId,
  agentLabel,
  surfaceTheme = "dark",
  onSaved
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group: KnownGroup | null;
  agentId: string;
  agentLabel: string;
  surfaceTheme?: "dark" | "light";
  onSaved?: () => Promise<void> | void;
}) {
  const isLight = surfaceTheme === "light";
  const [payload, setPayload] = useState<PermissionPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accessMode, setAccessMode] = useState<AccessMode>("nobody");
  const [senderIds, setSenderIds] = useState<string[]>([]);
  const [senderInput, setSenderInput] = useState("");
  const [requireMention, setRequireMention] = useState(true);
  const [preset, setPreset] = useState<CapabilityPreset>("agent-defaults");
  const [selectedTools, setSelectedTools] = useState<string[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [instructions, setInstructions] = useState("");
  const [overrides, setOverrides] = useState<OverrideDraft[]>([]);
  const [overrideInput, setOverrideInput] = useState("");
  const [overridePreset, setOverridePreset] = useState<CapabilityPreset>("chat-only");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [skillsDirty, setSkillsDirty] = useState(false);
  const [instructionsDirty, setInstructionsDirty] = useState(false);
  const [overridesDirty, setOverridesDirty] = useState(false);

  useEffect(() => {
    if (!open || !group) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void fetch(`/api/openclaw/channels/telegram-group-permissions?${new URLSearchParams({
      accountId: group.accountId,
      groupId: group.chatId,
      agentId
    }).toString()}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const nextPayload = await response.json() as PermissionPayload & { error?: string };
        if (!response.ok || nextPayload.error) throw new Error(nextPayload.error ?? "Telegram group permissions are unavailable.");
        setPayload(nextPayload);
        setAccessMode(nextPayload.access.mode);
        setSenderIds(nextPayload.access.senderIds);
        setRequireMention(nextPayload.response.requireMention);
        setPreset(nextPayload.capabilities.preset === "custom" ? "selected-tools" : nextPayload.capabilities.preset);
        setSelectedTools(nextPayload.capabilities.selectedToolIds);
        setSelectedSkills(nextPayload.skills.selected);
        setInstructions(nextPayload.instructions.text);
        setOverrides(nextPayload.memberOverrides.map((override) => ({ key: override.key, preset: override.preset === "custom" ? "chat-only" : override.preset })));
        setSkillsDirty(false);
        setInstructionsDirty(false);
        setOverridesDirty(false);
      })
      .catch((nextError) => {
        if (!isAbortError(nextError)) setError(nextError instanceof Error ? nextError.message : "Telegram group permissions are unavailable.");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [agentId, group, open]);

  const canChooseTools = payload?.toolCatalog.source === "openclaw-gateway";
  const canChooseSkills = payload?.skillsCatalog.source === "openclaw-gateway";

  const addSender = () => {
    const nextId = senderInput.trim();
    if (!/^\d+$/.test(nextId) || senderIds.includes(nextId)) return;
    setSenderIds((current) => [...current, nextId]);
    setSenderInput("");
  };

  const toggleTool = (toolId: string) => {
    setSelectedTools((current) => current.includes(toolId) ? current.filter((id) => id !== toolId) : [...current, toolId]);
    setPreset("selected-tools");
  };

  const toggleSkill = (skillName: string) => {
    setSkillsDirty(true);
    setSelectedSkills((current) => current.includes(skillName) ? current.filter((name) => name !== skillName) : [...current, skillName]);
  };

  const addOverride = () => {
    const senderId = overrideInput.trim();
    if (!/^\d+$/.test(senderId)) return;
    const key = `id:${senderId}`;
    setOverrides((current) => [...current.filter((override) => override.key !== key), { key, preset: overridePreset }]);
    setOverridesDirty(true);
    setOverrideInput("");
  };

  const save = async () => {
    if (!group || !payload) return;
    if (accessMode === "selected" && senderIds.length === 0) {
      setError("Add at least one numeric Telegram sender ID for Selected people.");
      return;
    }
    if (preset === "selected-tools" && selectedTools.length === 0) {
      setError("Select at least one OpenClaw tool for Selected tools.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const patch: Record<string, unknown> = {
        access: { mode: accessMode, ...(accessMode === "selected" ? { senderIds } : {}) },
        requireMention,
        capabilities: { preset, ...(preset === "selected-tools" ? { toolIds: selectedTools } : {}) }
      };
      if (skillsDirty) patch.skills = selectedSkills;
      if (instructionsDirty) patch.systemPrompt = instructions;
      if (overridesDirty) {
        patch.memberOverrides = Object.fromEntries(overrides.map((override) => [override.key, buildOverridePolicy(override.preset, payload.toolCatalog)]));
      }
      const response = await fetch("/api/openclaw/channels/telegram-group-permissions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: group.accountId, groupId: group.chatId, agentId, patch })
      });
      const result = await response.json() as { error?: string };
      if (!response.ok || result.error) throw new Error(result.error ?? "OpenClaw could not update the Telegram group.");
      toast.success("Telegram group permissions saved.", { description: `${group.title} now uses the confirmed OpenClaw policy.` });
      await onSaved?.();
      onOpenChange(false);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "OpenClaw could not update the Telegram group.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn("max-h-[min(880px,calc(100dvh-1rem))] w-[calc(100vw-1rem)] max-w-2xl overflow-hidden p-0", isLight ? "bg-background" : "bg-popover")} closeLabel="Close Telegram group permissions">
        <DialogHeader className="border-b border-border px-5 py-4 pr-14">
          <DialogTitle className="truncate text-lg">{group?.title ?? "Telegram group"}</DialogTitle>
          <DialogDescription className="text-xs">Control this group through OpenClaw native policy. Changes stay scoped to {group?.chatId ?? "the selected group"}.</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 space-y-5 overflow-y-auto px-5 py-4">
          {loading ? <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/20 px-3 py-3 text-xs text-muted-foreground" role="status"><LoaderCircle className="h-4 w-4 animate-spin" />Reading OpenClaw permissions…</div> : null}
          {error ? <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2.5 text-xs leading-5 text-amber-900 dark:text-amber-100" role="alert">{error}</div> : null}
          {payload ? <>
            <section aria-labelledby="telegram-access-heading" className="space-y-3">
              <div className="flex items-center gap-2"><Users className="h-4 w-4 text-primary" /><div><h3 id="telegram-access-heading" className="text-sm font-semibold">Who can trigger this agent?</h3><p className="text-[11px] text-muted-foreground">Telegram group access uses OpenClaw groupPolicy and sender allowFrom.</p></div></div>
              <div className="grid gap-2 sm:grid-cols-3">
                {([
                  ["anyone", "Anyone in this group", "OpenClaw accepts any sender."],
                  ["selected", "Selected people", "Only numeric Telegram sender IDs."],
                  ["nobody", "Nobody", "The group stays configured but is blocked."]
                ] as const).map(([value, label, detail]) => <label key={value} className={cn("flex cursor-pointer gap-2 rounded-xl border px-3 py-3 text-xs", accessMode === value ? "border-primary bg-primary/5" : "border-border bg-muted/10")}><input type="radio" name="telegram-access" value={value} checked={accessMode === value} onChange={() => setAccessMode(value)} className="mt-0.5 accent-[hsl(var(--primary))]" /><span><span className="block font-medium">{label}</span><span className="mt-1 block text-[10px] leading-4 text-muted-foreground">{detail}</span></span></label>)}
              </div>
              {accessMode === "selected" ? <div className="rounded-xl border border-border bg-muted/10 p-3"><div className="flex gap-2"><Input value={senderInput} onChange={(event) => setSenderInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addSender(); } }} placeholder="Telegram sender ID" inputMode="numeric" aria-label="Telegram sender ID" /><Button type="button" variant="secondary" size="sm" className="h-9 shrink-0" onClick={addSender} disabled={!senderInput.trim()}><Plus className="mr-1 h-3.5 w-3.5" />Add</Button></div><p className="mt-2 text-[10px] leading-4 text-muted-foreground">Sender IDs are Telegram user IDs, not the group chat ID. OpenClaw has not exposed a member directory here, so IDs are entered explicitly.</p>{senderIds.length > 0 ? <div className="mt-2 flex flex-wrap gap-1.5">{senderIds.map((senderId) => <Badge key={senderId} variant="muted" className="gap-1 rounded-md px-2 py-1 font-mono text-[10px]">{senderId}<button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => setSenderIds((current) => current.filter((id) => id !== senderId))} aria-label={`Remove sender ${senderId}`}>×</button></Badge>)}</div> : null}</div> : null}
            </section>

            <section aria-labelledby="telegram-response-heading" className="space-y-3 border-t border-border pt-4">
              <div><h3 id="telegram-response-heading" className="text-sm font-semibold">Response behavior</h3><p className="text-[11px] text-muted-foreground">Keep replies quiet unless the group explicitly mentions the bot.</p></div>
              <label className="flex cursor-pointer items-center justify-between rounded-xl border border-border bg-muted/10 px-3 py-3 text-xs"><span><span className="block font-medium">Only respond when mentioned</span><span className="mt-1 block text-[10px] text-muted-foreground">Native requireMention: {requireMention ? "on" : "off"}.</span></span><input type="checkbox" checked={requireMention} onChange={(event) => setRequireMention(event.target.checked)} className="h-4 w-4 accent-[hsl(var(--primary))]" /></label>
            </section>

            <section aria-labelledby="telegram-tools-heading" className="space-y-3 border-t border-border pt-4">
              <div className="flex items-center gap-2"><Wrench className="h-4 w-4 text-primary" /><div><h3 id="telegram-tools-heading" className="text-sm font-semibold">Capabilities in this group</h3><p className="text-[11px] text-muted-foreground">This is an additional group tool policy. Agent-level OpenClaw restrictions still apply.</p></div></div>
              <div className="grid gap-2 sm:grid-cols-2">
                {([
                  ["agent-defaults", "Agent defaults", "No extra group restriction."],
                  ["chat-only", "Chat only", "No tool calls from this group."],
                  ["research", "Research", "Native Web tools only."],
                  ["selected-tools", "Selected tools", "Choose exact tools from OpenClaw."]
                ] as const).map(([value, label, detail]) => <label key={value} className={cn("flex cursor-pointer gap-2 rounded-xl border px-3 py-3 text-xs", preset === value ? "border-primary bg-primary/5" : "border-border bg-muted/10", ((value === "research" || value === "selected-tools") && !canChooseTools) && "cursor-not-allowed opacity-60")}><input type="radio" name="telegram-capabilities" value={value} checked={preset === value} onChange={() => setPreset(value)} disabled={(value === "research" || value === "selected-tools") && !canChooseTools} className="mt-0.5 accent-[hsl(var(--primary))]" /><span><span className="block font-medium">{label}</span><span className="mt-1 block text-[10px] leading-4 text-muted-foreground">{detail}</span></span></label>)}
              </div>
              {!canChooseTools ? <p className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-[10px] leading-4 text-amber-900 dark:text-amber-100">The live OpenClaw tool catalog is unavailable. Chat only remains available; reconnect the Gateway to choose Web or exact tools.</p> : null}
              {preset === "selected-tools" && canChooseTools ? <div className="space-y-3 rounded-xl border border-border bg-muted/10 p-3">{payload.toolCatalog.groups.map((catalogGroup) => <div key={catalogGroup.id}><p className="mb-2 text-[11px] font-semibold">{catalogGroup.label}</p><div className="grid gap-1.5 sm:grid-cols-2">{catalogGroup.tools.map((tool) => <label key={tool.id} className="flex cursor-pointer items-start gap-2 rounded-lg border border-border/70 bg-background/50 px-2.5 py-2 text-[10px]"><input type="checkbox" checked={selectedTools.includes(tool.id)} onChange={() => toggleTool(tool.id)} className="mt-0.5 accent-[hsl(var(--primary))]" /><span><span className="block font-medium">{tool.label}{tool.risk ? <span className="ml-1 text-muted-foreground">· {tool.risk} risk</span> : null}</span><span className="mt-0.5 block leading-4 text-muted-foreground">{tool.description}</span></span></label>)}</div></div>)}</div> : null}
              {preset === "research" && canChooseTools ? <p className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-[10px] leading-4 text-muted-foreground">Research maps to the live OpenClaw <code>web</code> group ({payload.toolCatalog.groups.find((catalogGroup) => catalogGroup.id === "web")?.tools.map((tool) => tool.id).join(", ") || "no tools"}).</p> : null}
              {payload.agent.label ? <p className="text-[10px] text-muted-foreground">Agent: <span className="font-medium text-foreground">{payload.agent.label || agentLabel}</span>. OpenClaw applies this Agent policy after the group policy.</p> : null}
            </section>

            <section className="border-t border-border pt-4">
              <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => setAdvancedOpen((current) => !current)} aria-expanded={advancedOpen}><ChevronDown className={cn("mr-1.5 h-3.5 w-3.5 transition-transform", advancedOpen && "rotate-180")} />Advanced</Button>
              {advancedOpen ? <div className="mt-3 space-y-4 rounded-xl border border-border bg-muted/10 p-3">
                <div><p className="text-xs font-semibold">Member overrides</p><p className="mt-1 text-[10px] leading-4 text-muted-foreground">OpenClaw toolsBySender keys are native sender selectors. These overrides remain bounded by the Agent-level OpenClaw policy.</p><div className="mt-2 flex gap-2"><Input value={overrideInput} onChange={(event) => setOverrideInput(event.target.value)} placeholder="Telegram sender ID" inputMode="numeric" aria-label="Override sender ID" /><select value={overridePreset} onChange={(event) => setOverridePreset(event.target.value as CapabilityPreset)} aria-label="Override capability" className="h-9 rounded-lg border border-input bg-card px-2 text-xs text-foreground"><option value="chat-only">Chat only</option><option value="agent-defaults">Agent defaults</option><option value="research" disabled={!canChooseTools}>Research</option></select><Button type="button" variant="secondary" size="sm" className="h-9 shrink-0" onClick={addOverride} disabled={!overrideInput.trim() || (overridePreset === "research" && !canChooseTools)}><Plus className="mr-1 h-3.5 w-3.5" />Add</Button></div>{overrides.length > 0 ? <div className="mt-2 space-y-1.5">{overrides.map((override) => <div key={override.key} className="flex items-center justify-between gap-2 rounded-lg border border-border/70 bg-background/50 px-2.5 py-2 text-[10px]"><span className="font-mono">{override.key}</span><span className="ml-auto text-muted-foreground">{capabilityLabel(override.preset)}</span><button type="button" className="rounded p-1 text-muted-foreground hover:text-destructive" onClick={() => { setOverridesDirty(true); setOverrides((current) => current.filter((entry) => entry.key !== override.key)); }} aria-label={`Remove override ${override.key}`}><Trash2 className="h-3 w-3" /></button></div>)}</div> : <p className="mt-2 text-[10px] text-muted-foreground">No sender-specific tool overrides are configured.</p>}</div>
                <div><p className="text-xs font-semibold">Skills</p>{!canChooseSkills ? <p className="mt-1 text-[10px] text-muted-foreground">Live OpenClaw skill discovery is unavailable.</p> : <div className="mt-2 grid gap-1.5 sm:grid-cols-2">{payload.skillsCatalog.skills.map((skill) => <label key={skill.name} className="flex cursor-pointer items-center gap-2 rounded-lg border border-border/70 bg-background/50 px-2.5 py-2 text-[10px]"><input type="checkbox" checked={selectedSkills.includes(skill.name)} onChange={() => toggleSkill(skill.name)} className="accent-[hsl(var(--primary))]" />{skill.emoji ? <span>{skill.emoji}</span> : null}<span className="truncate">{skill.name}</span></label>)}</div>}</div>
                <label className="block space-y-1.5"><span className="text-xs font-semibold">Group instructions</span><Textarea value={instructions} onChange={(event) => { setInstructionsDirty(true); setInstructions(event.target.value); }} placeholder="Optional native systemPrompt for this group" className="min-h-24 text-xs" /><span className="block text-[10px] leading-4 text-muted-foreground">Stored as OpenClaw group systemPrompt. It does not create a second AgentOS prompt store.</span></label>
                <div><p className="text-xs font-semibold">Topics</p><p className="mt-1 text-[10px] leading-4 text-muted-foreground">Topic config is native and remains preserved. Each topic can inherit or override its supported native fields.</p>{payload.topics.length > 0 ? <div className="mt-2 space-y-1.5">{payload.topics.map((topic) => <div key={topic.id} className="flex items-center justify-between rounded-lg border border-border/70 bg-background/50 px-2.5 py-2 text-[10px]"><span>Topic {topic.id}</span><span className="text-muted-foreground">{topic.requireMention === null ? "inherits mention" : topic.requireMention ? "mention required" : "mentions optional"}{topic.skills.length > 0 ? ` · ${topic.skills.length} skills` : ""}{topic.hasInstructions ? " · instructions" : ""}</span></div>)}</div> : <p className="mt-2 text-[10px] text-muted-foreground">No configured topic overrides.</p>}</div>
              </div> : null}
            </section>
          </> : null}
        </div>

        <DialogFooter className="border-t border-border px-5 py-3 sm:flex-row"><Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button><Button type="button" onClick={() => void save()} disabled={!payload || loading || saving}><ShieldCheck className="mr-1.5 h-3.5 w-3.5" />{saving ? <><LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" />Saving…</> : <><Save className="mr-1.5 h-3.5 w-3.5" />Save permissions</>}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function buildOverridePolicy(preset: CapabilityPreset, catalog: ToolCatalog) {
  if (preset === "agent-defaults") return {};
  if (preset === "research") return { allow: catalog.groups.find((group) => group.id === "web")?.tools.map((tool) => tool.id) ?? [] };
  return { deny: ["*"] };
}

function capabilityLabel(preset: CapabilityPreset) {
  return preset === "agent-defaults" ? "Agent defaults" : preset === "research" ? "Research" : "Chat only";
}
