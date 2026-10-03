import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import type { AgentOsProductUpdatePhase } from "@/lib/agentos/domains/product-update";

export type DesktopUpdateProgress = {
  operationId: string;
  state: "running" | "restart-required" | "failed" | "unknown";
  phase: AgentOsProductUpdatePhase | null;
  progress: number | null;
  message: string;
};

export function isAgentOsDesktop() {
  return isTauri();
}

export async function checkDesktopAgentOsUpdate() {
  return invoke<{ checkId: string; status: string; latestVersion: string | null }>("check_agentos_update");
}

export async function installDesktopAgentOsUpdate(operationId: string) {
  return invoke<void>("install_agentos_update", { operationId });
}

export async function listenForDesktopAgentOsUpdateProgress(
  handler: (progress: DesktopUpdateProgress) => void
) {
  return listen<DesktopUpdateProgress>("agentos-update-progress", (event) => handler(event.payload));
}
