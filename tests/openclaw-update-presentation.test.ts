import assert from "node:assert/strict";
import { test } from "node:test";

import {
  formatAutomaticUpdateState,
  formatNativeChannel,
  resolveNativeUpdateActionBlockReason,
  guardNormalOpenClawUpdate,
  resolveOpenClawProductUpdateState,
  resolveNativeUpdateUserState,
  resolveNormalOpenClawUpdatePolicy
} from "@/lib/openclaw/update-presentation";
import { isStableOpenClawVersion } from "@/lib/openclaw/domains/normal-update-policy";
import type { OpenClawCompatibilityManifest } from "@/lib/openclaw/update-compatibility";
import type { NativeDoctorSnapshot } from "@/lib/openclaw/application/native-doctor-service";

function update(overrides: Partial<NativeDoctorSnapshot["update"]> = {}): NativeDoctorSnapshot["update"] {
  return {
    readStatus: "available",
    status: "current",
    updateAvailable: false,
    currentVersion: "2026.9.1",
    latestVersion: null,
    effectiveChannel: "stable",
    schedule: null,
    explanation: "OpenClaw reports no update is currently available.",
    ...overrides
  };
}

test("native current status is presented as up to date", () => {
  assert.equal(
    resolveNativeUpdateUserState({
      update: update()
    }),
    "up-to-date"
  );
});

test("disabled native update explains the actual permission, policy, or confirmation blocker", () => {
  assert.equal(resolveNativeUpdateActionBlockReason({
    canManageUpdates: false,
    policyCanRunNormalUpdate: false,
    policyReason: "OpenClaw operator admin authorization is unavailable.",
    hasBoundConfirmation: false,
    checking: false
  }), "Your AgentOS account cannot manage updates.");
  assert.equal(resolveNativeUpdateActionBlockReason({
    canManageUpdates: true,
    policyCanRunNormalUpdate: false,
    policyReason: "OpenClaw configuration is not applied.",
    hasBoundConfirmation: true,
    checking: false
  }), "OpenClaw configuration is not applied.");
  assert.equal(resolveNativeUpdateActionBlockReason({
    canManageUpdates: true,
    policyCanRunNormalUpdate: true,
    policyReason: null,
    hasBoundConfirmation: false,
    checking: false
  }), "Refresh native update status to bind confirmation to the current Gateway.");
  assert.equal(resolveNativeUpdateActionBlockReason({
    canManageUpdates: true,
    policyCanRunNormalUpdate: true,
    policyReason: null,
    hasBoundConfirmation: true,
    checking: false
  }), null);
  assert.equal(resolveNativeUpdateActionBlockReason({
    canManageUpdates: false,
    policyCanRunNormalUpdate: null,
    policyReason: null,
    hasBoundConfirmation: false,
    checking: true
  }), null);
});

test("native available target with an exact certified decision is eligible for normal update", () => {
  assert.equal(
    resolveNativeUpdateUserState({
      update: update({
        status: "available",
        updateAvailable: true,
        latestVersion: "2026.9.2"
      }),
      agentOsDecision: {
        version: "2026.9.2",
        status: "certified",
        allowed: true,
        defaultVisible: true,
        requiresExplicitOptIn: false,
        requiresAgentOsUpdate: false,
        minRequiredAgentOsVersion: null,
        reason: "Certified",
        notes: null
      }
    }),
    "available-certified"
  );
});

test("durable active native run wins over a temporary unavailable availability probe", () => {
  const state = resolveNativeUpdateUserState({
    update: {
      ...update({ currentVersion: "2026.9.1" }),
      readStatus: "unknown",
      status: "unknown",
      updateAvailable: null,
      activeRun: {
        runId: "run-1",
        createdAtMs: 1,
        updatedAtMs: 2,
        trigger: "control-ui",
        phase: "restarting",
        status: "running",
        reason: null,
        targetVersion: "2026.9.2",
        beforeVersion: "2026.9.1",
        afterVersion: null,
        steps: [],
        verification: null,
        repair: [],
        confirmedAtMs: null,
        finishedAtMs: null,
        downtimeMs: null
      }
    }
  });

  assert.equal(state, "running");
});

test("native available target remains explicitly uncertified without an exact decision", () => {
  assert.equal(
    resolveNativeUpdateUserState({
      update: update({
        status: "available",
        updateAvailable: true,
        latestVersion: "2026.9.3"
      }),
      agentOsDecision: {
        version: "2026.9.3",
        status: "unknown",
        allowed: false,
        defaultVisible: false,
        requiresExplicitOptIn: true,
        requiresAgentOsUpdate: false,
        minRequiredAgentOsVersion: null,
        reason: "Unknown",
        notes: null
      }
    }),
    "available-uncertified"
  );
});

test("AgentOS certification never invents an update when native OpenClaw says current", () => {
  assert.equal(
    resolveNativeUpdateUserState({
      update: update({ currentVersion: "2026.9.1" }),
      agentOsDecision: {
        version: "2026.9.2",
        status: "certified",
        allowed: true,
        defaultVisible: true,
        requiresExplicitOptIn: false,
        requiresAgentOsUpdate: false,
        minRequiredAgentOsVersion: null,
        reason: "Certified",
        notes: null
      }
    }),
    "up-to-date"
  );
});

test("blocked native target remains blocked even when a higher certification value exists", () => {
  assert.equal(
    resolveNativeUpdateUserState({
      update: update({
        status: "available",
        updateAvailable: true,
        latestVersion: "2026.9.3"
      }),
      agentOsDecision: {
        version: "2026.9.3",
        status: "blocked",
        allowed: false,
        defaultVisible: false,
        requiresExplicitOptIn: false,
        requiresAgentOsUpdate: false,
        minRequiredAgentOsVersion: null,
        reason: "Blocked",
        notes: null
      }
    }),
    "blocked"
  );
});

test("native campaign hold is shown before normal availability action", () => {
  assert.equal(
    resolveNativeUpdateUserState({
      update: update({
        status: "available",
        updateAvailable: true,
        latestVersion: "2026.9.2",
        schedule: {
          autoEnabled: true,
          campaign: { state: "countdown", holdUntilMs: Date.now() + 60_000 }
        }
      }),
      agentOsDecision: {
        version: "2026.9.2",
        status: "certified",
        allowed: true,
        defaultVisible: true,
        requiresExplicitOptIn: false,
        requiresAgentOsUpdate: false,
        minRequiredAgentOsVersion: null,
        reason: "Certified",
        notes: null
      }
    }),
    "held"
  );
});

test("native forbidden, unavailable, and unknown reads are not reported as up to date", () => {
  assert.equal(
    resolveNativeUpdateUserState({
      update: update({ readStatus: "forbidden", status: "unavailable" }),
      agentOsDecision: null
    }),
    "unavailable"
  );
  assert.equal(
    resolveNativeUpdateUserState({
      update: update({ readStatus: "unavailable", status: "unavailable" }),
      agentOsDecision: null
    }),
    "unavailable"
  );
  assert.equal(
    resolveNativeUpdateUserState({
      update: update({ readStatus: "unknown", status: "unknown" }),
      agentOsDecision: null
    }),
    "unknown"
  );
});

test("product update state keeps a discovered target visible when native mutation is unavailable", () => {
  const policy = resolveNormalOpenClawUpdatePolicy({
    snapshot: policySnapshot({
      ...update({ currentVersion: "2026.9.3" }),
      discoveredAvailableVersion: "2026.9.4",
      availabilitySource: "openclaw-cli-fallback"
    }),
    agentOsVersion: "0.7.9",
    manifest: manifest([{ version: "2026.9.4", status: "certified" }])
  });

  assert.equal(policy.nativeAvailableVersion, null);
  assert.equal(policy.productUpdate.state, "available-fallback");
  assert.equal(policy.productUpdate.action, "advanced");
  assert.equal(policy.productUpdate.availableVersion, "2026.9.4");
  assert.match(policy.productUpdate.reason, /read-only CLI status fallback/);
  assert.equal(policy.canRunNormalUpdate, false);
});

test("product update state separates availability from certification and AgentOS prerequisites", () => {
  const available = resolveOpenClawProductUpdateState({
    nativeState: "available-uncertified",
    currentVersion: "2026.9.3",
    availableVersion: "2026.9.4",
    availabilitySource: "native-gateway",
    agentOsDecision: {
      version: "2026.9.4",
      status: "candidate",
      allowed: false,
      defaultVisible: true,
      requiresExplicitOptIn: true,
      requiresAgentOsUpdate: false,
      minRequiredAgentOsVersion: null,
      reason: "Certification pending",
      notes: null
    }
  });
  const required = resolveOpenClawProductUpdateState({
    nativeState: "available-uncertified",
    currentVersion: "2026.9.3",
    availableVersion: "2026.9.4",
    availabilitySource: "native-gateway",
    agentOsDecision: {
      version: "2026.9.4",
      status: "certified",
      allowed: false,
      defaultVisible: false,
      requiresExplicitOptIn: false,
      requiresAgentOsUpdate: true,
      minRequiredAgentOsVersion: "0.8.0",
      reason: "AgentOS 0.8.0 is required",
      notes: null
    }
  });
  const blocked = resolveOpenClawProductUpdateState({
    nativeState: "blocked",
    currentVersion: "2026.9.3",
    availableVersion: "2026.9.4",
    availabilitySource: "native-gateway",
    agentOsDecision: {
      version: "2026.9.4",
      status: "blocked",
      allowed: false,
      defaultVisible: false,
      requiresExplicitOptIn: false,
      requiresAgentOsUpdate: false,
      minRequiredAgentOsVersion: null,
      reason: "Blocked by policy",
      notes: null
    }
  });

  assert.deepEqual(
    { state: available.state, action: available.action },
    { state: "available-uncertified", action: "advanced" }
  );
  assert.deepEqual(
    { state: required.state, action: required.action },
    { state: "available-agentos-required", action: "update-agentos" }
  );
  assert.deepEqual(
    { state: blocked.state, action: blocked.action },
    { state: "blocked", action: "view-compatibility" }
  );
});

test("native channel and automatic update labels preserve the official payload", () => {
  assert.equal(formatNativeChannel("extended-stable"), "Extended stable");
  assert.equal(formatNativeChannel("beta"), "Beta");
  assert.equal(formatNativeChannel("future-channel"), "future-channel");
  assert.equal(formatAutomaticUpdateState({ autoEnabled: true }), "On");
  assert.equal(formatAutomaticUpdateState({ autoEnabled: false }), "Off");
  assert.equal(formatAutomaticUpdateState(null), "Not reported");
});

function manifest(entries: OpenClawCompatibilityManifest["versions"]): OpenClawCompatibilityManifest {
  return {
    schemaVersion: 1,
    source: "override",
    recommendedVersion: "2026.9.3",
    versions: entries
  };
}

function policyUpdate(latestVersion: string) {
  return {
    status: "available" as const,
    readStatus: "available" as const,
    updateAvailable: true,
    currentVersion: "2026.9.1",
    latestVersion,
    effectiveChannel: "stable",
    schedule: null,
    explanation: "available"
  };
}

function policySnapshot(updateValue: NativeDoctorSnapshot["update"]): NativeDoctorSnapshot {
  return {
    generatedAt: "2026-10-01T00:00:00.000Z",
    source: "openclaw-native",
    runtime: { status: "healthy", reachable: true, explanation: "healthy" },
    status: {
      readStatus: "available",
      runtimeVersion: "2026.9.1",
      version: null,
      updateChannel: "stable",
      gatewayReachable: true,
      gatewayMode: "local"
    },
    diagnostics: { status: "available", stability: null },
    config: {
      readStatus: "available",
      valid: true,
      configuredRevisionHash: "revision-1",
      appliedRevisionHash: "revision-1",
      hotReloadStatus: "applied",
      application: "applied",
      explanation: "applied"
    },
    update: updateValue,
    recovery: { status: "healthy", issues: [], actions: ["refresh", "probe"], explanation: "healthy" },
    identity: {
      connectionId: "connection-1",
      deviceId: "device-1",
      connectionGeneration: 4,
      authenticated: true,
      role: "operator",
      grantedScopesKnown: true,
      updateAuthorized: true
    },
    reads: {
      health: "available",
      status: "available",
      "diagnostics.stability": "available",
      "config.get": "available",
      "update.status": "available",
      identity: "available"
    }
  };
}

test("exact manifest status wins over version ordering", () => {
  const policy = resolveNormalOpenClawUpdatePolicy({
    snapshot: policySnapshot(policyUpdate("2026.9.2")),
    agentOsVersion: "0.7.2",
    manifest: manifest([
      { version: "2026.9.1", status: "certified" },
      { version: "2026.9.2", status: "blocked" },
      { version: "2026.9.3", status: "certified" }
    ])
  });

  assert.equal(policy.agentOsDecision?.status, "blocked");
  assert.equal(policy.canRunNormalUpdate, false);
  assert.equal(policy.state, "blocked");
});

test("unknown manifest gaps remain uncertified even below a certified release", () => {
  const policy = resolveNormalOpenClawUpdatePolicy({
    snapshot: policySnapshot(policyUpdate("2026.9.2")),
    agentOsVersion: "0.7.2",
    manifest: manifest([
      { version: "2026.9.1", status: "certified" },
      { version: "2026.9.3", status: "certified" }
    ])
  });

  assert.equal(policy.agentOsDecision?.status, "unknown");
  assert.equal(policy.canRunNormalUpdate, true);
  assert.equal(policy.state, "available-uncertified");
  assert.equal(policy.requiresInformedConfirmation, true);
  assert.equal(policy.productUpdate.action, "update-openclaw");
});

test("newer stable targets beyond the recommendation use the normal native path after informed confirmation", () => {
  const policy = resolveNormalOpenClawUpdatePolicy({
    snapshot: policySnapshot(policyUpdate("2026.9.8")),
    agentOsVersion: "0.8.0",
    manifest: manifest([{ version: "2026.9.7", status: "certified" }])
  });

  assert.equal(policy.agentOsDecision?.status, "unknown");
  assert.equal(policy.productUpdate.state, "available-uncertified");
  assert.equal(policy.productUpdate.action, "update-openclaw");
  assert.equal(policy.canRunNormalUpdate, true);
  assert.equal(policy.requiresInformedConfirmation, true);
  assert.deepEqual(guardNormalOpenClawUpdate({ policy, confirmationMatches: true, unverifiedAcknowledged: true }), { allowed: true });
});

test("native authorization and complete preflight remain server-side update requirements", () => {
  const authorizedPolicy = resolveNormalOpenClawUpdatePolicy({
    snapshot: policySnapshot(policyUpdate("2026.9.8")),
    agentOsVersion: "0.8.0",
    manifest: manifest([{ version: "2026.9.7", status: "certified" }])
  });
  const unauthorized = resolveNormalOpenClawUpdatePolicy({
    snapshot: {
      ...policySnapshot(policyUpdate("2026.9.8")),
      identity: { ...policySnapshot(policyUpdate("2026.9.8")).identity, updateAuthorized: false }
    },
    agentOsVersion: "0.8.0",
    manifest: manifest([{ version: "2026.9.7", status: "certified" }])
  });
  const unhealthy = resolveNormalOpenClawUpdatePolicy({
    snapshot: {
      ...policySnapshot(policyUpdate("2026.9.8")),
      recovery: { status: "needs-attention", issues: [], actions: [], explanation: "repair needed" }
    },
    agentOsVersion: "0.8.0",
    manifest: manifest([{ version: "2026.9.7", status: "certified" }])
  });
  const unidentified = resolveNormalOpenClawUpdatePolicy({
    snapshot: {
      ...policySnapshot(policyUpdate("2026.9.8")),
      identity: { ...policySnapshot(policyUpdate("2026.9.8")).identity, connectionGeneration: null }
    },
    agentOsVersion: "0.8.0",
    manifest: manifest([{ version: "2026.9.7", status: "certified" }])
  });
  const missingOptionalDeviceId = resolveNormalOpenClawUpdatePolicy({
    snapshot: {
      ...policySnapshot(policyUpdate("2026.9.8")),
      identity: { ...policySnapshot(policyUpdate("2026.9.8")).identity, deviceId: null }
    },
    agentOsVersion: "0.8.0",
    manifest: manifest([{ version: "2026.9.7", status: "certified" }])
  });

  assert.equal(guardNormalOpenClawUpdate({ policy: authorizedPolicy, confirmationMatches: true, unverifiedAcknowledged: true }).allowed, true);
  assert.equal(missingOptionalDeviceId.nativeIdentityAvailable, true);
  assert.equal(missingOptionalDeviceId.canRunNormalUpdate, true);
  assert.equal(guardNormalOpenClawUpdate({ policy: missingOptionalDeviceId, confirmationMatches: true, unverifiedAcknowledged: true }).allowed, true);
  const authorizationResult = guardNormalOpenClawUpdate({ policy: unauthorized, confirmationMatches: true, unverifiedAcknowledged: true });
  assert.equal(authorizationResult.allowed, false);
  if (!authorizationResult.allowed) assert.equal(authorizationResult.code, "NATIVE_UPDATE_AUTHORIZATION_REQUIRED");
  const preflightResult = guardNormalOpenClawUpdate({ policy: unhealthy, confirmationMatches: true, unverifiedAcknowledged: true });
  assert.equal(preflightResult.allowed, false);
  if (!preflightResult.allowed) assert.equal(preflightResult.code, "UPDATE_PREFLIGHT_UNAVAILABLE");
  const identityResult = guardNormalOpenClawUpdate({ policy: unidentified, confirmationMatches: true, unverifiedAcknowledged: true });
  assert.equal(identityResult.allowed, false);
  if (!identityResult.allowed) assert.equal(identityResult.code, "NATIVE_UPDATE_IDENTITY_UNAVAILABLE");
});

test("AgentOS minimum version and non-stable channels remain hard blockers", () => {
  const required = resolveNormalOpenClawUpdatePolicy({
    snapshot: policySnapshot(policyUpdate("2026.9.8")),
    agentOsVersion: "0.7.2",
    manifest: manifest([{
      version: "2026.9.8",
      status: "candidate",
      minRequiredAgentOsVersion: "0.8.0"
    }])
  });
  const beta = resolveNormalOpenClawUpdatePolicy({
    snapshot: policySnapshot({ ...policyUpdate("2026.9.8-beta.1"), effectiveChannel: "beta" }),
    agentOsVersion: "0.8.0",
    manifest: manifest([])
  });

  assert.equal(guardNormalOpenClawUpdate({ policy: required, confirmationMatches: true, unverifiedAcknowledged: true }).allowed, false);
  assert.equal(beta.canRunNormalUpdate, false);
  const betaResult = guardNormalOpenClawUpdate({ policy: beta, confirmationMatches: true, unverifiedAcknowledged: true });
  assert.equal(betaResult.allowed, false);
  if (!betaResult.allowed) assert.equal(betaResult.code, "UPDATE_TARGET_INVALID");
});

test("date-version validation supports future stable releases and rejects invalid progression", () => {
  assert.equal(isStableOpenClawVersion("2027.1.2"), true);
  assert.equal(isStableOpenClawVersion("2026.9.8-beta.1"), false);
  assert.equal(isStableOpenClawVersion("2026.13.1"), false);
  assert.equal(isStableOpenClawVersion("2026.2.30"), false);
});

test("community release signals cannot change the native policy decision", () => {
  const input = {
    snapshot: policySnapshot(policyUpdate("2026.9.2")),
    agentOsVersion: "0.7.2",
    manifest: manifest([{ version: "2026.9.2", status: "blocked" }])
  } as const;
  const withHighCommunitySignal = resolveNormalOpenClawUpdatePolicy(input);
  const withLowCommunitySignal = resolveNormalOpenClawUpdatePolicy(input);
  assert.deepEqual(withHighCommunitySignal, withLowCommunitySignal);
  assert.equal(withHighCommunitySignal.canRunNormalUpdate, false);
});

test("native applying campaign is visible after a page reload", () => {
  const policy = resolveNormalOpenClawUpdatePolicy({
    snapshot: policySnapshot({
        ...policyUpdate("2026.9.2"),
        schedule: { autoEnabled: true, campaign: { state: "applying" } }
      }),
    agentOsVersion: "0.7.2",
    manifest: manifest([{ version: "2026.9.2", status: "certified" }])
  });

  assert.equal(policy.state, "running");
  assert.equal(policy.canRunNormalUpdate, false);
});

test("native hold is only available for an active automatic campaign", () => {
  const policy = resolveNormalOpenClawUpdatePolicy({
    snapshot: policySnapshot({
        ...policyUpdate("2026.9.2"),
        schedule: { autoEnabled: true, campaign: { state: "countdown" } }
      }),
    agentOsVersion: "0.7.2",
    manifest: manifest([{ version: "2026.9.2", status: "certified" }])
  });

  assert.equal(policy.canHoldUpdate, true);
});

test("normal update gate rejects direct policy bypasses", () => {
  const blocked = resolveNormalOpenClawUpdatePolicy({
    snapshot: policySnapshot(policyUpdate("2026.9.2")),
    agentOsVersion: "0.7.2",
    manifest: manifest([{ version: "2026.9.2", status: "blocked" }])
  });
  const result = guardNormalOpenClawUpdate({ policy: blocked, confirmationMatches: true });

  assert.equal(result.allowed, false);
  if (!result.allowed) assert.equal(result.code, "UPDATE_POLICY_BLOCKED");
  assert.equal(
    guardNormalOpenClawUpdate({ policy: blocked, confirmationMatches: true, unverifiedAcknowledged: true }).allowed,
    false,
    "an unverified acknowledgment must not override an explicit block"
  );
});

test("normal update gate allows an exact certified native target", () => {
  const policy = resolveNormalOpenClawUpdatePolicy({
    snapshot: policySnapshot(policyUpdate("2026.9.2")),
    agentOsVersion: "0.7.2",
    manifest: manifest([{ version: "2026.9.2", status: "certified" }])
  });
  assert.deepEqual(guardNormalOpenClawUpdate({ policy, confirmationMatches: true }), { allowed: true });
});

test("unverified exact stable targets require informed confirmation in the normal update route", () => {
  for (const status of ["candidate", "unknown"] as const) {
    const policy = resolveNormalOpenClawUpdatePolicy({
      snapshot: policySnapshot(policyUpdate("2026.9.2")),
      agentOsVersion: "0.7.2",
      manifest: manifest([{ version: "2026.9.2", status }])
    });
    const result = guardNormalOpenClawUpdate({ policy, confirmationMatches: true });

    assert.equal(result.allowed, false);
    if (!result.allowed) assert.equal(result.code, "UPDATE_CONFIRMATION_REQUIRED");
    assert.deepEqual(
      guardNormalOpenClawUpdate({ policy, confirmationMatches: true, unverifiedAcknowledged: true }),
      { allowed: true }
    );
  }
});

test("normal update gate rejects a native available state without an exact target", () => {
  const policy = resolveNormalOpenClawUpdatePolicy({
    snapshot: policySnapshot({ ...policyUpdate("2026.9.2"), latestVersion: null }),
    agentOsVersion: "0.7.2",
    manifest: manifest([{ version: "2026.9.2", status: "certified" }])
  });
  const result = guardNormalOpenClawUpdate({ policy, confirmationMatches: true });

  assert.equal(result.allowed, false);
  if (!result.allowed) assert.equal(result.code, "NATIVE_UPDATE_TARGET_UNKNOWN");
});

test("normal update gate rejects stale target, channel, or Gateway confirmation", () => {
  const policy = resolveNormalOpenClawUpdatePolicy({
    snapshot: policySnapshot(policyUpdate("2026.9.2")),
    agentOsVersion: "0.7.2",
    manifest: manifest([{ version: "2026.9.2", status: "certified" }])
  });
  const result = guardNormalOpenClawUpdate({ policy, confirmationMatches: false });

  assert.equal(result.allowed, false);
  if (!result.allowed) assert.equal(result.code, "UPDATE_CONFIRMATION_STALE");
});

test("normal update gate requires native availability and exact target evidence", () => {
  const policy = resolveNormalOpenClawUpdatePolicy({
    snapshot: policySnapshot({
        ...policyUpdate("2026.9.2"),
        readStatus: "unknown",
        status: "unknown",
        updateAvailable: null,
        latestVersion: null
      }),
    agentOsVersion: "0.7.2",
    manifest: manifest([{ version: "2026.9.2", status: "certified" }])
  });
  const result = guardNormalOpenClawUpdate({ policy, confirmationMatches: true });

  assert.equal(result.allowed, false);
  if (!result.allowed) assert.equal(result.code, "NATIVE_UPDATE_STATUS_UNAVAILABLE");
});
