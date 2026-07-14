import "server-only";

import { getMissionControlSnapshot } from "@/lib/agentos/control-plane";
import { createLoadingSnapshot } from "@/lib/openclaw/fallback";
import type { ControlPlaneSnapshot } from "@/lib/agentos/contracts";

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
  const result = await getBoundedControlPlaneSnapshot();
  return result.snapshot;
}
