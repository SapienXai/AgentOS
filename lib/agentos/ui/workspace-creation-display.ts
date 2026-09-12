import type { WorkspaceCreationRun } from "@/lib/agentos/domains/workspace-creation-run";
import { presentWorkspaceCreationDiscovery } from "@/lib/agentos/domains/workspace-creation-discovery";
import { normalizeWorkspaceCreationProfile } from "@/lib/agentos/domains/workspace-creation-policy";

export type WorkspaceCreationDisplayEvent = { label: string; kind: "discovered" | "created" | "ready" };

/** Deliberately never forwards runtime messages, model output, locators or diagnostics. */
export function presentWorkspaceCreationDisplay(run: WorkspaceCreationRun | null, provisioning?: {
  state: string;
  steps?: readonly { id: string; status: string }[];
} | null) {
  const events = new Map<string, WorkspaceCreationDisplayEvent>();
  const add = (label: string, kind: WorkspaceCreationDisplayEvent["kind"] = "discovered") => events.set(label, { label, kind });
  for (const source of run?.snapshot.context.sourceProgress ?? []) {
    if (source.storedDocuments > 0) {
      const declaration = run?.input.sources.find((item): item is { id: string; kind: string } => Boolean(item && typeof item === "object" && "id" in item && "kind" in item && item.id === source.sourceId));
      add(declaration?.kind === "repository" ? "GitHub" : declaration?.kind === "website" ? "Website" : "Documents");
    }
  }
  if (run) {
    const discovery = presentWorkspaceCreationDiscovery(run);
    if (discovery.aggregate.facts > 0) add("Project");
    if (discovery.aggregate.resources > 0) add("Resources");
  }
  const created = provisioning?.steps?.some((step) => step.id === "applying-composition" && step.status === "complete");
  const profile = run?.expediteRequestedAt ? "fast" : normalizeWorkspaceCreationProfile(run?.input.profile);
  if (created || provisioning?.state === "ready") {
    add("Identity", "created");
    add("Instructions", "created");
    if (profile !== "fast") add("Memory", "created");
  }
  if (provisioning?.state === "ready") add("Workspace", "ready");
  const activity = provisioning
    ? provisioning.state === "ready" ? "Workspace ready" : provisioning.state === "failed" ? "Your workspace needs attention." : provisioning.state === "applying-composition" ? "Writing workspace instructions…" : "Setting up your workspace…"
    : run?.expediteRequestedAt ? "Finishing with the current context…"
    : run?.snapshot.stage === "workspace-composition" ? "Writing workspace instructions…"
    : run?.snapshot.stage === "review-preparation" ? "Finishing your workspace…"
    : run?.snapshot.stage === "architect-reasoning" ? "Preparing your workspace…"
    : "Learning about your project…";
  return { activity, events: [...events.values()].slice(-10) };
}
