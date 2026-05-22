import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { evaluateLocalOperatorRequest } from "@/lib/security/local-operator";
import { REDACTED_SECRET_VALUE, redactSecrets } from "@/lib/security/redaction";
import { writeWorkspaceManagedFileForPath } from "@/lib/openclaw/application/workspace-file-service";
import { isOpenClawTerminalCommand } from "@/lib/openclaw/terminal-command";

const rootDir = process.cwd();

test("local same-origin mutation requests are allowed", () => {
  const decision = evaluateLocalOperatorRequest({
    method: "POST",
    url: "http://localhost:3000/api/mission",
    headers: new Headers({
      host: "localhost:3000",
      origin: "http://localhost:3000"
    })
  });

  assert.deepEqual(decision, { ok: true });
});

test("unsafe remote origin mutation requests are blocked", () => {
  const decision = evaluateLocalOperatorRequest({
    method: "POST",
    url: "https://agentos.example.com/api/mission",
    headers: new Headers({
      host: "agentos.example.com",
      origin: "https://agentos.example.com"
    })
  });

  assert.equal(decision.ok, false);
  assert.equal(decision.ok ? null : decision.code, "unsafe-host");
});

test("cross-origin localhost mutation requests are blocked", () => {
  const decision = evaluateLocalOperatorRequest({
    method: "PATCH",
    url: "http://127.0.0.1:3000/api/settings/gateway",
    headers: new Headers({
      host: "127.0.0.1:3000",
      origin: "https://evil.example"
    })
  });

  assert.equal(decision.ok, false);
  assert.equal(decision.ok ? null : decision.code, "unsafe-origin");
});

test("safe read requests are not blocked by the local operator guard", () => {
  const decision = evaluateLocalOperatorRequest({
    method: "GET",
    url: "https://agentos.example.com/api/snapshot",
    headers: new Headers({
      host: "agentos.example.com",
      origin: "https://agentos.example.com"
    })
  });

  assert.deepEqual(decision, { ok: true });
});

test("forwarded non-local clients cannot use mutation APIs", () => {
  const decision = evaluateLocalOperatorRequest({
    method: "POST",
    url: "http://localhost:3000/api/settings/gateway",
    headers: new Headers({
      host: "localhost:3000",
      origin: "http://localhost:3000",
      "x-forwarded-for": "203.0.113.10"
    })
  });

  assert.equal(decision.ok, false);
  assert.equal(decision.ok ? null : decision.code, "unsafe-forwarded-client");
});

test("secret redaction handles nested objects, arrays, and diagnostic text", () => {
  const redacted = redactSecrets({
    token: "top-secret-token",
    password: "top-secret-password",
    diagnosticUrl: "ws://127.0.0.1:18789/?token=query-secret&safe=1",
    rawJson: '{"password":"json-secret","clientSecret":"client-secret"}',
    tokenUsage: {
      total: 42
    },
    nested: [
      {
        privateKey: "top-secret-private-key",
        issue: 'Authorization: Bearer bearer-secret\nOPENAI_API_KEY="sk-secret"'
      }
    ]
  });
  const serialized = JSON.stringify(redacted);

  assert.doesNotMatch(serialized, /top-secret|bearer-secret|sk-secret|query-secret|json-secret|client-secret/);
  assert.match(serialized, new RegExp(REDACTED_SECRET_VALUE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.deepEqual(redacted.tokenUsage, { total: 42 });
});

test("workspace managed file writes reject path traversal", async () => {
  const workspacePath = await makeWorkspace("agentos-path-traversal-");

  await assert.rejects(
    () => writeWorkspaceManagedFileForPath(workspacePath, "../escape.md", "nope"),
    /outside the workspace|invalid/
  );
});

test("workspace managed file writes allow paths inside the workspace allowlist", async () => {
  const workspacePath = await makeWorkspace("agentos-path-inside-");
  const result = await writeWorkspaceManagedFileForPath(workspacePath, "docs/notes.md", "# Notes\n");

  assert.equal(result.file.path, "docs/notes.md");
  assert.equal(await readFile(path.join(workspacePath, "docs", "notes.md"), "utf8"), "# Notes\n");
});

test("workspace managed file writes reject symlink parent escapes", async () => {
  const workspacePath = await makeWorkspace("agentos-path-symlink-");
  const outsidePath = await makeWorkspace("agentos-path-outside-");
  await mkdir(path.join(workspacePath, "docs"), { recursive: true });
  await symlink(outsidePath, path.join(workspacePath, "docs", "linked"));

  await assert.rejects(
    () => writeWorkspaceManagedFileForPath(workspacePath, "docs/linked/notes.md", "# Escape\n"),
    /not a regular directory|resolves outside/
  );
  await assert.rejects(() => readFile(path.join(outsidePath, "notes.md"), "utf8"), /ENOENT/);
});

test("API middleware centrally covers mutation routes including Gateway auth", () => {
  const middlewareSource = readProjectFile("proxy.ts");

  assert.match(middlewareSource, /matcher:\s*\["\/api\/:path\*"\]/);
  assert.match(middlewareSource, /evaluateLocalOperatorRequest/);
});

test("OpenClaw CLI execution keeps argument-array spawn boundaries", () => {
  const cliSource = readProjectFile("lib/openclaw/cli.ts");
  const cliGatewaySource = readProjectFile("lib/openclaw/client/cli-gateway-client.ts");

  assert.match(cliSource, /spawn\([^,]+,\s*args,/);
  assert.doesNotMatch(cliSource, /shell:\s*true/);
  assert.match(cliGatewaySource, /containsRedactedOpenClawSecret\(value\)/);
});

test("Open Terminal only accepts OpenClaw command segments", () => {
  assert.equal(isOpenClawTerminalCommand("openclaw gateway status --json"), true);
  assert.equal(isOpenClawTerminalCommand("openclaw config set gateway.mode local && openclaw gateway restart --json"), true);
  assert.equal(isOpenClawTerminalCommand("openclaw gateway status --json && rm -rf ~/.openclaw"), false);
  assert.equal(isOpenClawTerminalCommand("openclaw gateway status --json; rm -rf ~/.openclaw"), false);
});

async function makeWorkspace(prefix: string) {
  const workspacePath = await mkdtemp(path.join(tmpdir(), prefix));
  await mkdir(workspacePath, { recursive: true });
  return workspacePath;
}

function readProjectFile(relativePath: string) {
  return readFileSync(path.join(rootDir, relativePath), "utf8");
}
