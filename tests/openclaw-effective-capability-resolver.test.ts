import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  getWorkerEffectiveCapabilities,
  normalizeSkillLibraryDetail,
  normalizeSkillLibraryItem,
  resolveEffectiveCapability,
  type CapabilityResolutionInput
} from "@/lib/openclaw/application/worker-capability-service";
import { setOpenClawAdapterForTesting } from "@/lib/openclaw/adapter/openclaw-adapter";

afterEach(() => setOpenClawAdapterForTesting(null));

const baseInput: CapabilityResolutionInput = {
  id: "openclaw:github",
  label: "GitHub",
  category: "Development",
  description: "Read and update GitHub repositories through OpenClaw.",
  configured: true,
  tool: {
    id: "github",
    label: "GitHub",
    description: "GitHub access",
    source: "plugin",
    catalogPresent: true,
    effectivePresent: true,
    deniedBySession: false,
    channelId: null
  },
  runtime: {
    available: true,
    sessionKey: "agent:worker:main",
    profile: "coding"
  }
};

function resolve(overrides: Partial<CapabilityResolutionInput> = {}) {
  return resolveEffectiveCapability({
    ...baseInput,
    ...overrides,
    tool: overrides.tool === undefined ? baseInput.tool : overrides.tool,
    runtime: overrides.runtime === undefined ? baseInput.runtime : overrides.runtime
  });
}

test("effective capability resolver resolves the native status matrix", () => {
  assert.equal(resolve().status, "available");
  assert.equal(resolve({ approval: { required: true, canRequest: true } }).status, "requires-approval");
  assert.equal(resolve({ account: { provider: "GitHub", connected: false, accountId: null } }).status, "needs-setup");
  assert.equal(resolve({ tool: { ...baseInput.tool!, deniedBySession: true } }).status, "blocked");
  assert.equal(resolve({ runtime: { available: false, sessionKey: "agent:worker:main", profile: "coding" } }).status, "unavailable");
  assert.equal(resolve({ runtime: { available: null, sessionKey: null, profile: null }, tool: { ...baseInput.tool!, effectivePresent: null } }).status, "unknown");
});

test("explicit block takes precedence over approval and setup", () => {
  const result = resolve({
    account: { provider: "GitHub", connected: false, accountId: null },
    approval: { required: true, canRequest: true },
    policy: { denied: true, layer: "Workspace" }
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.effective, true);
  assert.equal(result.reasons[0]?.code, "policy_denied");
});

test("configured and catalog presence never makes a non-effective tool available", () => {
  const result = resolve({
    tool: { ...baseInput.tool!, effectivePresent: false },
    runtime: { available: true, sessionKey: "agent:worker:main", profile: "coding" }
  });

  assert.equal(result.configured, true);
  assert.equal(result.effective, false);
  assert.equal(result.status, "unavailable");
  assert.equal(result.reasons[0]?.code, "tool_not_effective");
});

test("native effective denial outranks downstream account setup", () => {
  const result = resolve({
    tool: { ...baseInput.tool!, effectivePresent: false },
    account: { provider: "GitHub", connected: false, accountId: null }
  });

  assert.equal(result.status, "unavailable");
  assert.equal(result.reasons[0]?.code, "tool_not_effective");
});

test("catalog presence alone stays unknown without native session-effective facts", () => {
  const result = resolve({
    tool: { ...baseInput.tool!, effectivePresent: null },
    runtime: { available: null, sessionKey: null, profile: null }
  });

  assert.equal(result.status, "unknown");
  assert.equal(result.evidence.tool?.catalogPresent, true);
  assert.equal(result.evidence.tool?.effectivePresent, null);
});

test("native effective tools remain authoritative when catalog data is incomplete", () => {
  const result = resolve({
    tool: {
      ...baseInput.tool!,
      catalogPresent: false,
      effectivePresent: true
    },
    runtime: { available: true, sessionKey: "agent:worker:main", profile: "coding" }
  });

  assert.equal(result.status, "available");
  assert.equal(result.reasons[0]?.code, "tool_effective");
});

test("unknown native tools stay visible through one bounded Other capability", async () => {
  const calls: string[] = [];
  setOpenClawAdapterForTesting({
    async listAgents() {
      calls.push("agents.list");
      return { agents: [{ id: "worker" }] } as never;
    },
    async listSessions() {
      calls.push("sessions.list");
      return { sessions: [{ agentId: "worker", key: "agent:worker:main", updatedAt: 10 }] };
    },
    async getToolsCatalog() {
      calls.push("tools.catalog");
      return { agentId: "worker", profiles: [], groups: [{ id: "core", label: "Core", source: "core", tools: [
        { id: "future_tool", label: "Future tool", description: "Future", source: "core", defaultProfiles: ["coding"] }
      ] }] };
    },
    async getEffectiveTools() {
      calls.push("tools.effective");
      return { agentId: "worker", profile: "coding", groups: [{ id: "core", label: "Core", source: "core", tools: [
        { id: "future_tool", label: "Future tool", description: "Future", rawDescription: "Future", source: "core" }
      ] }] };
    },
    async listSkillLibrary() {
      calls.push("skills.library.list");
      return { entries: [], profileId: null, multipleProfiles: false, defaultTarget: "unavailable", canManageWorkspace: false, defaultSelectionLimit: 64, session: { sessionKey: "agent:worker:main", selections: [], attachable: [] } };
    },
    async getChannelStatus() {
      calls.push("channels.status");
      return { ts: 1, channelOrder: [], channelLabels: {}, channels: {}, channelAccounts: {}, channelDefaultAccountId: {} };
    }
  } as never);

  const result = await getWorkerEffectiveCapabilities("worker");
  assert.equal(result.capabilities.length, 1);
  assert.equal(result.capabilities[0]?.id, "openclaw:other");
  assert.equal(result.capabilities[0]?.label, "Other");
  assert.equal(result.capabilities[0]?.status, "available");
  assert.deepEqual(result.capabilities[0]?.evidence.tool?.toolIds, ["future_tool"]);
  assert.deepEqual(calls.sort(), ["agents.list", "channels.status", "sessions.list", "skills.library.list", "tools.catalog", "tools.effective"].sort());
});

test("library normalization preserves native ownership, latest revision, and session revision", () => {
  const entry = {
    skillId: "11111111-1111-4111-8111-111111111111",
    slug: "lead-qualification",
    name: "Lead Qualification",
    description: "Qualify leads.",
    ownerProfileId: "profile-1",
    ownerLabel: "Operator",
    authorProfileId: "profile-1",
    shared: false,
    enabled: true,
    removed: false,
    revision: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    createdAt: 1756684800000,
    updatedAt: 1756857600000,
    canEdit: true
  } as const;
  const item = normalizeSkillLibraryItem(entry, "agent:worker:main", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");

  assert.equal(item.id, entry.skillId);
  assert.equal(item.ownership.scope, "personal");
  assert.equal(item.revision.id, entry.revision);
  assert.equal(item.activation.activeRevisionId?.startsWith("bbbb"), true);
  assert.equal(item.activation.activeInSession, true);

  const detail = normalizeSkillLibraryDetail({
    entry,
    content: "# Lead Qualification",
    files: [{ path: "SKILL.md", content: "IyBMRUFEX1FVQUxJRklDQVRJT04=", encoding: "base64", executable: false }],
    revisions: [{ revision: entry.revision, createdAt: entry.createdAt }]
  }, "agent:worker:main", entry.revision);
  assert.equal(detail.files[0]?.encoding, "base64");
  assert.equal(detail.revisions[0]?.id, entry.revision);
});

test("worker capability resolution keeps the native read graph bounded", async () => {
  const calls: string[] = [];
  setOpenClawAdapterForTesting({
    async listAgents() {
      calls.push("agents.list");
      return { agents: [{
          id: "worker",
          toolPolicy: null
        }] } as never;
    },
    async listSessions() {
      calls.push("sessions.list");
      return { sessions: [{ agentId: "worker", key: "agent:worker:main", updatedAt: 10 }] };
    },
    async getToolsCatalog() {
      calls.push("tools.catalog");
      return {
        agentId: "worker",
        profiles: [],
        groups: [{ id: "core", label: "Core", source: "core", tools: [
          { id: "exec", label: "Shell", description: "Shell", source: "core", defaultProfiles: ["coding"] },
          { id: "browser", label: "Browser", description: "Browser", source: "core", defaultProfiles: ["full"] }
        ] }]
      };
    },
    async getEffectiveTools() {
      calls.push("tools.effective");
      return {
        agentId: "worker",
        profile: "coding",
        groups: [{ id: "core", label: "Core", source: "core", tools: [
          { id: "exec", label: "Shell", description: "Shell", rawDescription: "Shell", source: "core" }
        ] }]
      };
    },
    async listSkillLibrary() {
      calls.push("skills.library.list");
      return {
        entries: [],
        profileId: null,
        multipleProfiles: false,
        defaultTarget: "unavailable",
        canManageWorkspace: false,
        defaultSelectionLimit: 64,
        session: { sessionKey: "agent:worker:main", selections: [], attachable: [] }
      };
    },
    async getChannelStatus() {
      calls.push("channels.status");
      return { ts: 1, channelOrder: [], channelLabels: {}, channels: {}, channelAccounts: {}, channelDefaultAccountId: {} };
    }
  } as never);

  const result = await getWorkerEffectiveCapabilities("worker");
  assert.equal(result.capabilities.find((entry) => entry.id === "openclaw:shell")?.status, "available");
  assert.equal(result.capabilities.find((entry) => entry.id === "openclaw:web-browsing")?.status, "unavailable");
  assert.deepEqual(calls.sort(), [
    "agents.list",
    "channels.status",
    "sessions.list",
    "skills.library.list",
    "tools.catalog",
    "tools.effective"
  ].sort());
});
