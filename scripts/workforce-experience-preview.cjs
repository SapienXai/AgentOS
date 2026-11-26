const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const { mkdir, mkdtemp, rm, writeFile } = require("node:fs/promises");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const repo = process.cwd();
const { chromium, expect } = require(repo + "/node_modules/@playwright/test");
const { createOpenClawRuntimeProviderFixture } = require(repo + "/scripts/openclaw-runtime-provider-fixture.ts");
const packageRoot = process.env.WORKFORCE_OPENCLAW_PACKAGE;
const standalone = process.env.WORKFORCE_STANDALONE_DIR;
assert(packageRoot, "Set WORKFORCE_OPENCLAW_PACKAGE to the exact OpenClaw 2026.11.10 package root.");
assert.equal(require(path.resolve(packageRoot, "package.json")).version, "2026.11.10");
const openclaw = path.resolve(packageRoot, "openclaw.mjs");
const serve = process.argv.includes("--serve");
const baseline = process.argv.includes("--baseline");
const matchedCanvas = process.argv.includes("--matched-canvas");
const connect = process.argv.includes("--connect");
const verifyNativeKnowledge = process.argv.includes("--native-knowledge");
const suggested = process.argv.includes("--suggested");
const fresh = connect || suggested || process.argv.includes("--fresh");
const { enableInstanceProtection, loginToInstance, INSTANCE_PROTECTION_COOKIE } = require(repo + "/lib/security/instance-protection.ts");
const { createManagedAgentOsUser, updateManagedAgentOsUserRole, updateManagedAgentOsUserStatus } = require(repo + "/lib/agentos/application/agentos-account-service.ts");
const next = require.resolve(repo + "/node_modules/next/dist/bin/next");
const { createOfficialBackedOpenClawGatewayClient } = require(repo + "/lib/openclaw/client/official-gateway-factory.ts");
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function port() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const value = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return value;
}
async function ready(url, process) {
  for (let i = 0; i < 100; i++) {
    if (process.exitCode !== null) throw Error("Fixture process exited before " + url);
    try { if ((await fetch(url, {signal: AbortSignal.timeout(500)})).ok) return; } catch {}
    await wait(300);
  }
  throw Error("Fixture readiness timeout: " + url);
}
async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const stopped = new Promise(resolve => child.once("exit", resolve));
  child.kill("SIGTERM");
  const kill = setTimeout(() => child.kill("SIGKILL"), 2500);
  await stopped;
  clearTimeout(kill);
}

async function run() {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentos-workforce-fixture-"));
  const children = [];
  const fixture = await createOpenClawRuntimeProviderFixture();
  let browser;
  let nativeClient;
  try {
    const [gatewayPort, appPort] = await Promise.all([port(), port()]);
    const token = randomUUID();
    const appToken = randomUUID();
    const gatewayUrl = "ws://127.0.0.1:" + gatewayPort;
    const base = "http://127.0.0.1:" + appPort;
    const state = path.join(root, "openclaw");
    const config = path.join(root, "openclaw.json");
    const mainWorkspace = fresh ? path.join(state, "workspace") : path.join(root, "main");
    const defaultModel = "agentos-fixture/" + fixture.modelId;
    await mkdir(state);
    await mkdir(mainWorkspace, { recursive: true });
    await writeFile(path.join(mainWorkspace, "AGENTS.md"), "# Fixture instructions\nUse the isolated sample workspace only.\n");
    if (fresh && !connect) {
      const authDir = path.join(state, "agents", "main", "agent");
      await mkdir(authDir, { recursive: true });
      await writeFile(path.join(authDir, "auth-profiles.json"), JSON.stringify({
        version: 1,
        profiles: { "agentos-fixture:preview": { type: "api_key", provider: "agentos-fixture", key: "fixture-only" } }
      }), { mode: 0o600 });
    }
    await writeFile(config, JSON.stringify({
      gateway: { mode: "local", bind: "loopback", auth: { mode: "token", token } },
      ...(connect ? {} : { models: { mode: "merge", providers: { "agentos-fixture": { baseUrl: fixture.baseUrl, api: "openai-completions", apiKey: "fixture-only", models: [{ id: fixture.modelId, name: "Fixture model", input: ["text"], contextWindow: 32768, maxTokens: 256 }] } } } }),
      ...(verifyNativeKnowledge ? { memory: { search: {
        provider: "openai", model: "text-embedding-3-small", fallback: "none",
        remote: { baseUrl: fixture.baseUrl, apiKey: "fixture-only" }
      } } } : {}),
      agents: { ownership: "explicit", defaults: { systemAgent: {agentId:"main"}, ...(!connect ? { model: { primary:defaultModel } } : {}) }, entries: { main: { name: "System assistant", workspace: mainWorkspace } } }
    }), {mode:0o600});
    const env = {
      PATH: process.env.PATH, HOME: root, USERPROFILE: root, TMPDIR: root, NODE_ENV: "production",
      OPENCLAW_CONFIG_PATH: config, OPENCLAW_STATE_DIR: state, OPENCLAW_GATEWAY_TOKEN: token, OPENCLAW_GATEWAY_PORT: String(gatewayPort), OPENCLAW_BIN: openclaw,
      AGENTOS_OPENCLAW_GATEWAY_URL: gatewayUrl, AGENTOS_OPENCLAW_GATEWAY_TOKEN: token, AGENTOS_RUNTIME_DIR: path.join(root, "agentos"),
      AGENTOS_MISSION_CONTROL_ROOT: path.join(root, "mission-control"), AGENTOS_API_TOKEN: appToken
    };
    function start(args, overrides = {}) {
      const child = spawn(process.execPath, args, { env: { ...env, ...overrides }, cwd: repo, stdio:["ignore","pipe","pipe"] });
      let logs = "";
      for (const stream of [child.stdout,child.stderr]) stream.on("data", chunk => { logs = (logs + chunk).replaceAll(token,"[REDACTED]").replaceAll(appToken,"[REDACTED]").slice(-3000); });
      child.diagnostic = () => logs;
      children.push(child);
      return child;
    }
    if (suggested) {
      // Seeded auth-profiles.json is a disposable migration input. The pinned
      // OpenClaw owns conversion to its current native credential store.
      const doctor = start([openclaw,"doctor","--repair","--non-interactive","--no-workspace-suggestions"]);
      const status = await new Promise((resolve, reject) => {
        doctor.once("error", reject);
        doctor.once("exit", resolve);
      });
      assert.equal(status, 0, "OpenClaw could not migrate the fixture provider.");
    }
    const owner = await enableInstanceProtection({ username: "fixture-owner", password: process.env.WORKFORCE_PREVIEW_PASSWORD || randomUUID() }, env);
    const cookie = INSTANCE_PROTECTION_COOKIE + "=" + owner.session;
    const launchGateway = () => start([openclaw,"gateway","run","--port",String(gatewayPort),"--allow-unconfigured"]);
    let gw = launchGateway();
    await ready("http://127.0.0.1:" + gatewayPort + "/healthz", gw);
    const launchApp = () => standalone
      ? start([path.resolve(standalone, "server.js")], { PORT: String(appPort), HOSTNAME: "127.0.0.1" })
      : start([next,"start","--hostname","127.0.0.1","--port",String(appPort)]);
    let app = launchApp();
    await ready(base + "/api/auth/status", app);
    const headers = { Cookie: cookie, "Content-Type":"application/json", Origin: base };
    async function createWorkspace(name, specs) {
      const response = await fetch(base + "/api/workspaces", { method:"POST", headers, body:JSON.stringify({
        name, brief: "Coordinate a small studio that publishes research and editorial work.", sourceMode:"empty", modelId:defaultModel, teamPreset:"custom",
        creation:{source:"api",idempotencyKey:"evidence-" + name.toLowerCase().replaceAll(" ","-")},
        rules:{workspaceOnly:true,generateStarterDocs:true,generateMemory:true,kickoffMission:false},
        agents:specs.map(([id,role,label], i)=>({ id,role,name:label,enabled:true,isPrimary:i===0 }))
      }) });
      const json = await response.json();
      assert(response.ok, JSON.stringify({status:response.status,error:json.error}));
      return json;
    }
    let first = null;
    if (!fresh) first = await createWorkspace("Fieldwork Studio", [["ada","Assistant","Ada"],["ellis","Researcher","Ellis"],["mira","Editor","Mira"]]);
    if (first) await createWorkspace("Northline Press", [["sam","Assistant","Sam"]]);
    const snap = await (await fetch(base+"/api/snapshot?force=true", {headers})).json();
    if (fresh && process.env.WORKFORCE_FIXTURE_DEBUG === "1") console.log(JSON.stringify({
      mode: snap.mode, installed: snap.diagnostics.installed, rpcOk: snap.diagnostics.rpcOk,
      stateWritable: snap.diagnostics.runtime.stateWritable, sessionStoreWritable: snap.diagnostics.runtime.sessionStoreWritable,
      modelReady: snap.diagnostics.modelReadiness,
      models: snap.models.filter(model => model.provider === "agentos-fixture").map(model => ({ id: model.id, available: model.available, missing: model.missing, authenticated: model.auth?.configured })) ,
      stateRoot: snap.diagnostics.runtime.stateRoot, workspaces: snap.workspaces.map(({ id, path, bootstrap }) => ({ id, path, template: bootstrap.template }))
    }));
    const scopeKey = "mission-control-active-workspace-id:" + snap.diagnostics.workspaceRoot;
    const worker = first ? snap.agents.find(agent => agent.workspaceId === first.workspaceId) : null;
    function connectNative() {
      return createOfficialBackedOpenClawGatewayClient({ url: gatewayUrl, token, role: "operator",
        scopes: ["operator.admin", "operator.read", "operator.write"], timeoutMs: 10000,
        clientName: "gateway-client", sharedStateMode: "read-only" });
    }
    let taskId = null;
    if (worker) {
      const task = await fetch(base + "/api/mission", {method:"POST", headers, body:JSON.stringify({
        mission:"Draft a short research brief for the studio.", workspaceId:first.workspaceId, agentId:worker.id, requestId:"workforce-preview-research"
      })});
      const result = await task.json();
      assert(task.ok && result.dispatchId, `Fixture task admission failed (${task.status}).`);
      taskId = result.dispatchId;
    }
    console.log(first ? "Disposable fixture: Fieldwork Studio and Northline Press." : "Disposable fixture: no company workspaces.");
    browser = await chromium.launch({ headless: !serve });
    if (serve) {
      const context = await browser.newContext();
      await context.addCookies([{ name: INSTANCE_PROTECTION_COOKIE, value: owner.session, url: base }]);
      await context.addInitScript(({ scopeKey, workspaceId }) => {
        if (workspaceId && !sessionStorage.getItem(scopeKey)) sessionStorage.setItem(scopeKey, workspaceId);
      }, { scopeKey, workspaceId: first?.workspaceId });
      await (await context.newPage()).goto(base);
      console.log(`AgentOS isolated preview: ${base}`);
      console.log("Stop the preview with Ctrl+C or by closing its browser.");
      await new Promise(resolve => {
        browser.once("disconnected", resolve);
        process.once("SIGINT", resolve);
        process.once("SIGTERM", resolve);
      });
      return;
    }
    const output = process.env.WORKFORCE_EVIDENCE || await mkdtemp(path.join(os.tmpdir(), "agentos-workforce-evidence-"));
    await mkdir(output, { recursive: true });
    const report = [];
    let completedConversation = false;
    const requestedWidths = process.env.WORKFORCE_VIEWPORTS?.split(",").map(Number);
    const stageSizes = [{width:1440,height:900}, {width:1280,height:800}, {width:820,height:1180}, {width:844,height:390},
      {width:390,height:baseline && matchedCanvas ? 788 : 844}, {width:360,height:800}]
      .filter(size => requestedWidths || ![820, 844].includes(size.width))
      .filter(size => !requestedWidths || requestedWidths.includes(size.width));
    for (const theme of ["dark", "light"]) {
      for (const size of stageSizes) {
        const context = await browser.newContext({
          viewport: size, deviceScaleFactor: 1, colorScheme: theme, reducedMotion: "reduce",
          isMobile: size.width < 600, hasTouch: size.width < 600
        });
        const key = theme + "-" + size.width;
        await context.addCookies([{ name: INSTANCE_PROTECTION_COOKIE, value: owner.session, url: base }]);
        await context.addInitScript(({ theme, scopeKey, workspaceId }) => {
          localStorage.setItem("mission-control-surface-theme", theme);
          if (workspaceId && !sessionStorage.getItem(scopeKey)) sessionStorage.setItem(scopeKey, workspaceId);
        }, { theme, scopeKey, workspaceId: first?.workspaceId });
        const page = await context.newPage();
        const timings = {};
        const screenshot = name => page.screenshot({ path: path.join(output, key + "-" + name + ".jpg"), type: "jpeg", quality: 82, animations: "disabled" });
        const record = async (name, runCheck) => {
          try {
            await runCheck();
            const viewportFits = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
            assert(viewportFits, "Page has horizontal overflow.");
            await screenshot(name);
            report.push({ theme, viewport: size, name, result: "PASS", ...(Number.isFinite(timings[name]) ? { usableMs: timings[name] } : {}) });
          } catch (error) {
            const problem = error.message.split("\n").slice(0, 6).join("\n");
            report.push({ theme, viewport: size, name, result: "FAIL", problem });
            console.error(`${key} ${name}: ${problem}`);
            await screenshot(name + "-failed").catch(() => {});
          }
        };
        const go = async route => {
          const response = await page.goto(base + route, { waitUntil: "domcontentloaded" });
          assert(response?.ok() || (!response && route.includes("#")), `Route ${route} returned ${response?.status()}.`);
        };

        if (connect) {
          await record("connect-ai", async () => {
            await go("/");
            const connectButton = page.getByRole("button", {name:"Connect your AI", exact:true});
            await connectButton.waitFor({ timeout: 5000 }).then(() => connectButton.click(), () => undefined);
            await expect(page.getByRole("list", { name: "Onboarding progress" })).toBeVisible({ timeout: 20000 });
          });
          await record("provider-choice", async () => {
            await expect(page.getByRole("button", { name: "Other AI providers" })).toBeVisible({timeout: 10000});
            await page.getByRole("button", { name: "Other AI providers" }).click();
            await expect(page.getByRole("combobox", { name: "AI provider", exact:true })).toBeVisible();
          });
          await context.close();
          continue;
        }
        if (fresh) {
          await record("configured-ai", async () => {
            await go("/");
            await expect(page.getByRole("button", { name: /Create workspace|Choose workspace/ }).first()).toBeVisible({timeout: 18000});
          });
          await record("create-workspace", async () => {
            await page.getByRole("button", { name: "Create workspace", exact: true }).first().click({timeout: 7000});
            await expect(page.getByLabel("What are you working on?")).toBeVisible();
          });
          if (suggested) {
            page.on("response", async response => {
              if (!response.url().includes("/api/workspaces/creation-runs")) return;
              const body = await response.json().catch(() => null);
              if (!response.ok() || ["failed", "cancelled"].includes(body?.snapshot?.state)) {
                console.error("Workspace review fixture", response.request().method(), response.status(), body?.snapshot?.stage, body?.snapshot?.architect?.failure?.message || body?.error);
              }
            });
            await record("suggested-team", async () => {
              await page.getByLabel("Workspace name", { exact: true }).fill("Harbor Review");
              await page.getByLabel("What are you working on?").fill("Research and publish a monthly neighborhood newsletter. Propose a lead editor and a research specialist.");
              if (theme === "light" && size === stageSizes.at(-1)) {
                await page.getByText("Add documents, a website or a note", {exact:true}).click();
                await page.getByLabel("Company documents").setInputFiles(path.join(repo, "tests/fixtures/workforce-knowledge/press-guide.docx"));
                await expect(page.getByText("press-guide.docx", {exact:false}).first()).toBeVisible();
              }
              await page.getByRole("button", { name: "Suggest a team", exact: true }).click();
              await expect(page.getByRole("heading", { name: "Meet your proposed team" })).toBeVisible({ timeout: 55000 });
              const dialog = await page.getByRole("dialog", { name: "Build your team" }).boundingBox();
              const launch = await page.getByRole("button", { name: "Launch workspace", exact: true }).boundingBox();
              assert(dialog && dialog.x >= -1 && dialog.x + dialog.width <= size.width + 1, "Team review extends outside the viewport.");
              assert(launch && launch.x >= 0 && launch.x + launch.width <= size.width + 1, "Launch action is clipped.");
            });
            await record("reviewed-team-edits", async () => {
              const lead = page.locator("details.workforce-person").first();
              await lead.locator(":scope > summary").click();
              await lead.getByLabel("Name", { exact: true }).fill("Harbor Lead");
              await lead.getByLabel("Role", { exact: true }).fill("Managing editor");
              await lead.getByLabel("Working instructions and knowledge to consult").fill("Consult company guidelines before publishing.");
              const abilities = lead.locator("details").filter({hasText:"Browse abilities"});
              await abilities.getByText("Browse abilities",{exact:true}).click();
              const available = abilities.getByRole("checkbox", {name:/Read workspace files|Search the web|Read web pages|Check current session status|Search native memory/}).and(abilities.locator("input:not([disabled])")).first();
              await expect(available).toBeVisible({timeout:12000});
              const abilityText = await available.locator("..").innerText();
              const chosen = Object.entries({read:"Read workspace files",web_search:"Search the web",web_fetch:"Read web pages",session_status:"Check current session status",memory_search:"Search native memory"})
                .find(([, label]) => abilityText.includes(label))?.[0];
              assert(chosen,"No supported ability was offered.");
              await available.check();
              const apply = page.getByRole("button", { name: "Save team changes" });
              await expect(page.getByRole("button", { name: "Launch workspace", exact: true })).toBeDisabled();
              const saved = page.waitForResponse(response => response.request().method() === "POST" && /\/creation-runs\/[^/]+\/revise$/.test(response.url()));
              await apply.click();
              const revision = await saved;
              assert(revision.ok(), `Employee review returned ${revision.status()}.`);
              const result = await revision.json();
              assert.equal(result.result.blueprint.workforce.primaryAgent.role, "Managing editor");
              assert(result.result.blueprint.workforce.primaryAgent.toolIds.includes(chosen), "The plan did not retain the selected native tool.");
              assert.deepEqual(result.result.blueprint.workforce.primaryAgent.responsibilities, ["Consult company guidelines before publishing."]);
              await expect(lead.locator(":scope > summary")).toContainText("Managing editor");
              await expect(apply).toBeDisabled();
            });
            if (theme === "light" && size === stageSizes.at(-1)) {
              const started = performance.now();
              await record("launch-reviewed-team", async () => {
                await page.getByRole("button", { name: "Launch workspace", exact: true }).click();
                const open = page.getByRole("button", { name: "Open Workspace", exact: true });
                await expect(open.or(page.getByText("Your workspace is ready",{exact:true})).first()).toBeVisible({timeout:70000});
                if (await open.isVisible()) await open.click().catch(() => {});
                await expect(page.locator(".react-flow__node-agent")).toHaveCount(1, { timeout: 20000 });
                const response = await fetch(base + "/api/snapshot?force=true", { headers });
                assert(response.ok);
                const workers = (await response.json()).agents;
                const employee = workers.find(agent => agent.name === "Harbor Lead");
                assert(employee, "The edited employee was not in the native roster.");
                assert.equal(employee.workerProfile?.employment.role, "Managing editor");
                assert.equal(employee.workerProfile?.employment.behaviorInstructions, "Consult company guidelines before publishing.");
                const node = page.locator(`.react-flow__node-agent[data-id="${employee.id}"]`);
                await expect(node).toBeAttached();
                console.log(`Proposed fixture launch to verified canvas: ${Math.round(performance.now() - started)} ms.`);
                await screenshot("launch-reviewed-canvas");
                await page.getByRole("button", {name:"Start a conversation",exact:true}).click({timeout:12000});
                await page.getByRole("textbox", {name:"Message Harbor Lead",exact:true}).fill("Draft the introduction for our first issue.");
                await page.getByRole("button", {name:"Send message"}).click();
                await expect(page.getByText("AGENTOS_FIXTURE_FIRST_REPLY",{exact:true})).toBeVisible({timeout:25000});
                console.log(`Proposed fixture launch to first reply: ${Math.round(performance.now() - started)} ms.`);
              });
              await context.close();
              continue;
            }
            await record("discard-reviewed-draft", async () => {
              await page.getByRole("button", { name: "Start over", exact: true }).click();
              await expect(page.getByRole("dialog", { name: "Start a new workspace?" })).toBeVisible();
              await page.getByRole("button", { name: "Start new workspace", exact: true }).click();
              await expect(page.getByLabel("Workspace name", { exact: true })).toHaveValue("");
            });
            await context.close();
            continue;
          }
          await record("build-team", async () => {
            await page.getByLabel("Workspace name", {exact: true}).fill("Harbor Review");
            await page.getByLabel("What are you working on?").fill("Research and publish a monthly neighborhood newsletter.");
            if (theme === "light" && size === stageSizes.at(-1)) {
              await page.getByText("Add documents, a website or a note", {exact:true}).click();
              await page.getByLabel("Setup note").fill("The policy desk checks every geographic name before publication.");
              await page.getByLabel("Company documents").setInputFiles(path.join(repo, "tests/fixtures/workforce-knowledge/press-guide.xlsx"));
            }
            await page.getByRole("button", {name:"Build team manually"}).click();
            await expect(page.getByRole("heading", {name:"Choose your first employees"})).toBeVisible();
          });
          if (theme === "light" && size === stageSizes.at(-1)) {
            await record("resume-workspace-draft", async () => {
              await go("/");
              await page.getByRole("button", {name:"Create workspace",exact:true}).first().click();
              await expect(page.getByRole("heading", {name:"Choose your first employees"})).toBeVisible();
              await page.getByRole("button", {name:"Back",exact:true}).click();
              await expect(page.getByLabel("Workspace name", {exact:true})).toHaveValue("Harbor Review");
              await expect(page.getByText(/Reattach press-guide.xlsx/)).toBeVisible();
              await expect(page.getByLabel("Setup note")).toHaveValue("The policy desk checks every geographic name before publication.");
              await page.getByLabel("Company documents").setInputFiles(path.join(repo, "tests/fixtures/workforce-knowledge/press-guide.xlsx"));
              await page.getByRole("button", {name:"Build team manually"}).click();
            });
            const startTime = performance.now();
            await record("launch-workspace", async () => {
              await page.getByRole("button", {name:"Launch workspace", exact:true}).click();
              await expect(page.getByRole("dialog")).toHaveCount(0, {timeout: 45000});
              await expect(page.locator('.react-flow__node-agent[data-id="harbor-review-assistant"]')).toBeVisible({timeout: 10000});
              console.log(`Manual fixture launch to verified canvas: ${Math.round(performance.now() - startTime)} ms.`);
            });
            await record("manual-deferred-documents", async () => {
              const snapshot = await (await fetch(base + "/api/snapshot?force=true", { headers })).json();
              const employee = snapshot.agents.find(agent => agent.id === "harbor-review-assistant");
              assert(employee, "Manual workspace employee unavailable.");
              const brief = await (await fetch(base + "/api/workspaces/" + encodeURIComponent(employee.workspaceId) + "/files?path=docs%2Fbrief.md",{headers})).json();
              assert.match(brief.content, /policy desk checks every geographic name/);
              await expect.poll(async () => {
                const result = await (await fetch(base + "/api/workspaces/" + encodeURIComponent(employee.workspaceId) + "/files",{headers})).json();
                return result.files?.some(file => /docs\/library\/xlsx\/press-guide-/.test(file.path));
              }, {timeout:30000}).toBe(true);
              await go("/knowledge?workspaceId=" + encodeURIComponent(employee.workspaceId));
              await expect(page.getByRole("button", {name:/^Press Guide XLSX · Harbor Review/i})).toBeVisible({timeout:12000});
            });
            await record("first-conversation", async () => {
              await go("/chat?employee=harbor-review-assistant");
              await page.getByRole("textbox", {name:"Message Assistant", exact:true}).fill("Draft the first line of our newsletter.");
              await page.getByRole("button", {name:"Send message", exact:true}).click();
              await expect(page.getByText("AGENTOS_FIXTURE_FIRST_REPLY", {exact:true})).toBeVisible({timeout: 25000});
              console.log(`Manual fixture launch to first reply: ${Math.round(performance.now() - startTime)} ms.`);
            });
          }
          await context.close();
          continue;
        }

        await record("canvas", async () => {
          await go("/mission-control");
          await expect(page.locator(".react-flow__node-agent").filter({ hasText: "Ada" })).toBeVisible({ timeout: 18000 });
          await expect(page.locator(".react-flow__node-agent")).toHaveCount(3);
          await wait(700);
          const graph = await page.evaluate(() => ({
            viewport: [innerWidth, innerHeight, devicePixelRatio],
            canvas: { width: document.querySelector(".react-flow")?.clientWidth, height: document.querySelector(".react-flow")?.clientHeight },
            transform: document.querySelector(".react-flow__viewport")?.style.transform,
            nodes: [...document.querySelectorAll(".react-flow__node")].map(el => ({
              id: el.dataset.id, type: [...el.classList].find(c => c.startsWith("react-flow__node-")),
              position: el.style.transform, width: el.offsetWidth, height: el.offsetHeight
            })),
            storage: Object.fromEntries(Object.entries(localStorage).filter(([name]) => name.startsWith("mission-control-node-positions")))
          }));
          await page.locator(".react-flow").first().screenshot({ path: path.join(output, key + "-canvas-region.png"), animations: "disabled" });
          await writeFile(path.join(output, key + "-canvas.json"), JSON.stringify(graph, null, 2) + "\n");
        });

        await record("canvas-zoom", async () => {
          const transform = page.locator(".react-flow__viewport");
          const before = await transform.getAttribute("style");
          await page.getByRole("button", { name: "Zoom in", exact: true }).click({timeout: 5000});
          await expect.poll(() => transform.getAttribute("style")).not.toBe(before);
          await page.getByRole("button", { name: "Fit canvas to view" }).click();
        });
        if (size.width === 1440) await record("canvas-node-menu", async () => {
          const action = page.getByRole("button", { name: "Ada actions", exact: true });
          await action.click();
          await expect(page.locator(".agent-node__action-menu")).toBeVisible();
        });
        if (size.width === 1440) await record("canvas-drag-restored", async () => {
          await go("/mission-control");
          const ada = page.locator('.react-flow__node-agent[data-id="fieldwork-studio-ada"]');
          await expect(ada).toBeVisible();
          await wait(650);
          const before = await ada.evaluate(el => el.style.transform);
          const point = await ada.evaluate(el => {
            const box = el.getBoundingClientRect();
            for (const dx of [16, 32, 80, 120]) for (const dy of [22, 42, 52, 80]) {
              const x = Math.round(box.left + dx), y = Math.round(box.top + dy);
              const target = document.elementFromPoint(x, y);
              if (target?.closest(".react-flow__node") === el && !target.closest(".nodrag, button, a, input")) return { x, y };
            }
            return null;
          });
          assert(point, "No draggable point on Ada was visible.");
          await page.mouse.move(point.x, point.y);
          await page.mouse.down();
          await page.mouse.move(point.x + 88, point.y - 22, {steps:12});
          await page.mouse.up();
          await expect.poll(() => ada.evaluate(el => el.style.transform)).not.toBe(before);
          const moved = await ada.evaluate(el => el.style.transform);
          const savedPosition = () => page.evaluate(() => {
            const positions = JSON.parse(localStorage.getItem("mission-control-node-positions:v4:workspace:fieldwork-studio") || "{}");
            return positions["agent:fieldwork-studio:fieldwork-studio-ada"];
          });
          await expect.poll(async () => {
            const saved = await savedPosition();
            return Boolean(saved && (saved.x !== 96 || saved.y !== 160));
          }).toBe(true);
          await go("/mission-control");
          await expect.poll(() => ada.evaluate(el => el.style.transform)).toBe(moved);
        });
        if (size.width === 390) await record("canvas-inspector", async () => {
          await page.getByRole("button", { name: "Open inspector", exact: true }).click();
          await expect(page.getByRole("button", { name: "Close inspector", exact: true }).first()).toBeVisible();
        });
        if (baseline || matchedCanvas) {
          await context.close();
          continue;
        }

        await record("workspace-switcher", async () => {
          await go("/mission-control");
          if (size.width < 1024) await page.getByRole("button", {name:"More", exact:true}).click();
          else await page.getByRole("button", {name:"Expand sidebar", exact:true}).hover();
          const switcher = page.getByRole("button", {name:/Fieldwork Studio Workspace/}).first();
          await switcher.click({timeout: 5000});
          await expect(page.getByRole("menuitem", {name:/Northline Press/}).first()).toBeVisible();
        });
        if ([1440, 820, 390].includes(size.width)) await record("workspace-switch-confirmed", async () => {
          await page.getByRole("menuitem", {name:/Northline Press/}).first().click();
          const sam = page.locator('.react-flow__node-agent[data-id="northline-press-sam"]');
          await expect(sam).toBeVisible();
          await expect(page.locator('.react-flow__node-agent[data-id="fieldwork-studio-ada"]')).toHaveCount(0);
          await page.getByRole("link", {name:"Team",exact:true}).first().click();
          await expect(page.getByRole("link", {name:"Sam",exact:true})).toBeVisible();
          await expect(page.getByRole("link", {name:"Ada",exact:true})).toHaveCount(0);
          await page.evaluate(({ scopeKey, workspaceId }) => sessionStorage.setItem(scopeKey, workspaceId), {scopeKey, workspaceId:first.workspaceId});
        });
        await record("team", async () => {
          const started = performance.now();
          await go("/team?workspaceId=" + encodeURIComponent(first.workspaceId));
          await expect(page.getByRole("heading", { name: "Team", exact: true })).toBeVisible();
          await expect(page.getByRole("link", { name: "Ada", exact: true })).toBeVisible({ timeout: 12000 });
          timings.team = Math.round(performance.now() - started);
        });
        await record("add-employee", async () => {
          await page.getByRole("button", { name: "Add employee", exact: true }).last().click();
          await expect(page.getByRole("dialog", { name: "Add employee" })).toBeVisible();
          await expect(page.getByLabel("What should they do?")).toBeVisible();
        });
        const employeePath = `/agents/${encodeURIComponent(worker.id)}`;
        for (const [name, tab] of [["employee-overview", "overview"], ["identity", "behavior"], ["employee-knowledge", "knowledge"], ["capabilities", "capabilities"], ["employee-activity", "sessions"], ["intelligence", "intelligence"]]) {
          await record(name, async () => {
            await go(`${employeePath}?tab=${tab}`);
            await expect(page.getByRole("heading", { name: "Ada", exact: true })).toBeVisible();
            await expect(page.getByRole("region", {name: /for Ada/})).toBeVisible();
          });
        }
        await record("chat", async () => {
          await go(`/chat?employee=${encodeURIComponent(worker.id)}`);
          const composer = page.getByRole("textbox", {name:"Message Ada", exact:true});
          await expect(composer).toBeVisible({ timeout: 12000 });
          if (!completedConversation) {
            await composer.fill("Write a one-line introduction for our research brief.");
            await page.getByRole("button", { name: "Send message" }).click();
            await expect(page.getByText("AGENTOS_FIXTURE_FIRST_REPLY", {exact: true})).toBeVisible({ timeout: 20000 });
            completedConversation = true;
          }
          await expect(page.getByText("AGENTOS_FIXTURE_FIRST_REPLY", {exact: true})).toBeVisible({timeout: 8000});
          if (size.width < 500) {
            await composer.focus();
            await expect(page.getByRole("button", { name:"Send message" })).toBeInViewport();
          }
        });
        if (size.width === 360 || size.width === 390) await record("chat-constrained-height", async () => {
          const composer = page.getByRole("textbox", {name:"Message Ada", exact:true});
          await page.setViewportSize({width:size.width, height:470});
          try {
            await composer.focus();
            await expect(page.getByRole("button", {name:"Send message"})).toBeInViewport();
            await screenshot("chat-focused-470");
          } finally {
            await page.setViewportSize(size);
          }
        });
        await record("tasks", async () => {
          await go("/missions");
          await expect(page.getByRole("heading", { name: "Tasks", exact: true })).toBeVisible();
          await expect(page.getByRole("navigation", { name: "Task views" })).toBeVisible();
        });
        await record("assign-task", async () => {
          await page.getByRole("button", {name:"Assign task", exact:true}).click();
          await expect(page.getByRole("dialog", {name:"Assign task", exact:true})).toBeVisible();
        });
        await record("needs-you", async () => {
          await go("/missions?view=needs-you");
          await expect(page.getByRole("heading", { name: "Decisions and approvals" })).toBeVisible();
        });
        await record("scheduled", async () => {
          await go("/missions?view=scheduled");
          await expect(page.getByRole("heading", { name: "Scheduled tasks", exact: true })).toBeVisible();
        });
        if (taskId) await record("task-detail", async () => {
          await go(`/missions/${encodeURIComponent(taskId)}`);
          await expect(page.getByText("Draft a short research brief for the studio.", {exact:true}).first()).toBeVisible();
        });
        for (const [name, route, heading] of [["knowledge", "/knowledge", "Knowledge"], ["integrations", "/integrations", "Integrations"],
          ["settings", "/settings", "Settings"], ["runtime", "/settings#runtime", "Runtime"]]) {
          await record(name, async () => {
            const started = performance.now();
            await go(name === "knowledge" ? route + "?workspaceId=" + encodeURIComponent(first.workspaceId) : route);
            await expect(page.getByRole("heading", { name: heading, exact: true }).first()).toBeVisible();
            if (name === "knowledge") {
              await expect(page.getByRole("heading", { name:"Documents", exact:true })).toBeVisible();
              await expect(page.getByRole("region", { name:"Documents", exact:true })).toHaveAttribute("aria-busy", "false");
              await expect(page.getByRole("button", {name:/Company brief/})).toHaveCount(0);
              timings.knowledge = Math.round(performance.now() - started);
            }
          });
        }
        if (theme === "light" && size === stageSizes.at(-1)) {
          const knowledge = "/knowledge?workspaceId=" + encodeURIComponent(first.workspaceId);
          const assignments = "/api/workspaces/" + encodeURIComponent(first.workspaceId) + "/knowledge/assignments";
          const fileFor = async agentId => {
            const response = await fetch(base + assignments + "?employee=" + encodeURIComponent(agentId), { headers });
            assert.equal(response.status, 200);
            return (await response.json()).paths.find(value => /^docs\/library\/pdf\/press-guide-/.test(value));
          };
          await record("knowledge-import-dialog", async () => {
            await go(knowledge);
            await page.getByRole("button", {name:"Add knowledge",exact:true}).first().click();
            await expect(page.getByRole("dialog", {name:"Add knowledge",exact:true})).toBeVisible();
          });
          await record("knowledge-upload", async () => {
            await page.getByLabel("Choose documents").setInputFiles(path.join(repo, "tests/fixtures/workforce-knowledge/press-guide.pdf"));
            await page.getByRole("button", {name:"Add to workspace",exact:true}).click();
            const document = page.getByRole("button", {name:/^Press Guide.*PDF/i});
            await expect(document).toBeVisible({timeout:15000});
            await document.click();
            await expect(page.getByText("The specimen proof code is Fieldwork 903.", {exact:false}).first()).toBeVisible();
          });
          await record("knowledge-batch-partial", async () => {
            await go(knowledge);
            await expect(page.getByRole("button", {name:/^Press Guide.*PDF/i})).toBeVisible({timeout:15000});
            await page.getByRole("button", {name:"Add knowledge",exact:true}).first().click();
            await page.getByLabel("Choose documents").setInputFiles(["press-guide.docx", "press-guide.xlsx", "empty.pdf"].map(name => path.join(repo, "tests/fixtures/workforce-knowledge", name)));
            const start = performance.now();
            await page.getByRole("button", {name:"Add to workspace",exact:true}).click();
            await expect(page.getByText("Saved to workspace", {exact:true})).toHaveCount(2, {timeout:30000});
            await expect(page.getByText(/no selectable text/i)).toBeVisible();
            await expect(page.getByRole("button", {name:"Retry remaining"})).toBeEnabled();
            timings["knowledge-batch-partial"] = Math.round(performance.now() - start);
          });
          const batchDone = page.getByRole("button", {name:"Done",exact:true});
          if (await batchDone.isVisible()) await batchDone.click();
          await record("knowledge-source-assignments", async () => {
            await page.getByRole("button", {name:/^Assign press guide \(PDF\)$/i}).first().click();
            const dialog = page.getByRole("dialog");
            await expect(dialog.getByRole("checkbox", {name:/Ada/})).toBeVisible({timeout:12000});
          });
          if (process.env.WORKFORCE_PUBLIC_WEBPAGE) await record("knowledge-public-webpage", async () => {
            await go(knowledge);
            await page.getByRole("button", {name:"Add knowledge",exact:true}).first().click();
            await page.getByText("Import webpage",{exact:true}).click();
            await page.getByLabel("Website address").fill(process.env.WORKFORCE_PUBLIC_WEBPAGE);
            await page.getByRole("button", {name:"Preview webpage"}).click();
            const preview = page.getByRole("region",{name:"Webpage preview"});
            await expect(preview.getByRole("heading")).toBeVisible({timeout:16000});
            const title = await preview.getByRole("heading").textContent();
            await page.getByRole("button", {name:"Add to workspace",exact:true}).click();
            await page.getByRole("button", {name:new RegExp(title + ".*Imported webpage", "i")}).click();
            await expect(page.getByRole("button",{name:"Refresh webpage"})).toBeVisible({timeout:10000});
          });
          await record("knowledge-reference", async () => {
            await go(knowledge);
            await page.getByRole("button", {name:"Add knowledge",exact:true}).first().click();
            await page.getByText("Save link", {exact:true}).click();
            await page.getByLabel("Name", {exact:true}).fill("Newsroom handbook");
            await page.getByLabel("Website address").fill("https://example.com/newsroom");
            await page.getByRole("button", {name:"Add to workspace",exact:true}).click();
            await page.getByRole("button", {name: /^Newsroom handbook/i}).click();
            await expect(page.getByText("https://example.com/newsroom", {exact:false}).first()).toBeVisible();
          });
          await record("knowledge-assigned", async () => {
            await go(employeePath + "?tab=knowledge");
            const assign = page.getByRole("button", {name:/^Assign press guide \(PDF\)$/i});
            await expect(assign).toBeVisible({timeout:15000});
            await assign.click();
            await expect(page.getByRole("button", {name:/^Remove assignment for press guide \(PDF\)$/i})).toBeVisible({timeout:30000});
            await page.reload({waitUntil:"domcontentloaded"});
            await expect(page.getByRole("button", {name:/^Remove assignment for press guide \(PDF\)$/i})).toBeVisible({timeout:20000});
          });
          await record("chat-draft-restored", async () => {
            await go("/chat?employee=" + encodeURIComponent(worker.id));
            const draft = page.getByRole("textbox", {name:"Message Ada", exact:true});
            await draft.fill("Outline the next edition as three talking points.");
            await page.reload({waitUntil:"domcontentloaded"});
            await expect(draft).toHaveValue("Outline the next edition as three talking points.", {timeout:10000});
            await draft.fill("");
          });
          await record("task-dispatch-acceptance", async () => {
            await go("/missions");
            await page.getByRole("button", {name:"Assign task",exact:true}).click();
            const dialog = page.getByRole("dialog", {name:"Assign task"});
            const goal = "Summarize the research draft and flag two open questions.";
            await dialog.getByLabel("What should they do?").fill(goal);
            await dialog.getByLabel("Employee").selectOption(worker.id);
            const submitted = page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith("/api/mission"));
            await dialog.getByRole("button", {name:"Start task"}).click();
            const accepted = await submitted;
            assert(accepted.ok(), "Native task request did not succeed.");
            await expect(page).toHaveURL(/\/missions\/[^/?]+$/, {timeout:25000});
            await expect(page.getByText(goal,{exact:true}).first()).toBeVisible({timeout:12000});
          });
          await record("integration-detail", async () => {
            await go("/integrations");
            const details = page.getByRole("button", {name:"Details",exact:true}).first();
            await expect(details).toBeVisible();
            await details.click();
            await expect(page.getByRole("dialog")).toBeVisible();
            await expect(page.getByRole("heading", {name:"Employee access",exact:true})).toBeVisible();
          });
          await record("hire-preparation", async () => {
            await go("/team?workspaceId=" + encodeURIComponent(first.workspaceId));
            await page.getByRole("button", {name:"Add employee", exact:true}).last().click();
            const form = page.getByRole("dialog", {name:"Add employee"});
            await form.getByLabel("Start with a role").selectOption("Researcher");
            await form.getByLabel("Name", {exact:true}).fill("Morgan");
            await form.locator("summary").filter({hasText:/^Knowledge/}).click();
            const document = form.getByRole("checkbox", {name:/press guide.*PDF/i});
            await expect(document).toBeVisible({timeout:15000});
            await document.check();
            await form.locator("summary").filter({hasText:/^Abilities/}).click();
            await form.getByText("Browse abilities", {exact:true}).click();
            const pickerStarted = performance.now();
            const read = form.getByRole("checkbox", { name: /Read workspace files/ });
            await expect(read).toBeVisible({timeout:12000});
            if (await read.isEnabled()) await read.check();
            else await expect(read).toBeChecked();
            const status = form.getByRole("checkbox", { name: /Check current session status/ });
            await expect(status).toBeVisible();
            if (await status.isEnabled()) await status.check();
            timings["hire-preparation"] = Math.round(performance.now() - pickerStarted);
            await form.locator("summary").filter({hasText:/^Abilities/}).first().click();
            await form.getByRole("checkbox", {name:/press guide.*DOCX/i}).check();
          });
          await record("native-employee-created", async () => {
            const form = page.getByRole("dialog", {name:"Add employee"});
            await form.getByRole("button", {name:"Add employee", exact:true}).click();
            await expect(page.getByRole("link", {name:"Morgan", exact:true})).toBeVisible({timeout:25000});
          });
          if (verifyNativeKnowledge) await record("native-knowledge-restart-and-revocation", async () => {
            const snapshot = await (await fetch(base + "/api/snapshot?force=true", {headers})).json();
            const employee = snapshot.agents.find(item => item.name === "Morgan" && item.workspaceId === first.workspaceId);
            const outside = snapshot.agents.find(item => item.name === "Sam" && item.workspaceId !== first.workspaceId);
            assert(employee && outside, "Expected employees in separate native workspaces.");
            await expect.poll(() => fileFor(employee.id), {timeout:20000}).toMatch(/press-guide/);
            const documentPath = await fileFor(employee.id);
            const docxPath = (await (await fetch(base + assignments + "?employee=" + encodeURIComponent(employee.id), {headers})).json()).paths.find(value => /library\/docx\/press-guide-/.test(value));
            assert(docxPath, "DOCX was not assigned alongside the PDF.");
            const denied = await fetch(base + assignments, {
              method:"PATCH", headers, body:JSON.stringify({agentId:outside.id, path:documentPath, selected:true})
            });
            assert.equal(denied.status, 400, "Cross-workspace assignment was admitted.");
            const missing = await fetch(base + assignments, {
              method:"PATCH", headers, body:JSON.stringify({agentId:employee.id, path:"docs/library/md/missing-12345678123456781234.md", selected:true})
            });
            assert.equal(missing.status, 400, "Missing document was assigned.");
            nativeClient = connectNative();
            const hasProof = async target => {
              const result = await nativeClient.searchMemory({ agentId:target, query:"specimen proof code Fieldwork", maxResults:10, minScore:0 }, {timeoutMs:12000});
              return result?.results.some(item => item.snippet?.includes("Fieldwork 903")) ?? false;
            };
            await expect.poll(() => hasProof(employee.id), {timeout:45000, intervals:[500,1000,2000]}).toBe(true);
            assert.equal(await hasProof(outside.id), false);
            await go("/chat?employee=" + encodeURIComponent(employee.id));
            await page.getByRole("textbox", {name:"Message Morgan",exact:true}).fill("WORKFORCE_READ_PROOF " + documentPath);
            await page.getByRole("button", {name:"Send message"}).click();
            await expect(page.getByText("The specimen proof code is Fieldwork 903.", {exact:true}).last()).toBeVisible({timeout:45000});
            const { sessions } = await nativeClient.listSessions({agentId:employee.id,limit:10});
            const actualSession = sessions.find(session => session.key?.startsWith("agent:" + employee.id + ":"))?.key;
            assert(actualSession, "Expected a native session created by Chat.");
            const toolset = await nativeClient.getEffectiveTools({agentId:employee.id,sessionKey:actualSession});
            assert(toolset.groups.some(group => group.tools.some(tool => tool.id === "read" && !tool.deniedBySession)), "Read is not effective for the employee.");
            await screenshot("native-employee-document-reply");
            nativeClient.close("isolated restart");
            await stop(app);
            await stop(gw);
            gw = launchGateway();
            await ready("http://127.0.0.1:" + gatewayPort + "/healthz", gw);
            app = launchApp();
            await ready(base + "/api/auth/status", app);
            nativeClient = connectNative();
            assert.equal(await fileFor(employee.id), documentPath);
            const restartAssignment = (await (await fetch(base + assignments + "?employee=" + encodeURIComponent(employee.id), {headers})).json()).paths;
            assert(restartAssignment.includes(docxPath));
            await expect.poll(() => hasProof(employee.id), {timeout:40000}).toBe(true);
            await go("/agents/" + encodeURIComponent(employee.id) + "?tab=knowledge");
            let removal;
            await expect.poll(async () => {
              removal = await fetch(base + assignments, {
                method:"PATCH", headers, body:JSON.stringify({agentId:employee.id,path:documentPath,selected:false})
              });
              assert(removal.ok || removal.status === 503,
                "Could not revoke document assignment (" + removal.status + "): " + (await removal.clone().json()).error);
              return removal.ok;
            }, {timeout:20000, intervals:[500,1000,2000]}).toBe(true);
            await expect.poll(() => fileFor(employee.id), {timeout:15000}).toBeUndefined();
            await expect.poll(() => hasProof(employee.id), {timeout:45000, intervals:[500,1000,2000]}).toBe(false);
            const afterRemoval = (await (await fetch(base + assignments + "?employee=" + encodeURIComponent(employee.id), {headers})).json()).paths;
            assert(afterRemoval.includes(docxPath), "Selective removal discarded a second document.");
            assert(fixture.stats.embeddingCount > 0);
            await writeFile(path.join(output,"native-knowledge.json"),JSON.stringify({
              import: "PDF and DOCX assigned together; XLSX imported with partial batch recovery", selectiveRemovalPreservedOtherAssignment: true, retrieval: "native memory.search", authorizedTool: "read", chatReadBack: true,
              crossWorkspaceAssignmentDenied: true, differentWorkspaceNotRetrieved: true, staleSourceAssignmentDenied: true,
              persistenceAfterGatewayAndAppRestart: true, retrievedAfterRemoval: false, embeddingRequests: fixture.stats.embeddingCount
            },null,2) + "\n");
          });
        }
        await context.close();
      }
    }

    await writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
    if (!fresh && !baseline && !matchedCanvas) {
      for (const route of ["/chat", "/team", "/knowledge", "/missions", "/integrations", "/settings"]) {
        const unauthenticated = await fetch(base + route, { redirect: "manual" });
        assert.equal(unauthenticated.status, 307);
        assert(!((await unauthenticated.text()).includes("Fieldwork Studio")));
      }
      const knowledgeApi = "/api/workspaces/" + encodeURIComponent(first.workspaceId) + "/knowledge";
      const assignmentsApi = knowledgeApi + "/assignments?employee=" + encodeURIComponent(worker.id);
      for (const route of ["/api/snapshot", "/api/stream", "/api/missions", "/api/human-control", assignmentsApi]) {
        const unauthenticated = await fetch(base + route, { redirect: "manual" });
        assert.equal(unauthenticated.status, 401);
      }
      const password = randomUUID();
      const member = await createManagedAgentOsUser({ username: "fixture-member", password }, env);
      const memberLogin = await loginToInstance({ username: "fixture-member", password, rateKey:"workforce-browser" }, env);
      const memberHeaders = { Cookie: INSTANCE_PROTECTION_COOKIE + "=" + memberLogin.session };
      for (const route of ["/chat", "/team", "/knowledge", "/missions", "/integrations", "/settings"]) {
        const denied = await fetch(base + route, { redirect:"manual", headers: memberHeaders });
        assert([303,307].includes(denied.status), `Member navigation ${route}: ${denied.status}`);
        assert(denied.headers.get("location")?.endsWith("/operator-access"));
        assert(!((await denied.text()).includes("Fieldwork Studio")));
      }
      for (const route of ["/api/snapshot", "/api/stream", assignmentsApi, "/api/openclaw/capabilities?view=guided-abilities"]) {
        const denied = await fetch(base+route, { headers:memberHeaders });
        assert.equal(denied.status, 403);
      }
      for (const [route, method] of [[knowledgeApi,"POST"],[assignmentsApi,"PATCH"]]) {
        const anon = await fetch(base+route, { method, headers:{Origin:base} });
        const member = await fetch(base+route, { method, headers:{...memberHeaders, Origin:base} });
        assert.equal(anon.status,401);
        assert.equal(member.status,403);
      }
      await updateManagedAgentOsUserRole(member.actorId, "owner", env);
      const promoted = await loginToInstance({ username:"fixture-member", password, rateKey:"workforce-browser-promoted" }, env);
      const promotedHeaders = { Cookie: INSTANCE_PROTECTION_COOKIE + "=" + promoted.session };
      const allowed = await fetch(base + "/api/snapshot", { headers:promotedHeaders });
      assert(allowed.ok, `Promoted owner snapshot returned ${allowed.status}.`);
      const stream = await fetch(base + "/api/stream", { headers:promotedHeaders, signal:AbortSignal.timeout(17000) });
      assert.equal(stream.status, 200);
      const reader = stream.body.getReader();
      await updateManagedAgentOsUserRole(member.actorId, "member", env);
      await updateManagedAgentOsUserStatus(member.actorId, "disabled", env);
      for (;;) {
        const event = await reader.read();
        if (event.done) break;
      }
      const revoked = await fetch(base + "/api/stream", { headers:promotedHeaders, redirect:"manual" });
      assert.equal(revoked.status, 401);
      console.log("Unauthenticated and member route/API checks passed. Revocation closed the active SSE stream and denied a new connection.");
    }
    const failures = report.filter(result => result.result === "FAIL");
    console.log(`Captured ${report.length - failures.length}/${report.length} checks to ${output}.`);
    if (failures.length) {
      console.error(JSON.stringify(failures, null, 2));
      process.exitCode = 1;
    }
  } catch (error) {
    for (const child of children) console.error(child.diagnostic());
    throw error;
  } finally {
    nativeClient?.close("disposable fixture complete");
    await browser?.close();
    for (const child of children.reverse()) await stop(child);
    await fixture.close();
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  }
}
run().catch(error=>{console.error(error.message);process.exitCode=1;});
