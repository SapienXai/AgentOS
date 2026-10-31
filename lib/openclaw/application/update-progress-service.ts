import "server-only";

import { getNativeDoctorSnapshot, verifyCompletedUpdateState } from "./native-doctor-service";
import type { NativeDoctorSnapshot, NativeDoctorVerification, NativeUpdateRunProjection } from "./native-doctor-service";
import { getOpenClawCapabilityMatrix } from "./capability-matrix-service";
import type { OpenClawCapabilityMatrix } from "@/lib/openclaw/types";

export type OpenClawUpdateProgress = {
  observedAt: string;
  connected: boolean;
  currentVersion: string | null;
  run: NativeUpdateRunProjection | null;
  verification: NativeDoctorVerification;
};

export function projectUpdateProgress(snapshot: NativeDoctorSnapshot, matrix: OpenClawCapabilityMatrix | null): OpenClawUpdateProgress {
  const run = snapshot.update.activeRun ?? snapshot.update.lastRun ?? null;
  return {
    observedAt: snapshot.generatedAt,
    connected: snapshot.identity.authenticated === true && snapshot.status.readStatus === "available" && snapshot.runtime.reachable === true,
    currentVersion: snapshot.status.runtimeVersion || snapshot.status.version || snapshot.update.currentVersion,
    run,
    verification: verifyCompletedUpdateState(snapshot, matrix)
  };
}

/** Read native progress without repeating registry discovery or mutation preflight. */
export async function readOpenClawUpdateProgress() {
  const snapshot = await getNativeDoctorSnapshot({ discoverAvailability: false, commandOptions: { timeoutMs: 1500 } });
  const matrix = snapshot.update.lastRun?.status === "succeeded" && snapshot.runtime.status === "healthy"
    ? await getOpenClawCapabilityMatrix({ force: true }).catch(() => null)
    : null;
  return projectUpdateProgress(snapshot, matrix);
}
