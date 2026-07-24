import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const root = process.cwd();

test("Secure Live View owns the full viewport and exposes responsive browser controls", async () => {
  const [source, buttonSource, skillSource] = await Promise.all([
    readFile(
      path.join(root, "components/operations/accounts/secure-browser-live-view.tsx"),
      "utf8"
    ),
    readFile(path.join(root, "components/ui/button.tsx"), "utf8"),
    readFile(path.join(root, "skills/agentos-ui-ux/SKILL.md"), "utf8")
  ]);

  assert.match(source, /h-dvh max-h-dvh min-h-0/);
  assert.match(source, /safe-area-inset-top/);
  assert.match(source, /safe-area-inset-bottom/);
  assert.doesNotMatch(source, /min-h-\[600px\]/);
  assert.match(source, /bg-violet-400\/14/);
  assert.match(source, /rounded-md border border-violet-300\/20/);
  assert.match(source, /text-\[11px\] font-semibold text-violet-50/);
  assert.match(source, /Zoom out/);
  assert.match(source, /Zoom in/);
  assert.match(source, /Pan zoomed view/);
  assert.match(source, /Enter fullscreen/);
  assert.match(source, /Focus browser keyboard/);
  assert.match(source, /Adaptive/);
  assert.match(source, /Fit/);
  assert.match(source, /Actual/);
  assert.match(source, /Session tools/);
  assert.match(buttonSource, /whitespace-nowrap rounded-md text-sm font-semibold/);
  assert.match(buttonSource, /sm: "h-9 rounded-md px-3"/);
  assert.match(buttonSource, /lg: "h-12 rounded-md px-5"/);
  assert.match(skillSource, /Default to `rounded-md` for standard buttons/);
});

test("Secure Live View uses an AgentOS-owned noVNC client with origin-bound controls", async () => {
  const [client, service, proxy, nextConfig] = await Promise.all([
    readFile(path.join(root, "public/secure-browser-client.js"), "utf8"),
    readFile(path.join(root, "lib/agentos/application/browser-account-service.ts"), "utf8"),
    readFile(path.join(root, "scripts/railway-public-proxy.mjs"), "utf8"),
    readFile(path.join(root, "next.config.mjs"), "utf8")
  ]);

  assert.match(client, /import RFB from "\/novnc\/core\/rfb\.js"/);
  assert.match(client, /event\.origin !== parentOrigin/);
  assert.match(client, /event\.source !== window\.parent/);
  assert.match(client, /rfb\.scaleViewport = mode === "fit"/);
  assert.match(client, /rfb\.resizeSession = mode === "adaptive"/);
  assert.match(client, /rfb\?\.sendCtrlAltDel\(\)/);
  assert.match(service, /viewerPath: `\/secure-browser-client\.html/);
  assert.doesNotMatch(service, /viewerPath: `\/novnc\/vnc_lite\.html/);
  assert.match(proxy, /pathname === "\/secure-browser-client\.html"/);
  assert.match(nextConfig, /secure-browser-client\.:extension\(html\|js\)/);
});
