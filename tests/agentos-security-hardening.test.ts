import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { NextRequest } from "next/server";

import { evaluateAgentOsApiRequest } from "@/lib/security/api-auth";
import { evaluateLocalOperatorRequest } from "@/lib/security/local-operator";
import { REDACTED_SECRET_VALUE, redactSecrets } from "@/lib/security/redaction";
import { assertExecutableOpenClawBinary } from "@/lib/openclaw/binary-selection";
import { saveGatewayNativeAuthCredential } from "@/lib/openclaw/application/settings-service";
import { writeWorkspaceManagedFileForPath } from "@/lib/openclaw/application/workspace-file-service";
import { normalizeGatewayRemoteUrl } from "@/lib/openclaw/domains/control-plane-settings";
import { assertSafeWorkspaceCloneRepoUrl } from "@/lib/openclaw/domains/workspace-bootstrap";
import { sanitizeOpenClawCommandArgsForDiagnostics } from "@/lib/openclaw/cli";
import { isOpenClawTerminalCommand } from "@/lib/openclaw/terminal-command";
import { proxy } from "@/proxy";

const rootDir = process.cwd();

async function withProcessEnv(
  env: Partial<
    Record<"AGENTOS_API_TOKEN" | "AGENTOS_PACKAGE_RUNTIME" | "AGENTOS_UNSAFE_DISABLE_API_AUTH" | "NODE_ENV", string | undefined>
  >,
  callback: () => Promise<void> | void
) {
  const previous = {
    AGENTOS_API_TOKEN: process.env.AGENTOS_API_TOKEN,
    AGENTOS_PACKAGE_RUNTIME: process.env.AGENTOS_PACKAGE_RUNTIME,
    AGENTOS_UNSAFE_DISABLE_API_AUTH: process.env.AGENTOS_UNSAFE_DISABLE_API_AUTH,
    NODE_ENV: process.env.NODE_ENV
  };

  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    await callback();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

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

test("forwarded loopback mutation requests are allowed", () => {
  const decision = evaluateLocalOperatorRequest({
    method: "POST",
    url: "http://127.0.0.1:3000/api/onboarding",
    headers: new Headers({
      host: "127.0.0.1:3000",
      origin: "http://127.0.0.1:3000",
      "x-forwarded-for": "::ffff:127.0.0.1"
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

test("API auth blocks safe reads when a bearer token is configured", () => {
  const missing = evaluateAgentOsApiRequest({
    method: "GET",
    url: "http://localhost:3000/api/snapshot",
    headers: new Headers({
      host: "localhost:3000"
    }),
    env: {
      AGENTOS_API_TOKEN: "local-secret",
      NODE_ENV: "production"
    }
  });

  assert.equal(missing.ok, false);
  assert.equal(missing.ok ? null : missing.status, 401);

  const authorized = evaluateAgentOsApiRequest({
    method: "GET",
    url: "http://localhost:3000/api/snapshot",
    headers: new Headers({
      authorization: "Bearer local-secret",
      host: "localhost:3000"
    }),
    env: {
      AGENTOS_API_TOKEN: "local-secret",
      NODE_ENV: "production"
    }
  });

  assert.deepEqual(authorized, { ok: true });
});

test("explicit repository auth opt-out allows local API calls without a token", () => {
  const decision = evaluateAgentOsApiRequest({
    method: "POST",
    url: "http://localhost:3000/api/mission",
    headers: new Headers({
      host: "localhost:3000",
      origin: "http://localhost:3000"
    }),
    env: {
      AGENTOS_API_TOKEN: "local-secret",
      AGENTOS_UNSAFE_DISABLE_API_AUTH: "1",
      NODE_ENV: "production"
    }
  });

  assert.deepEqual(decision, { ok: true });
});

test("explicit repository auth opt-out still blocks forwarded remote clients", () => {
  const decision = evaluateAgentOsApiRequest({
    method: "POST",
    url: "http://localhost:3000/api/mission",
    headers: new Headers({
      host: "localhost:3000",
      origin: "http://localhost:3000",
      "x-forwarded-for": "203.0.113.10"
    }),
    env: {
      AGENTOS_UNSAFE_DISABLE_API_AUTH: "1",
      NODE_ENV: "production"
    }
  });

  assert.equal(decision.ok, false);
  assert.equal(decision.ok ? null : decision.code, "unsafe-local-api");
});

test("packaged runtime ignores explicit repository auth opt-out", () => {
  const missing = evaluateAgentOsApiRequest({
    method: "GET",
    url: "http://localhost:3000/api/snapshot",
    headers: new Headers({
      host: "localhost:3000"
    }),
    env: {
      AGENTOS_API_TOKEN: "local-secret",
      AGENTOS_PACKAGE_RUNTIME: "1",
      AGENTOS_UNSAFE_DISABLE_API_AUTH: "1",
      NODE_ENV: "production"
    }
  });

  assert.equal(missing.ok, false);
  assert.equal(missing.ok ? null : missing.code, "api-auth-required");
});

test("API auth development fallback blocks non-local read routes", () => {
  const decision = evaluateAgentOsApiRequest({
    method: "GET",
    url: "https://agentos.example.com/api/snapshot",
    headers: new Headers({
      host: "agentos.example.com"
    }),
    env: {
      NODE_ENV: "development"
    }
  });

  assert.equal(decision.ok, false);
  assert.equal(decision.ok ? null : decision.code, "unsafe-local-api");
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
    budget: {
      tokens: 128,
      nested: {
        tokens: null
      }
    },
    authStore: {
      tokens: {
        operator: {
          token: "nested-secret-token"
        }
      }
    },
    nested: [
      {
        privateKey: "top-secret-private-key",
        issue: 'Authorization: Bearer bearer-secret\nOPENAI_API_KEY="sk-secret"'
      }
    ]
  });
  const serialized = JSON.stringify(redacted);

  assert.doesNotMatch(serialized, /top-secret|nested-secret|bearer-secret|sk-secret|query-secret|json-secret|client-secret/);
  assert.match(serialized, new RegExp(REDACTED_SECRET_VALUE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.deepEqual(redacted.tokenUsage, { total: 42 });
  assert.deepEqual(redacted.budget, { tokens: 128, nested: { tokens: null } });
  assert.deepEqual(redacted.authStore, { tokens: { operator: { token: REDACTED_SECRET_VALUE } } });
});

test("secret redaction preserves repeated safe references while cutting cycles", () => {
  const tools = ["browser", "web_search"];
  const skills = ["project-browser"];
  const circularObject: Record<string, unknown> = { label: "root" };
  circularObject.self = circularObject;
  const circularArray: unknown[] = ["first"];
  circularArray.push(circularArray);

  const redacted = redactSecrets({
    policy: {
      declaredTools: tools,
      effectiveTools: tools,
      declaredSkills: skills,
      effectiveSkills: skills
    },
    repeated: {
      tools
    },
    circularObject,
    circularArray
  });

  assert.deepEqual(redacted.policy.declaredTools, tools);
  assert.deepEqual(redacted.policy.effectiveTools, tools);
  assert.deepEqual(redacted.policy.declaredSkills, skills);
  assert.deepEqual(redacted.policy.effectiveSkills, skills);
  assert.deepEqual(redacted.repeated.tools, tools);
  assert.deepEqual(redacted.circularObject, { label: "root", self: {} });
  assert.deepEqual(redacted.circularArray, ["first", []]);
});

test("OpenClaw command diagnostics redact sensitive config values", () => {
  assert.deepEqual(
    sanitizeOpenClawCommandArgsForDiagnostics([
      "config",
      "set",
      "gateway.auth.token",
      "plain-secret-token"
    ]),
    ["config", "set", "gateway.auth.token", "[redacted]"]
  );
  assert.deepEqual(
    sanitizeOpenClawCommandArgsForDiagnostics([
      "config",
      "set",
      "gateway.auth.password=plain-secret-password"
    ]),
    ["config", "set", "gateway.auth.password=[redacted]"]
  );
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

test("workspace clone URLs reject git transport and argument injection forms", () => {
  assert.doesNotThrow(() => assertSafeWorkspaceCloneRepoUrl("https://github.com/SapienXai/AgentOS.git"));
  assert.doesNotThrow(() => assertSafeWorkspaceCloneRepoUrl("ssh://git@github.com/SapienXai/AgentOS.git"));
  assert.doesNotThrow(() => assertSafeWorkspaceCloneRepoUrl("git@github.com:SapienXai/AgentOS.git"));

  assert.throws(() => assertSafeWorkspaceCloneRepoUrl("ext::sh -c touch /tmp/agentos-pwned"), /https/);
  assert.throws(() => assertSafeWorkspaceCloneRepoUrl("file:///tmp/repo"), /https/);
  assert.throws(() => assertSafeWorkspaceCloneRepoUrl("--upload-pack=/tmp/evil"), /dash/);
});

test("workspace clone command separates git options from repository URL", () => {
  const source = readProjectFile("lib/openclaw/domains/workspace-bootstrap.ts");

  assert.match(source, /runSystemCommand\("git", \["clone", "--", repoUrl, params\.targetDir\]\)/);
});

test("OpenClaw binary selection rejects non-OpenClaw executable names", async () => {
  await assert.rejects(() => assertExecutableOpenClawBinary("/bin/sh"), /named openclaw/);
});

test("gateway remote URL defaults to loopback targets only", () => {
  const previous = process.env.AGENTOS_ALLOW_REMOTE_GATEWAY_URL;

  try {
    delete process.env.AGENTOS_ALLOW_REMOTE_GATEWAY_URL;
    assert.equal(normalizeGatewayRemoteUrl("127.0.0.1:18789"), "ws://127.0.0.1:18789");
    assert.equal(normalizeGatewayRemoteUrl("ws://localhost:18789/"), "ws://localhost:18789");
    assert.throws(() => normalizeGatewayRemoteUrl("ws://example.com:18789"), /localhost/);
  } finally {
    if (previous === undefined) {
      delete process.env.AGENTOS_ALLOW_REMOTE_GATEWAY_URL;
    } else {
      process.env.AGENTOS_ALLOW_REMOTE_GATEWAY_URL = previous;
    }
  }
});

test("source gateway credential files are written owner-only", async () => {
  const cwd = await makeWorkspace("agentos-gateway-credential-");
  const previousToken = process.env.AGENTOS_OPENCLAW_GATEWAY_TOKEN;
  const previousPassword = process.env.AGENTOS_OPENCLAW_GATEWAY_PASSWORD;

  try {
    await saveGatewayNativeAuthCredential({
      kind: "token",
      value: "local-test-token",
      cwd
    });

    const mode = (await stat(path.join(cwd, ".env.local"))).mode & 0o777;
    assert.equal(mode, 0o600);
  } finally {
    if (previousToken === undefined) {
      delete process.env.AGENTOS_OPENCLAW_GATEWAY_TOKEN;
    } else {
      process.env.AGENTOS_OPENCLAW_GATEWAY_TOKEN = previousToken;
    }

    if (previousPassword === undefined) {
      delete process.env.AGENTOS_OPENCLAW_GATEWAY_PASSWORD;
    } else {
      process.env.AGENTOS_OPENCLAW_GATEWAY_PASSWORD = previousPassword;
    }
  }
});

test("API middleware centrally covers mutation routes including Gateway auth", () => {
  const middlewareSource = readProjectFile("proxy.ts");

  assert.match(middlewareSource, /matcher:\s*\["\/api\/:path\*"\]/);
  assert.match(middlewareSource, /evaluateAgentOsApiRequest/);
});

test("API proxy protects snapshot reads with bearer auth in production-like env", async () => {
  await withProcessEnv({ AGENTOS_API_TOKEN: "local-secret", NODE_ENV: "production" }, async () => {
    const missingToken = proxy(new NextRequest("http://localhost:3000/api/snapshot", {
      headers: {
        host: "localhost:3000"
      }
    }));
    const missingTokenBody = await missingToken.json();

    assert.equal(missingToken.status, 401);
    assert.equal(missingTokenBody.code, "api-auth-required");

    const authorized = proxy(new NextRequest("http://localhost:3000/api/snapshot", {
      headers: {
        authorization: "Bearer local-secret",
        host: "localhost:3000"
      }
    }));

    assert.equal(authorized.status, 200);
  });
});

test("API proxy protects mutation routes with bearer auth in production-like env", async () => {
  await withProcessEnv({ AGENTOS_API_TOKEN: "local-secret", NODE_ENV: "production" }, async () => {
    const missingToken = proxy(new NextRequest("http://localhost:3000/api/mission", {
      method: "POST",
      headers: {
        host: "localhost:3000",
        origin: "http://localhost:3000"
      }
    }));
    const missingTokenBody = await missingToken.json();

    assert.equal(missingToken.status, 401);
    assert.equal(missingTokenBody.code, "api-auth-required");

    const authorized = proxy(new NextRequest("http://localhost:3000/api/settings/gateway", {
      method: "POST",
      headers: {
        authorization: "Bearer local-secret",
        host: "localhost:3000",
        origin: "http://localhost:3000"
      }
    }));

    assert.equal(authorized.status, 200);
  });
});

test("API proxy blocks remote clients under local development fallback", async () => {
  await withProcessEnv({ AGENTOS_API_TOKEN: undefined, NODE_ENV: "development" }, async () => {
    const response = proxy(new NextRequest("http://localhost:3000/api/snapshot", {
      headers: {
        host: "localhost:3000",
        "x-forwarded-for": "203.0.113.10"
      }
    }));
    const body = await response.json();

    assert.equal(response.status, 403);
    assert.equal(body.code, "unsafe-local-api");
  });
});

test("packaged launcher provisions API tokens outside source config", () => {
  const launcherSource = readProjectFile("packages/agentos/bin/agentos.js");

  assert.match(launcherSource, /const apiTokenPath = path\.join\(runtimeInstallRoot, "api-token"\)/);
  assert.match(launcherSource, /AGENTOS_API_TOKEN: apiToken/);
  assert.match(launcherSource, /mode: 0o600/);
  assert.match(launcherSource, /agentos_token/);
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
