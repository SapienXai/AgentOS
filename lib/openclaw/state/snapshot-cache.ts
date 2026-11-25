export type SnapshotLoadProfile = "interactive" | "refresh" | "system";

export type SnapshotPair<TSnapshot> = {
  visible: TSnapshot;
  full: TSnapshot;
};

type SnapshotCacheEntry<TSnapshot> = SnapshotPair<TSnapshot> & {
  expiresAt: number;
};

export class SnapshotCacheController<TSnapshot> {
  private cache: SnapshotCacheEntry<TSnapshot> | null = null;
  private pending: { generation: number; promise: Promise<SnapshotPair<TSnapshot>> } | null = null;
  private generation = 0;

  constructor(
    private readonly options: {
      ttlMs: number;
      load: (profile: SnapshotLoadProfile, generation: number) => Promise<SnapshotPair<TSnapshot>>;
    }
  ) {}

  getGeneration() {
    return this.generation;
  }

  clear(options: { incrementGeneration?: boolean } = {}) {
    if (options.incrementGeneration) {
      this.generation += 1;
    }

    this.cache = null;
  }

  async get(options: { force?: boolean; includeHidden?: boolean; loadProfile?: SnapshotLoadProfile } = {}): Promise<TSnapshot> {
    const cachedSnapshot = this.cache;
    const cacheIsFresh = Boolean(cachedSnapshot && cachedSnapshot.expiresAt > Date.now());

    if (!options.force && cacheIsFresh && cachedSnapshot) {
      return selectSnapshot(cachedSnapshot, options.includeHidden);
    }

    if (!options.force && cachedSnapshot) {
      if (this.pending?.generation !== this.generation) {
        this.loadForCurrentGeneration("interactive");
      }

      return selectSnapshot(cachedSnapshot, options.includeHidden);
    }

    if (options.force) {
      this.generation += 1;
      this.cache = null;
    }

    const pending = this.pending?.generation === this.generation
      ? this.pending
      : this.loadForCurrentGeneration(options.force ? options.loadProfile ?? "refresh" : "interactive");
    const result = await pending.promise;
    return pending.generation === this.generation
      ? selectSnapshot(result, options.includeHidden)
      : this.get({ includeHidden: options.includeHidden });
  }

  private loadForCurrentGeneration(profile: SnapshotLoadProfile) {
    const generation = this.generation;

    const promise = this.options.load(profile, generation).then((nextSnapshot) => {
      if (generation === this.generation) {
        this.cache = {
          ...nextSnapshot,
          expiresAt: Date.now() + this.options.ttlMs
        };
      }

      return nextSnapshot;
    });
    const pending = { generation, promise };
    this.pending = pending;
    void promise.finally(() => {
      if (this.pending === pending) this.pending = null;
    }).catch(() => {});
    return pending;
  }
}

function selectSnapshot<TSnapshot>(
  snapshot: SnapshotPair<TSnapshot>,
  includeHidden?: boolean
) {
  return includeHidden ? snapshot.full : snapshot.visible;
}
