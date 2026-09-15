import type { MissionControlSnapshot } from "@/lib/openclaw/types";
import { getSurfaceCatalogEntry } from "@/lib/openclaw/surface-catalog";

export function getWorkspaceChannels(snapshot: MissionControlSnapshot, workspaceId: string) {
  return snapshot.channelRegistry.channels
    .filter((channel) => channel.workspaces.some((binding) => binding.workspaceId === workspaceId))
    .sort((left, right) => {
      const leftKind = getSurfaceCatalogEntry(left.type).kind;
      const rightKind = getSurfaceCatalogEntry(right.type).kind;

      if (leftKind !== rightKind) {
        return leftKind.localeCompare(rightKind);
      }

      if (left.type !== right.type) {
        return getSurfaceCatalogEntry(left.type).label.localeCompare(getSurfaceCatalogEntry(right.type).label);
      }

      return left.name.localeCompare(right.name);
    });
}

export function replaceSnapshotChannelRegistry(
  snapshot: MissionControlSnapshot,
  channelRegistry: MissionControlSnapshot["channelRegistry"]
) {
  return {
    ...snapshot,
    channelRegistry
  };
}

export function upsertSnapshotChannelAccount(
  snapshot: MissionControlSnapshot,
  account: MissionControlSnapshot["channelAccounts"][number]
) {
  const nextAccounts = snapshot.channelAccounts.filter((entry) => entry.id !== account.id);

  return {
    ...snapshot,
    channelAccounts: [...nextAccounts, account]
  };
}

export function removeSnapshotChannelAccount(snapshot: MissionControlSnapshot, accountId: string) {
  return {
    ...snapshot,
    channelAccounts: snapshot.channelAccounts.filter((entry) => entry.id !== accountId)
  };
}
