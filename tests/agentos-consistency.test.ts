import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  createManagedAgentOsUser,
  ensureAgentOsUserStore,
  listAgentOsUsers,
  resetManagedAgentOsUserPassword,
  updateManagedAgentOsUserProfile,
  updateManagedAgentOsUserRole,
  updateManagedAgentOsUserStatus
} from "@/lib/agentos/application/agentos-account-service";
import { resolveAgentOsActorContext } from "@/lib/security/agentos-actor";
import {
  AgentOsUserStoreError,
  readAgentOsUserStore,
  resolveAgentOsUserStorePath,
  updateAgentOsUserOpenClawLinkage
} from "@/lib/security/agentos-user-store";
import {
  createInstanceSession,
  disableInstanceProtection,
  enableInstanceProtection,
  getInstanceProtectionStatus,
  loginToInstance,
  readInstanceProtectionState,
  resolveInstanceProtectionPath
} from "@/lib/security/instance-protection";

function environment(prefix: string) {
  return mkdtemp(path.join(tmpdir(), prefix)).then((runtimeDir) => ({
    ...process.env,
    AGENTOS_RUNTIME_DIR: runtimeDir,
    NODE_ENV: "production" as const
  }));
}

function sessionRequest(session: string) {
  return new Request("https://agentos.example.com/api/profile", {
    headers: { cookie: `agentos_instance_session=${session}` }
  });
}

test("reproduces the old disable/re-enable divergence and enforces safe lifecycle semantics", async () => {
  const env = await environment("agentos-consistency-lifecycle-");
  await enableInstanceProtection({ username: "old-owner", password: "old password" }, env);
  const oldState = await readInstanceProtectionState(env);
  assert.ok(oldState);
  await createManagedAgentOsUser({ username: "member", password: "member password" }, env);

  await assert.rejects(
    disableInstanceProtection("old password", env),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "multi-user-protection-required"
  );
  assert.equal((await readInstanceProtectionState(env))?.actorId, oldState.actorId);
  assert.equal((await listAgentOsUsers(env)).length, 2);

  const singleUserEnv = await environment("agentos-consistency-single-owner-");
  await enableInstanceProtection({ username: "single-owner", password: "single password" }, singleUserEnv);
  const singleState = await readInstanceProtectionState(singleUserEnv);
  assert.ok(singleState);
  await disableInstanceProtection("single password", singleUserEnv);
  assert.equal(await readInstanceProtectionState(singleUserEnv), null);
  assert.equal(await readAgentOsUserStore(singleUserEnv), null);

  const reenabled = await enableInstanceProtection({ username: "new-owner", password: "new password" }, singleUserEnv);
  const newState = await readInstanceProtectionState(singleUserEnv);
  assert.ok(newState);
  assert.notEqual(newState.actorId, singleState.actorId);
  assert.equal((await listAgentOsUsers(singleUserEnv))[0]?.actorId, newState.actorId);
  assert.equal(reenabled.status.authenticated, true);
  await assert.rejects(
    loginToInstance({ username: "single-owner", password: "single password", rateKey: "old-single-owner" }, singleUserEnv),
    /Invalid username or password/
  );
});

test("uses one fail-closed session validator for status and actor resolution", async () => {
  const env = await environment("agentos-consistency-session-");
  const enabled = await enableInstanceProtection({ username: "owner", password: "owner password" }, env);
  const state = await readInstanceProtectionState(env);
  assert.ok(state);

  const validStatus = await getInstanceProtectionStatus(enabled.session, env);
  const validActor = await resolveAgentOsActorContext(sessionRequest(enabled.session), env);
  assert.equal(validStatus.authenticated, true);
  assert.equal(validStatus.actorId, validActor?.actorId);
  assert.equal(validActor?.actorId, state.actorId);

  const unknownSession = createInstanceSession(state, randomUUID(), 1);
  const unknownStatus = await getInstanceProtectionStatus(unknownSession, env);
  assert.equal(unknownStatus.authenticated, false);
  assert.equal(unknownStatus.actorId, null);
  assert.equal(await resolveAgentOsActorContext(sessionRequest(unknownSession), env), null);

  await resetManagedAgentOsUserPassword(state.actorId, "owner password two", env);
  assert.equal((await getInstanceProtectionStatus(enabled.session, env)).authenticated, false);
  assert.equal(await resolveAgentOsActorContext(sessionRequest(enabled.session), env), null);

  const fresh = await loginToInstance({ username: "owner", password: "owner password two", rateKey: "fresh-owner" }, env);
  assert.equal((await getInstanceProtectionStatus(fresh.session, env)).authenticated, true);
  await assert.rejects(
    updateManagedAgentOsUserStatus(state.actorId, "disabled", env),
    /At least one active owner/
  );

  const member = await createManagedAgentOsUser({ username: "session-member", password: "member password" }, env);
  const memberLogin = await loginToInstance({ username: "session-member", password: "member password", rateKey: "session-member" }, env);
  await updateManagedAgentOsUserRole(member.actorId, "owner", env);
  assert.equal((await getInstanceProtectionStatus(memberLogin.session, env)).authenticated, false);
  await updateManagedAgentOsUserRole(member.actorId, "member", env);
  await updateManagedAgentOsUserStatus(member.actorId, "disabled", env);
  assert.equal((await getInstanceProtectionStatus(memberLogin.session, env)).authenticated, false);
  assert.equal(await resolveAgentOsActorContext(sessionRequest(memberLogin.session), env), null);

  const migrationEnv = await environment("agentos-consistency-legacy-");
  const migration = await enableInstanceProtection({ username: "legacy-owner", password: "legacy password" }, migrationEnv);
  const migrationState = await readInstanceProtectionState(migrationEnv);
  assert.ok(migrationState);
  await rm(resolveAgentOsUserStorePath(migrationEnv), { force: true });
  const migratedStatus = await getInstanceProtectionStatus(migration.session, migrationEnv);
  assert.equal(migratedStatus.authenticated, true);
  assert.equal(migratedStatus.actorId, migrationState.actorId);
  assert.equal((await listAgentOsUsers(migrationEnv))[0]?.actorId, migrationState.actorId);
  const migratedAgain = await ensureAgentOsUserStore(migrationEnv);
  assert.equal(migratedAgain?.users[0]?.actorId, migrationState.actorId);

  await writeFile(resolveAgentOsUserStorePath(env), "{corrupt", { mode: 0o600 });
  await assert.rejects(getInstanceProtectionStatus(fresh.session, env), /unavailable or invalid/);
});

test("serializes concurrent account mutations and preserves the last-owner invariant", async () => {
  const env = await environment("agentos-consistency-concurrency-");
  const owner = await enableInstanceProtection({ username: "owner", password: "owner password" }, env);
  const ownerState = await readInstanceProtectionState(env);
  assert.ok(ownerState);

  const created = await Promise.all([
    createManagedAgentOsUser({ username: "member-a", password: "member password a" }, env),
    createManagedAgentOsUser({ username: "member-b", password: "member password b" }, env)
  ]);
  assert.equal(new Set(created.map((user) => user.actorId)).size, 2);
  assert.equal((await listAgentOsUsers(env)).length, 3);

  const duplicate = await Promise.allSettled([
    createManagedAgentOsUser({ username: "Duplicate", password: "duplicate password" }, env),
    createManagedAgentOsUser({ username: " duplicate ", password: "duplicate password two" }, env)
  ]);
  assert.equal(duplicate.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(duplicate.filter((result) => result.status === "rejected" && result.reason instanceof AgentOsUserStoreError && result.reason.code === "conflict").length, 1);

  const memberA = created[0]!;
  const memberB = created[1]!;
  await Promise.all([
    updateManagedAgentOsUserRole(memberA.actorId, "member", env),
    updateManagedAgentOsUserStatus(memberB.actorId, "disabled", env),
    resetManagedAgentOsUserPassword(memberA.actorId, "member password updated", env),
    updateManagedAgentOsUserProfile(memberA.actorId, {
      displayName: "Member A Updated",
      email: "member-a@example.com",
      avatarDataUrl: null
    }, env)
  ]);
  const afterConcurrent = await readAgentOsUserStore(env);
  assert.ok(afterConcurrent);
  assert.equal(afterConcurrent.users.find((user) => user.actorId === memberA.actorId)?.profile.displayName, "Member A Updated");
  assert.equal(afterConcurrent.users.find((user) => user.actorId === memberB.actorId)?.status, "disabled");
  assert.equal((await loginToInstance({ username: "member-a", password: "member password updated", rateKey: "member-a-updated" }, env)).status.authenticated, true);
  assert.equal((await getInstanceProtectionStatus(owner.session, env)).authenticated, true);

  const secondOwner = await createManagedAgentOsUser({ username: "second-owner", password: "second owner password", role: "owner" }, env);
  const ownerChanges = await Promise.allSettled([
    updateManagedAgentOsUserRole(ownerState.actorId, "member", env),
    updateManagedAgentOsUserStatus(secondOwner.actorId, "disabled", env)
  ]);
  assert.equal(ownerChanges.filter((result) => result.status === "rejected" && result.reason instanceof AgentOsUserStoreError && result.reason.code === "last-owner").length, 1);
  const finalStore = await readAgentOsUserStore(env);
  assert.ok(finalStore);
  assert.ok(finalStore.users.some((user) => user.status === "active" && user.role === "owner"));
  assert.equal((await getInstanceProtectionStatus(owner.session, env)).protectionEnabled, true);
});

test("keeps profile and OpenClaw linkage metadata isolated by actor", async () => {
  const env = await environment("agentos-consistency-boundary-");
  await enableInstanceProtection({ username: "owner", password: "owner password" }, env);
  const owner = (await listAgentOsUsers(env))[0]!;
  const member = await createManagedAgentOsUser({ username: "member", password: "member password" }, env);
  const memberLogin = await loginToInstance({ username: "member", password: "member password", rateKey: "profile-member-before" }, env);

  await updateManagedAgentOsUserProfile(owner.actorId, {
    displayName: "Owner Profile",
    email: "owner@example.com",
    avatarDataUrl: null
  }, env);
  await updateManagedAgentOsUserProfile(member.actorId, {
    displayName: "Member Profile",
    email: "member@example.com",
    avatarDataUrl: null
  }, env);
  await updateAgentOsUserOpenClawLinkage({
    actorId: owner.actorId,
    profileId: "openclaw-profile-1",
    role: "operator",
    linkageState: "linked"
  }, env);
  await assert.rejects(
    updateAgentOsUserOpenClawLinkage({
      actorId: member.actorId,
      profileId: "openclaw-profile-1",
      role: "operator",
      linkageState: "linked"
    }, env),
    (error: unknown) => error instanceof AgentOsUserStoreError && error.code === "linkage-conflict"
  );

  const store = await readAgentOsUserStore(env);
  assert.ok(store);
  assert.equal(store.users.find((user) => user.actorId === owner.actorId)?.profile.displayName, "Owner Profile");
  assert.equal(store.users.find((user) => user.actorId === member.actorId)?.profile.displayName, "Member Profile");
  assert.equal(store.users.find((user) => user.actorId === member.actorId)?.openClaw.profileId, null);
  assert.equal((await resolveAgentOsActorContext(sessionRequest(memberLogin.session), env))?.actorId, member.actorId);
  assert.match(resolveInstanceProtectionPath(env), /instance-protection\.json$/);
});
