import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const servicePath = "lib/agentos/application/workspace-provisioning-service.ts";
const routePath = "app/api/workspaces/provision/route.ts";
const createPath = "components/mission-control/workspace-create/create-workspace-experience.tsx";

test("Phase 6 provisioning uses the canonical OpenClaw workspace boundary", async () => {
  const source = await readFile(servicePath, "utf8");

  assert.match(source, /createWorkspaceProject\(prepared\.createInput/);
  assert.match(source, /promoteWorkspaceCreationKnowledge/);
  assert.match(source, /ensureWorkspaceNativeKnowledge/);
  assert.match(source, /updateAgent\(/);
  assert.doesNotMatch(source, /runOpenClaw|runOpenClawJson/);
  assert.doesNotMatch(source, /from ["']@\/lib\/agentos\/control-plane/);
});

test("provisioning records durable states, checkpoints, and actor-scoped idempotency", async () => {
  const source = await readFile(servicePath, "utf8");

  for (const state of ["pending", "validating", "materializing", "bootstrapping", "promoting-knowledge", "provisioning-agents", "binding-knowledge", "applying-capabilities", "recording-declarations", "verifying", "ready", "partial", "failed"]) {
    assert.match(source, new RegExp(`['\"]${state}['\"]`));
  }
  assert.match(source, /idempotencyKeyHash/);
  assert.match(source, /mkdir\(lockPath/);
  assert.match(source, /open\(filePath, "wx"/);
  assert.match(source, /checkpoints:/);
  assert.match(source, /isTerminal\(run\.state\)/);
  assert.match(source, /signal\?: AbortSignal/);
  assert.match(source, /state: cancelled \? "cancelled" : "failed"/);
  assert.match(source, /workspace may be incomplete and can be resumed/);
});

test("provisioning keeps knowledge freshness and materialization validation server-side", async () => {
  const source = await readFile(servicePath, "utf8");

  assert.match(source, /validateWorkspaceBlueprint/);
  assert.match(source, /getWorkspaceBlueprintFreshness/);
  assert.match(source, /knowledge-generation-mismatch/);
  assert.match(source, /blueprint-stale/);
  assert.match(source, /unsafe-materialization-target/);
  assert.match(source, /unsafe-repository-url/);
  assert.match(source, /acceptDraft !== true/);
});

test("provisioning writes an AgentOS-owned manifest and records setup without activating it", async () => {
  const source = await readFile(servicePath, "utf8");

  assert.match(source, /WORKSPACE_PROVISIONING_MANIFEST_RELATIVE_PATH = "\.openclaw\/agentos-provisioning\.json"/);
  assert.match(source, /pendingSetup/);
  assert.match(source, /writeProvisioningManifest/);
  assert.match(source, /automations: blueprint\.operations\.automations/);
  assert.match(source, /channels: blueprint\.operations\.channels/);
  assert.doesNotMatch(source, /createManagedChatChannelAccount|createManagedSurfaceAccount|createCron/);
});

test("provisioning API authenticates the actor and never accepts a client actor or workspace path", async () => {
  const source = await readFile(routePath, "utf8");

  assert.match(source, /requireAgentOsProductPermission\(request, "workspace\.manage"\)/g);
  assert.match(source, /actorId: permission\.actor\.actorId/);
  assert.match(source, /blueprint: z\.unknown\(\)/);
  assert.match(source, /idempotencyKey/);
  assert.doesNotMatch(source, /actorId: z\.|workspacePath: z\.|existingPath: z\./);
  assert.match(source, /getWorkspaceProvisioningRun/);
});

test("Create Workspace follows the real provisioning run and exposes live signals", async () => {
  const source = await readFile(createPath, "utf8");

  assert.match(source, /type CreateStage = "intake" \| "generating" \| "review" \| "provisioning"/);
  assert.match(source, /fetch\("\/api\/workspaces\/provision"/);
  assert.match(source, /Live provisioning signals/);
  assert.match(source, /while \(!isProvisioningTerminal\(current\.state\)\)/);
  assert.match(source, /Open Workspace/);
  assert.match(source, /Retry provisioning/);
  assert.doesNotMatch(source, /Final creation is a Phase 6 action/);
});
