import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getMissionControlSnapshot } from "@/lib/agentos/control-plane";
import { createLoadingSnapshot } from "@/lib/openclaw/fallback";
import { loadMissionControlInventory } from "@/lib/openclaw/application/mission-control/inventory-snapshot";
import type { ControlPlaneSnapshot } from "@/lib/agentos/contracts";
import { resolveAgentOsActorContext } from "@/lib/security/agentos-actor";
import { canAgentOsActorUseProductPermission } from "@/lib/security/agentos-product-authorization";
import { redactSecrets } from "@/lib/security/redaction";

const INITIAL_SNAPSHOT_TIMEOUT_MS = 800;

export async function getBoundedControlPlaneSnapshot(
  timeoutMs = INITIAL_SNAPSHOT_TIMEOUT_MS
) {
  const snapshotPromise = getMissionControlSnapshot();
  const safeSnapshotPromise = snapshotPromise.catch(() =>
    createLoadingSnapshot("OpenClaw snapshot is loading.")
  );

  const result = await new Promise<{ snapshot: ControlPlaneSnapshot; pending: boolean }>((resolve) => {
    const timeoutId = setTimeout(
      () => resolve({
        snapshot: createLoadingSnapshot("OpenClaw snapshot is loading."),
        pending: true
      }),
      timeoutMs
    );

    safeSnapshotPromise.then(
      (value) => {
        clearTimeout(timeoutId);
        resolve({ snapshot: value, pending: false });
      },
      () => {
        clearTimeout(timeoutId);
        resolve({
          snapshot: createLoadingSnapshot("OpenClaw snapshot is loading."),
          pending: false
        });
      }
    );
  });

  void snapshotPromise.catch(() => {});

  return result;
}

export async function getInitialControlPlaneSnapshot() {
  const request = new Request("http://localhost/", { headers: await headers() });
  const actor = await resolveAgentOsActorContext(request);
  // The CLI can deliver its credential in a browser fragment. Allow the
  // credential bridge to start without reading or serializing runtime data.
  if (!actor) {
    const snapshot = createLoadingSnapshot("Sign in to load the OpenClaw runtime.");
    snapshot.diagnostics.workspaceRoot = "";
    snapshot.diagnostics.runtime.stateRoot = "";
    return snapshot;
  }
  if (!canAgentOsActorUseProductPermission(actor, "runtime.inspect")) redirect("/operator-access");

  const snapshot = await loadMissionControlInventory()
    .catch(() => createLoadingSnapshot("Loading OpenClaw runtime activity."));
  const current = await resolveAgentOsActorContext(request);
  if (!current || current.actorId !== actor.actorId ||
      !canAgentOsActorUseProductPermission(current, "runtime.inspect")) redirect("/operator-access");
  return redactSecrets(snapshot);
}
