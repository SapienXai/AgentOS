import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  readOperatorProfile,
  resolveOperatorProfilePath,
  saveOperatorProfile
} from "@/lib/agentos/application/operator-profile-service";

test("operator profile sidecar defaults safely and writes owner-only data", async () => {
  const runtimeDir = await mkdtemp(path.join(tmpdir(), "agentos-profile-"));
  const env = { ...process.env, AGENTOS_RUNTIME_DIR: runtimeDir };

  assert.deepEqual(await readOperatorProfile(env), {
    fullName: "",
    username: "",
    email: "",
    avatarDataUrl: null,
    updatedAt: null
  });

  const saved = await saveOperatorProfile({
    fullName: "  Kazim Akgul  ",
    username: "Kazim.Akgul",
    email: "KAZIM@EXAMPLE.COM",
    avatarDataUrl: null
  }, env);
  const profilePath = resolveOperatorProfilePath(env);
  const stored = JSON.parse(await readFile(profilePath, "utf8")) as Record<string, unknown>;
  const fileStat = await stat(profilePath);

  assert.equal(saved.fullName, "Kazim Akgul");
  assert.equal(saved.username, "kazim.akgul");
  assert.equal(saved.email, "kazim@example.com");
  assert.equal(stored.version, 2);
  assert.equal(stored.actorId, null);
  assert.equal(fileStat.mode & 0o777, 0o600);
  assert.deepEqual(await readOperatorProfile(env), saved);
});

test("operator profile sidecar rejects unsupported avatars and corrupt data", async () => {
  const runtimeDir = await mkdtemp(path.join(tmpdir(), "agentos-profile-invalid-"));
  const env = { ...process.env, AGENTOS_RUNTIME_DIR: runtimeDir };

  await assert.rejects(
    saveOperatorProfile({
      fullName: "Kazim Akgul",
      username: "kazim",
      email: "kazim@example.com",
      avatarDataUrl: "data:image/svg+xml;base64,PHN2Zz4="
    }, env),
    /avatar is invalid or too large/
  );

  await writeFile(resolveOperatorProfilePath(env), "{not-json", "utf8");
  await assert.rejects(readOperatorProfile(env), /unavailable or invalid/);
});
