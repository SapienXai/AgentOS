import "server-only";

import {
  SnapshotCacheController,
  type SnapshotLoadProfile,
  type SnapshotPair
} from "@/lib/openclaw/state/snapshot-cache";

export class MissionControlCacheService<TSnapshot> {
  private readonly controller: SnapshotCacheController<TSnapshot>;

  constructor(options: {
    ttlMs: number;
    load: (profile: SnapshotLoadProfile, generation: number) => Promise<SnapshotPair<TSnapshot>>;
  }) {
    this.controller = new SnapshotCacheController<TSnapshot>(options);
  }

  getGeneration() {
    return this.controller.getGeneration();
  }

  clear() {
    this.controller.clear();
  }

  getSnapshot(options: { force?: boolean; includeHidden?: boolean; loadProfile?: SnapshotLoadProfile } = {}) {
    return this.controller.get(options);
  }
}
