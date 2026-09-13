import assert from "node:assert/strict";
import { test } from "node:test";

import {
  classifyCertificationChangedPaths,
  evaluateCertificationFreshness
} from "@/scripts/check-certification-freshness.mjs";

const certifiedCodeHead = "a".repeat(40);
const currentHead = "b".repeat(40);

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
