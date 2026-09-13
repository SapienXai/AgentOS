import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";

import {
  buildOpenClawChatGptLoginArgs,
  connectOpenClawChatGptProvider,
  cancelOpenClawChatGptBrowserAuth,
  extractOpenAiAuthorizationUrl,
  getOpenClawChatGptBrowserAuth,
  prepareChatGptProviderAuth,
  submitOpenClawChatGptBrowserAuth,
  startOpenClawChatGptBrowserAuth
} from "@/lib/openclaw/application/chatgpt-provider-auth-service";

test("ChatGPT provider auth extracts only the canonical OpenAI authorization URL", () => {
  const authorizationUrl = extractOpenAiAuthorizationUrl(
    "\u001b[32mOpen: https://auth.openai.com/oauth/authorize?client_id=test&state=state-123\u001b[0m"
  );

  assert.equal(
    authorizationUrl,
    "https://auth.openai.com/oauth/authorize?client_id=test&state=state-123"
  );
  assert.equal(
    extractOpenAiAuthorizationUrl("Open: https://example.com/oauth/authorize?state=state-123"),
    null
  );
  assert.equal(
    extractOpenAiAuthorizationUrl("Open: https://auth.openai.com.evil.example/oauth/authorize?state=state-123"),
    null
  );
  assert.equal(
    extractOpenAiAuthorizationUrl("Open: https://auth.openai.com/oauth/authorize?state=state-123#fragment"),
    null
  );
});

test("ChatGPT provider auth runs OpenClaw login directly when the Codex plugin is ready", async () => {
  const setupCalls: string[][] = [];
  const loginCalls: Array<{ agentId: string; force: boolean }> = [];

  const result = await connectOpenClawChatGptProvider(
    { force: true, agentId: "main" },
    {
      platform: "darwin",
      readPluginReady: async () => true,
      runSetupCommand: async (args) => {
        setupCalls.push(args);
      },
      runInteractiveLogin: async (input) => {
        loginCalls.push({ agentId: input.agentId, force: input.force });
      }
    }
  );

  assert.deepEqual(setupCalls, []);
  assert.deepEqual(loginCalls, [{ agentId: "main", force: true }]);
  assert.deepEqual(result, {
    pluginInstalled: false,
    authMode: "openclaw-cli-interactive"
  });
});

test("ChatGPT provider auth passes the configured system agent to OpenClaw", async () => {
  let loginAgentId: string | null = null;

  await connectOpenClawChatGptProvider(
    { force: true },
    {
      platform: "darwin",
      readPluginReady: async () => true,
      runSetupCommand: async () => {},
      resolveAuthAgentId: async () => "workspace-primary-operator",
      runInteractiveLogin: async (input) => {
        loginAgentId = input.agentId;
      }
    }
  );

  assert.equal(loginAgentId, "workspace-primary-operator");
});

test("ChatGPT provider auth fails closed when no agent owner is available", async () => {
  await assert.rejects(
    () => connectOpenClawChatGptProvider(
      { force: true },
      {
        platform: "darwin",
        readPluginReady: async () => true,
        runSetupCommand: async () => {},
        runInteractiveLogin: async () => {}
      }
    ),
    /explicit agent owner/
  );
});

test("ChatGPT provider auth passes the selected native agent to OpenClaw", async () => {
  let resolvedRequestedAgentId: string | undefined;
  let loginAgentId: string | null = null;

  await connectOpenClawChatGptProvider(
    { force: true, agentId: "workspace-primary-operator" },
    {
      platform: "darwin",
      readPluginReady: async () => true,
      runSetupCommand: async () => {},
      resolveAuthAgentId: async (requestedAgentId) => {
        resolvedRequestedAgentId = requestedAgentId;
        return requestedAgentId;
      },
      runInteractiveLogin: async (input) => {
        loginAgentId = input.agentId;
      }
    }
  );

  assert.equal(resolvedRequestedAgentId, "workspace-primary-operator");
  assert.equal(loginAgentId, "workspace-primary-operator");
});

test("ChatGPT provider auth builds an explicit, force-capable OpenClaw login command", () => {
  assert.deepEqual(
    buildOpenClawChatGptLoginArgs({ agentId: "main", force: true }),
    [
      "models",
      "auth",
      "login",
      "--provider",
      "openai",
      "--force",
      "--agent",
      "main",
      "--set-default"
    ]
  );
  assert.throws(
    () => buildOpenClawChatGptLoginArgs({ agentId: " ", force: false }),
    /explicit agent owner/
  );
});

test("ChatGPT provider auth installs the Codex plugin before login without device repair", async () => {
  const calls: string[] = [];

  const result = await connectOpenClawChatGptProvider(
    { agentId: "test-agent" },
    {
      platform: "darwin",
      readPluginReady: async () => false,
      runSetupCommand: async (args) => {
        calls.push(args.join(" "));
      },
      runInteractiveLogin: async (input) => {
        calls.push(`login force=${input.force}`);
      }
    }
  );

  assert.deepEqual(calls, [
    "plugins install --force --accept-capabilities @openclaw/codex",
    "gateway restart",
    "login force=false"
  ]);
  assert.equal(result.pluginInstalled, true);
});

test("ChatGPT OAuth preparation reaches the interactive login boundary with shared local auth", async () => {
  const calls: string[] = [];

  const pluginInstalled = await prepareChatGptProviderAuth({
    platform: "darwin",
    readPluginReady: async () => true,
    runSetupCommand: async () => {
      calls.push("setup");
    },
    runInteractiveLogin: async () => {
      calls.push("login");
    }
  });

  assert.equal(pluginInstalled, false);
  assert.deepEqual(calls, []);
});

test("failed plugin status read never triggers a reinstall or Gateway restart", async () => {
  let mutations = 0;
  let logins = 0;
  await connectOpenClawChatGptProvider({ agentId: "test-agent" }, {
    platform: "darwin",
    readPluginReady: async () => { throw new Error("Gateway unavailable"); },
    runSetupCommand: async () => { mutations += 1; },
    runInteractiveLogin: async () => { logins += 1; }
  });
  assert.equal(mutations, 0);
  assert.equal(logins, 1);
});

test("ChatGPT browser auth progresses from preparation to redirect wait and completion", async () => {
  const loginControl: { release?: () => void } = {};
  const authorizationUrl = "https://auth.openai.com/oauth/authorize?client_id=test&state=state-123";

  const started = await startOpenClawChatGptBrowserAuth(
    { force: true, agentId: "test-agent" },
    {
      platform: "darwin",
      readPluginReady: async () => true,
      runSetupCommand: async () => {},
      runInteractiveLogin: async ({ onBrowserUrl }) => {
        onBrowserUrl?.(authorizationUrl);
        await new Promise<void>((resolve) => {
          loginControl.release = resolve;
        });
      }
    }
  );

  assert.equal(started.state, "preparing");
  await delay(0);
  const waiting = getOpenClawChatGptBrowserAuth(started.sessionId);
  assert.equal(waiting.agentId, "test-agent");
  assert.equal(waiting.state, "waiting-for-redirect");
  assert.equal(waiting.browserUrl, authorizationUrl);

  const release = loginControl.release;
  if (!release) {
    throw new Error("The test login session did not reach the redirect wait state.");
  }
  release();
  await delay(0);
  assert.equal(getOpenClawChatGptBrowserAuth(started.sessionId).state, "completed");
});

test("OpenClaw browser URL output is observed without a second AgentOS browser open", async () => {
  const observedUrls: string[] = [];
  const authorizationUrl = "https://auth.openai.com/oauth/authorize?client_id=fixture&state=state-123";
  const started = await startOpenClawChatGptBrowserAuth(
    { agentId: "test-agent" },
    {
      platform: "darwin",
      readPluginReady: async () => true,
      runSetupCommand: async () => {},
      runInteractiveLogin: async ({ onBrowserUrl }) => {
        onBrowserUrl?.(authorizationUrl);
        observedUrls.push(authorizationUrl);
      }
    }
  );

  await delay(0);
  const snapshot = getOpenClawChatGptBrowserAuth(started.sessionId);
  assert.deepEqual(observedUrls, [authorizationUrl]);
  assert.equal(snapshot.browserUrl, authorizationUrl);
  assert.equal(snapshot.state, "completed");
});

test("explicit ChatGPT retry aborts the previous session before starting another", async () => {
  const firstLogin = { aborted: false, release: undefined as (() => void) | undefined };
  let loginCount = 0;
  const dependencies = {
    platform: "darwin" as const,
    readPluginReady: async () => true,
    runSetupCommand: async () => {},
    runInteractiveLogin: async ({ signal }: { signal?: AbortSignal }) => {
      loginCount += 1;
      if (loginCount === 1) {
        await new Promise<void>((resolve) => {
          firstLogin.release = resolve;
          signal?.addEventListener("abort", () => {
            firstLogin.aborted = true;
            resolve();
          }, { once: true });
        });
        return;
      }
    }
  };

  const first = await startOpenClawChatGptBrowserAuth({ agentId: "test-agent" }, dependencies);
  await delay(0);
  const second = await startOpenClawChatGptBrowserAuth({ force: true, agentId: "test-agent" }, dependencies);
  await delay(0);

  assert.equal(firstLogin.aborted, true);
  assert.notEqual(first.sessionId, second.sessionId);
  assert.equal(loginCount, 2);
  firstLogin.release?.();
  await cancelOpenClawChatGptBrowserAuth(second.sessionId);
});

test("different-agent ChatGPT auth starts fail with an explicit ownership conflict", async () => {
  let release: (() => void) | undefined;
  const dependencies = {
    platform: "darwin" as const,
    readPluginReady: async () => true,
    runSetupCommand: async () => {},
    resolveAuthAgentId: async (requestedAgentId?: string) => requestedAgentId,
    runInteractiveLogin: async ({ signal }: { signal?: AbortSignal }) => {
      await new Promise<void>((resolve) => {
        release = resolve;
        signal?.addEventListener("abort", () => resolve(), { once: true });
      });
    }
  };

  const first = await startOpenClawChatGptBrowserAuth({ agentId: "agent-a" }, dependencies);
  await delay(0);

  await assert.rejects(
    () => startOpenClawChatGptBrowserAuth({ agentId: "agent-b" }, dependencies),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, "chatgpt-auth-session-conflict");
      assert.match(String(error), /agent-a/);
      assert.match(String(error), /agent-b/);
      return true;
    }
  );
  assert.equal(getOpenClawChatGptBrowserAuth(first.sessionId).agentId, "agent-a");

  release?.();
  await cancelOpenClawChatGptBrowserAuth(first.sessionId);
});

test("forced ChatGPT auth switch cancels the previous agent-owned session deterministically", async () => {
  const firstLogin = { aborted: false };
  let loginCount = 0;
  const dependencies = {
    platform: "darwin" as const,
    readPluginReady: async () => true,
    runSetupCommand: async () => {},
    resolveAuthAgentId: async (requestedAgentId?: string) => requestedAgentId,
    runInteractiveLogin: async ({ signal }: { signal?: AbortSignal }) => {
      loginCount += 1;
      if (loginCount === 1) {
        await new Promise<void>((resolve) => {
          signal?.addEventListener("abort", () => {
            firstLogin.aborted = true;
            resolve();
          }, { once: true });
        });
      }
    }
  };

  await startOpenClawChatGptBrowserAuth({ agentId: "agent-a" }, dependencies);
  await delay(0);
  const second = await startOpenClawChatGptBrowserAuth({ force: true, agentId: "agent-b" }, dependencies);
  await delay(0);

  assert.equal(firstLogin.aborted, true);
  assert.equal(loginCount, 2);
  assert.equal(getOpenClawChatGptBrowserAuth(second.sessionId).agentId, "agent-b");
  await cancelOpenClawChatGptBrowserAuth(second.sessionId);
});

test("ChatGPT cancellation waits for the interactive child boundary to finish", async () => {
  let releaseChild: (() => void) | undefined;
  let abortObserved = false;
  const dependencies = {
    platform: "darwin" as const,
    readPluginReady: async () => true,
    runSetupCommand: async () => {},
    resolveAuthAgentId: async (requestedAgentId?: string) => requestedAgentId,
    runInteractiveLogin: async ({ signal }: { signal?: AbortSignal }) => {
      await new Promise<void>((resolve) => {
        releaseChild = resolve;
        signal?.addEventListener("abort", () => {
          abortObserved = true;
          setTimeout(resolve, 20);
        }, { once: true });
      });
    }
  };

  const started = await startOpenClawChatGptBrowserAuth({ agentId: "agent-a" }, dependencies);
  await delay(0);
  let cancelled = false;
  const cancellation = cancelOpenClawChatGptBrowserAuth(started.sessionId).then(() => {
    cancelled = true;
  });

  await delay(0);
  assert.equal(abortObserved, true);
  assert.equal(cancelled, false);
  releaseChild?.();
  await cancellation;
  assert.equal(cancelled, true);
  assert.throws(
    () => getOpenClawChatGptBrowserAuth(started.sessionId),
    (error: unknown) => (error as { code?: string }).code === "chatgpt-auth-session-not-found"
  );
});

test("completed ChatGPT auth sessions reject stale redirect input", async () => {
  const authorizationUrl = "https://auth.openai.com/oauth/authorize?client_id=complete&state=state-123";
  const started = await startOpenClawChatGptBrowserAuth(
    { agentId: "agent-a" },
    {
      platform: "darwin",
      readPluginReady: async () => true,
      runSetupCommand: async () => {},
      runInteractiveLogin: async ({ onBrowserUrl }) => {
        onBrowserUrl?.(authorizationUrl);
      }
    }
  );

  await delay(0);
  assert.throws(
    () => submitOpenClawChatGptBrowserAuth({
      sessionId: started.sessionId,
      redirectUrl: "http://127.0.0.1:1455/auth/callback?code=stale&state=stale"
    }),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, "chatgpt-auth-session-complete");
      return true;
    }
  );
});

test("invalid ChatGPT agent ownership fails closed before a session is created", async () => {
  await assert.rejects(
    () => startOpenClawChatGptBrowserAuth(
      { agentId: "missing-agent" },
      {
        platform: "darwin",
        readPluginReady: async () => true,
        runSetupCommand: async () => {},
        resolveAuthAgentId: async () => null,
        runInteractiveLogin: async () => {}
      }
    ),
    /explicit agent owner/
  );
});

test("concurrent starts share one child and cancellation waits for child completion", async () => {
  let loginCount = 0;
  let release: (() => void) | undefined;
  const dependencies = {
    platform: "darwin" as const,
    readPluginReady: async () => true,
    runSetupCommand: async () => {},
    runInteractiveLogin: async () => {
      loginCount += 1;
      if (loginCount === 1) await new Promise<void>((resolve) => { release = resolve; });
    }
  };
  const [first, duplicate] = await Promise.all([
    startOpenClawChatGptBrowserAuth({ agentId: "test-agent" }, dependencies),
    startOpenClawChatGptBrowserAuth({ agentId: "test-agent" }, dependencies)
  ]);
  assert.equal(first.sessionId, duplicate.sessionId);
  assert.equal(loginCount, 1);
  cancelOpenClawChatGptBrowserAuth(first.sessionId);
  const next = startOpenClawChatGptBrowserAuth({ agentId: "test-agent" }, dependencies);
  await delay(0);
  assert.equal(loginCount, 1);
  release?.();
  await next;
  await delay(0);
  assert.equal(loginCount, 2);
});

test("ChatGPT browser auth preserves a recoverable preparation failure", async () => {
  const started = await startOpenClawChatGptBrowserAuth(
    { force: true, agentId: "test-agent" },
    {
      platform: "darwin",
      readPluginReady: async () => false,
      runSetupCommand: async () => {
        throw new Error("Codex plugin install failed");
      },
      runInteractiveLogin: async () => {
        throw new Error("interactive login should not start");
      }
    }
  );

  await delay(0);
  const failed = getOpenClawChatGptBrowserAuth(started.sessionId);
  assert.equal(failed.state, "error");
  assert.match(failed.error ?? "", /Codex plugin install failed/);
});

test("ChatGPT provider auth fails honestly when in-app OAuth is unavailable", async () => {
  await assert.rejects(
    () => connectOpenClawChatGptProvider(
      {},
      {
        platform: "linux",
        readPluginReady: async () => true,
        runSetupCommand: async () => {},
        runInteractiveLogin: async () => {}
      }
    ),
    /requires local AgentOS on macOS/
  );
});
