import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const packageRoot = path.resolve(import.meta.dirname, "..");

test("keeps the bridge thin and shell-free", () => {
  const launcher = readFileSync(path.join(packageRoot, "src/launcher.ts"), "utf8");
  const packageJson = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8"));

  assert.match(launcher, /shell:\s*false/);
  assert.doesNotMatch(launcher, /from ["']@sapienx\/agentos/);
  assert.equal(packageJson.dependencies, undefined);
  assert.equal(packageJson.openclaw.compat.pluginApi, ">=2026.9.4");
  assert.equal(packageJson.openclaw.build.openclawVersion, "2026.9.4");
});

test("keeps the native manifest and package metadata aligned", () => {
  const manifest = JSON.parse(readFileSync(path.join(packageRoot, "openclaw.plugin.json"), "utf8"));
  const packageJson = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8"));

  assert.equal(manifest.id, "agentos");
  assert.equal(manifest.version, packageJson.version);
  assert.deepEqual(manifest.categories, ["other"]);
  assert.deepEqual(manifest.skills, ["skills/agentos"]);
  assert.deepEqual(manifest.cliCommands, [
    {
      name: "agentos",
      description: "Open and inspect the AgentOS control plane",
      hasSubcommands: true
    }
  ]);
});
