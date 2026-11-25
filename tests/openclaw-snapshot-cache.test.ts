import assert from "node:assert/strict";
import test from "node:test";

import { SnapshotCacheController, type SnapshotPair } from "@/lib/openclaw/state/snapshot-cache";

test("an older refresh cannot clear, publish over, or resolve ahead of a newer generation", async () => {
  const first = Promise.withResolvers<SnapshotPair<string>>();
  const second = Promise.withResolvers<SnapshotPair<string>>();
  let loads = 0;
  const cache = new SnapshotCacheController({
    ttlMs: 1_000,
    load: () => (++loads === 1 ? first.promise : second.promise)
  });
  const original = cache.get();
  const refresh = cache.get({ force: true, includeHidden: true });
  first.resolve({ visible: "old-visible", full: "old-full" });
  await first.promise;

  const concurrent = cache.get();
  assert.equal(loads, 2);
  second.resolve({ visible: "new-visible", full: "new-full" });
  assert.equal(await original, "new-visible");
  assert.equal(await refresh, "new-full");
  assert.equal(await concurrent, "new-visible");
  assert.equal(await cache.get(), "new-visible");
  assert.equal(loads, 2);
});
