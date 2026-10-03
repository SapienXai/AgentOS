import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  classifyCertificationChangedPaths,
  evaluateCertificationFreshness,
  getCertificationEvidencePathForVersion,
  getCurrentCertificationTarget,
  resolveCertificationEvidenceSelection,
  checkCertificationFreshness
} from "@/scripts/check-certification-freshness.mjs";

const certifiedCodeHead = "a".repeat(40);
const currentHead = "b".repeat(40);

async function withPolicyFixture(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentos-certification-freshness-"));
  try {
    await mkdir(path.join(root, "lib/openclaw"), { recursive: true });
    await writeFile(path.join(root, "lib/openclaw/versions.ts"), [
      'export const OPENCLAW_RECOMMENDED_VERSION: string = "2026.9.7";',
      'export const OPENCLAW_NATIVE_CONTRACT_VERSION: string = "2026.9.7";',
      'export const OPENCLAW_FINAL_CERTIFICATION_PHASE = "pre-merge-final-certification" as const;'
    ].join("\n"));
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("default certification freshness follows the promoted policy target, not the newest file", async () => {
  await withPolicyFixture(async (root) => {
    await mkdir(path.join(root, "docs/evidence"), { recursive: true });
    await writeFile(path.join(root, "docs/evidence/openclaw-2026.9.8-pre-merge-final-certification.json"), "{}");

    assert.deepEqual(getCurrentCertificationTarget(root), {
      version: "2026.9.7",
      phase: "pre-merge-final-certification",
      evidencePath: "docs/evidence/openclaw-2026.9.7-pre-merge-final-certification.json"
    });
    assert.equal(getCertificationEvidencePathForVersion("2026.9.4"), "docs/evidence/openclaw-2026.9.4-pre-merge-final-certification.json");
    assert.deepEqual(resolveCertificationEvidenceSelection({ repoRoot: root, version: "2026.9.4" }), {
      version: "2026.9.4",
      evidencePath: "docs/evidence/openclaw-2026.9.4-pre-merge-final-certification.json"
    });
  });
});

test("certification freshness refuses ambiguous recommended and native targets", async () => {
  await withPolicyFixture(async (root) => {
    const policyPath = path.join(root, "lib/openclaw/versions.ts");
    const source = await readFile(policyPath, "utf8");
    await writeFile(policyPath, source.replace("OPENCLAW_NATIVE_CONTRACT_VERSION: string = \"2026.9.7\"", "OPENCLAW_NATIVE_CONTRACT_VERSION: string = \"2026.9.4\""));
    assert.throws(() => getCurrentCertificationTarget(root), /differ/i);
  });
});

test("certification freshness rejects evidence whose target identity differs from its selected version", async () => {
  await withPolicyFixture(async (root) => {
    const evidencePath = "docs/evidence/openclaw-2026.9.4-pre-merge-final-certification.json";
    await mkdir(path.dirname(path.join(root, evidencePath)), { recursive: true });
    await writeFile(path.join(root, evidencePath), JSON.stringify({
      artifactType: "openclaw-2026.9.4-pre-merge-final-certification",
      openclawVersion: "2026.9.4",
      success: true
    }));

    const result = checkCertificationFreshness({
      repoRoot: root,
      evidencePath,
      expectedVersion: "2026.9.7",
      currentHead: currentHead
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, "certification-target-mismatch");
    assert.equal(result.expectedVersion, "2026.9.7");
    assert.equal(result.actualVersion, "2026.9.4");
  });
});

test("certification freshness accepts the exact certified code HEAD", () => {
  const result = evaluateCertificationFreshness({
    certifiedCodeHead,
    currentHead: certifiedCodeHead,
    changedPaths: []
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "fresh");
  assert.deepEqual(result.meaningfulPaths, []);
});

test("certification freshness allows documentation and evidence commits after code certification", () => {
  const result = evaluateCertificationFreshness({
    certifiedCodeHead,
    currentHead,
    changedPaths: [
      "docs/evidence/openclaw-2026.9.4-pre-merge-final-certification.json",
      "docs/openclaw-2026.9.4-compatibility-audit.md",
      "README.md"
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "fresh-documentation-only");
  assert.deepEqual(result.meaningfulPaths, []);
  assert.equal(result.documentationOnlyPaths.length, 3);
});

test("certification freshness treats the separately validated OpenClaw CLI package as runtime-neutral", () => {
  const result = evaluateCertificationFreshness({
    certifiedCodeHead,
    currentHead,
    changedPaths: [
      "README.md",
      "docs/openclaw-agentos-plugin-release.md",
      ".github/workflows/openclaw-agentos-package-publish.yml",
      "packages/openclaw-agentos/src/index.ts",
      "packages/openclaw-agentos/tests/launcher.test.mjs",
      "packages/openclaw-agentos/.gitignore",
      "pnpm-lock.yaml",
      "scripts/check-certification-freshness.mjs",
      "tests/certification-freshness.test.ts"
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "fresh-independent-package-only");
  assert.deepEqual(result.meaningfulPaths, []);
});

test("plugin-scoped lockfile changes do not hide AgentOS runtime changes", () => {
  const result = evaluateCertificationFreshness({
    certifiedCodeHead,
    currentHead,
    changedPaths: [
      "pnpm-lock.yaml",
      "packages/openclaw-agentos/src/index.ts",
      "lib/openclaw/application/chatgpt-provider-auth-service.ts"
    ]
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, "recertification-required");
  assert.ok(result.meaningfulPaths.includes("pnpm-lock.yaml"));
  assert.ok(result.meaningfulPaths.includes("lib/openclaw/application/chatgpt-provider-auth-service.ts"));
});

test("certification freshness fails and reports meaningful paths after code certification", () => {
  const result = evaluateCertificationFreshness({
    certifiedCodeHead,
    currentHead,
    changedPaths: [
      "docs/evidence/openclaw-2026.9.4-pre-merge-final-certification.json",
      "lib/openclaw/application/chatgpt-provider-auth-service.ts",
      "tests/openclaw-chatgpt-provider-auth-service.test.ts"
    ]
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, "recertification-required");
  assert.deepEqual(result.meaningfulPaths, [
    "lib/openclaw/application/chatgpt-provider-auth-service.ts",
    "tests/openclaw-chatgpt-provider-auth-service.test.ts"
  ]);
  assert.match(result.reason, /Meaningful repository paths/);
});

test("certification freshness treats unknown configuration paths as meaningful", () => {
  const classification = classifyCertificationChangedPaths([
    "Dockerfile.railway",
    ".github/workflows/ci.yml",
    "docs/evidence/result.json"
  ]);

  assert.deepEqual(classification.meaningfulPaths, [
    "Dockerfile.railway",
    ".github/workflows/ci.yml"
  ]);
  assert.deepEqual(classification.documentationOnlyPaths, ["docs/evidence/result.json"]);
});

test("certification freshness fails when the certified commit is not an ancestor", () => {
  const result = evaluateCertificationFreshness({
    certifiedCodeHead,
    currentHead,
    changedPaths: [],
    certifiedCodeIsAncestor: false
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, "certified-head-not-ancestor");
});

test("certification freshness fails when final certification is blocked", () => {
  const result = evaluateCertificationFreshness({
    certifiedCodeHead,
    currentHead,
    changedPaths: [],
    certificationSuccess: false
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, "certification-failed");
});
