import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  createManagedAgentOsUser,
  ensureAgentOsUserStore,
  getCurrentAgentOsUser,
  listAgentOsUsers,
  resetManagedAgentOsUserPassword,
  updateManagedAgentOsUserProfile,
  updateManagedAgentOsUserRole,
  updateManagedAgentOsUserStatus
} from "@/lib/agentos/application/agentos-account-service";
import { saveOperatorProfile } from "@/lib/agentos/application/operator-profile-service";
import { resolveAgentOsUserStorePath } from "@/lib/security/agentos-user-store";
import { resolveAgentOsActorContext } from "@/lib/security/agentos-actor";
import {
  enableInstanceProtection,
  loginToInstance,
  readInstanceProtectionState,
  resolveInstanceProtectionPath
} from "@/lib/security/instance-protection";

test("migrates the Phase 4A owner and isolates two human sessions", async () => {
  const runtimeDir = await mkdtemp(path.join(tmpdir(), "agentos-users-"));
  const env = { ...process.env, AGENTOS_RUNTIME_DIR: runtimeDir, NODE_ENV: "production" as const };
  const ownerLogin = await enableInstanceProtection({ username: "owner", password: "owner password" }, env);
  const ownerState = await readInstanceProtectionState(env);
  assert.ok(ownerState);

  const member = await createManagedAgentOsUser({ username: "member", password: "member password" }, env);
  const memberLogin = await loginToInstance({ username: "member", password: "member password", rateKey: "member-browser" }, env);
  const ownerActor = await resolveAgentOsActorContext(new Request("https://agentos.test/api/profile", { headers: { cookie: `agentos_instance_session=${ownerLogin.session}` } }), env);
  const memberActor = await resolveAgentOsActorContext(new Request("https://agentos.test/api/profile", { headers: { cookie: `agentos_instance_session=${memberLogin.session}` } }), env);

  assert.equal(ownerActor?.actorId, ownerState.actorId);
  assert.equal(ownerActor?.agentOsRole, "owner");
  assert.equal(memberActor?.actorId, member.actorId);
  assert.equal(memberActor?.agentOsRole, "member");
  assert.notEqual(ownerActor?.actorId, memberActor?.actorId);
  assert.notEqual(ownerLogin.session, memberLogin.session);
  assert.equal((await listAgentOsUsers(env)).length, 2);

  await updateManagedAgentOsUserProfile(member.actorId, {
    displayName: "Member Updated",
    email: "member@example.com",
    avatarDataUrl: null
  }, env);
  await resetManagedAgentOsUserPassword(member.actorId, "member password two", env);
  assert.equal((await getCurrentAgentOsUser(member.actorId, env))?.actorId, member.actorId);
  assert.equal((await resolveAgentOsActorContext(new Request("https://agentos.test/api/profile", { headers: { cookie: `agentos_instance_session=${memberLogin.session}` } }), env)), null);
  assert.equal((await loginToInstance({ username: "member", password: "member password two", rateKey: "member-browser-2" }, env)).status.authenticated, true);

  await updateManagedAgentOsUserStatus(member.actorId, "disabled", env);
  assert.equal((await resolveAgentOsActorContext(new Request("https://agentos.test/api/profile", { headers: { cookie: `agentos_instance_session=${memberLogin.session}` } }), env)), null);
  await assert.rejects(loginToInstance({ username: "member", password: "member password two", rateKey: "member-browser-3" }, env), /Invalid username or password/);
  assert.equal((await resolveAgentOsActorContext(new Request("https://agentos.test/api/profile", { headers: { cookie: `agentos_instance_session=${ownerLogin.session}` } }), env))?.actorId, ownerState.actorId);
});

test("preserves the final active owner and migrates a v1 state without a new actor", async () => {
  const runtimeDir = await mkdtemp(path.join(tmpdir(), "agentos-users-migration-"));
  const env = { ...process.env, AGENTOS_RUNTIME_DIR: runtimeDir, NODE_ENV: "production" as const };
  await enableInstanceProtection({ username: "legacy-owner", password: "legacy password" }, env);
  const state = await readInstanceProtectionState(env);
  assert.ok(state);
  await rm(resolveAgentOsUserStorePath(env), { force: true });
  const legacy = { ...state, version: 1 } as Record<string, unknown>;
  delete legacy.actorId;
  await writeFile(resolveInstanceProtectionPath(env), `${JSON.stringify(legacy)}\n`, { mode: 0o600 });

  const login = await loginToInstance({ username: "legacy-owner", password: "legacy password", rateKey: "migration" }, env);
  const migratedState = await readInstanceProtectionState(env);
  assert.ok(migratedState);
  assert.notEqual(migratedState.actorId, state.actorId);
  assert.equal((await ensureAgentOsUserStore(env))?.users[0]?.actorId, migratedState.actorId);
  const users = await listAgentOsUsers(env);
  assert.equal(users[0]?.role, "owner");
  assert.equal((await resolveAgentOsActorContext(new Request("https://agentos.test/api/profile", { headers: { cookie: `agentos_instance_session=${login.session}` } }), env))?.actorId, migratedState.actorId);

  await assert.rejects(updateManagedAgentOsUserRole(migratedState.actorId, "member", env), /At least one active owner/);
  await assert.rejects(updateManagedAgentOsUserStatus(migratedState.actorId, "disabled", env), /At least one active owner/);
});

test("migrates an existing Phase 4A v2 owner profile into the account store", async () => {
  const runtimeDir = await mkdtemp(path.join(tmpdir(), "agentos-users-v2-profile-"));
  const env = { ...process.env, AGENTOS_RUNTIME_DIR: runtimeDir, NODE_ENV: "production" as const };
  await enableInstanceProtection({ username: "owner", password: "owner password" }, env);
  const state = await readInstanceProtectionState(env);
  assert.ok(state);
  await saveOperatorProfile({
    fullName: "Existing Owner",
    username: "owner",
    email: "existing@example.com",
    avatarDataUrl: null
  }, env, state.actorId);
  await rm(resolveAgentOsUserStorePath(env), { force: true });

  const login = await loginToInstance({ username: "owner", password: "owner password", rateKey: "v2-profile" }, env);
  const migrated = await ensureAgentOsUserStore(env);
  assert.equal(migrated?.users[0]?.actorId, state.actorId);
  assert.equal(migrated?.users[0]?.profile.displayName, "Existing Owner");
  assert.equal(migrated?.users[0]?.profile.email, "existing@example.com");
  assert.equal((await resolveAgentOsActorContext(new Request("https://agentos.example.com/api/profile", {
    headers: { cookie: `agentos_instance_session=${login.session}` }
  }), env))?.actorId, state.actorId);
});
