import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { buildChannelAccountProvisionParams } from "@/lib/openclaw/client/native-ws-gateway-mappers";
import {
  isPluginApiVersionMismatch,
  resolveChannelPluginActivation,
  resolveExactOpenClawPluginSpec
} from "@/lib/openclaw/application/channel-plugin-compat";
import { getSurfaceCatalogEntry } from "@/lib/openclaw/surface-catalog";

test("channel connect catalog exposes WhatsApp QR and complete Slack Socket Mode credentials", () => {
  const whatsapp = getSurfaceCatalogEntry("whatsapp");
  const slack = getSurfaceCatalogEntry("slack");

  assert.equal(whatsapp.providerManagedByOpenClaw, true);
  assert.equal(whatsapp.supportsProvisioning, false);
  assert.equal(whatsapp.iconKey, "siWhatsapp");
  assert.deepEqual(
    slack.provisionFields.filter((field) => field.required).map((field) => field.key),
    ["botToken", "appToken"]
  );
});

test("Google Chat does not expose the obsolete single-webhook provisioning form", () => {
  const googleChat = getSurfaceCatalogEntry("googlechat");

  assert.equal(googleChat.supportsProvisioning, false);
  assert.deepEqual(googleChat.provisionFields, []);
  assert.match(googleChat.description, /service account/i);
});

test("channel provisioning maps Slack app tokens through the Gateway boundary", () => {
  assert.deepEqual(
    buildChannelAccountProvisionParams({
      channel: "slack",
      account: "operations",
      name: "Operations Slack",
      botToken: "xoxb-test",
      appToken: "xapp-test"
    }),
    {
      channel: "slack",
      account: "operations",
      accountId: "operations",
      name: "Operations Slack",
      token: undefined,
      botToken: "xoxb-test",
      appToken: "xapp-test",
      webhookUrl: undefined
    }
  );
});

test("channel plugin installs are pinned to the detected OpenClaw runtime", () => {
  assert.equal(
    resolveExactOpenClawPluginSpec("@openclaw/whatsapp", "2026.6.11"),
    "@openclaw/whatsapp@2026.6.11"
  );
  assert.equal(
    resolveExactOpenClawPluginSpec("@openclaw/whatsapp", "2026.7.2-beta.2"),
    "@openclaw/whatsapp@2026.7.2-beta.2"
  );
  assert.equal(resolveExactOpenClawPluginSpec("@openclaw/whatsapp", null), null);
  assert.equal(resolveExactOpenClawPluginSpec("@openclaw/whatsapp", "latest"), null);
});

test("channel plugin API mismatch errors are classified for actionable recovery", () => {
  assert.equal(
    isPluginApiVersionMismatch(
      new Error('Plugin "@openclaw/whatsapp" requires plugin API >=2026.7.1, but this OpenClaw runtime exposes 2026.6.11.')
    ),
    true
  );
  assert.equal(isPluginApiVersionMismatch(new Error("Network unavailable.")), false);
});

test("bundled channel plugins are enabled while missing external plugins use exact runtime versions", () => {
  assert.deepEqual(
    resolveChannelPluginActivation({
      pluginId: "telegram",
      pluginEnabled: false,
      installPackage: null,
      runtimeVersion: "2026.6.11"
    }),
    { action: "enable", spec: "telegram" }
  );
  assert.deepEqual(
    resolveChannelPluginActivation({
      pluginId: null,
      pluginEnabled: false,
      installPackage: "@openclaw/whatsapp",
      runtimeVersion: "2026.6.11"
    }),
    { action: "install", spec: "@openclaw/whatsapp@2026.6.11" }
  );
});

test("Telegram falls back to its bundled plugin when discovery omits disabled plugins", () => {
  const source = readFileSync(
    `${process.cwd()}/lib/openclaw/application/channel-connect-service.ts`,
    "utf8"
  );

  assert.match(source, /id: "telegram",[\s\S]*?bundledPluginId: "telegram"/);
  assert.match(source, /plugin\?\.id \?\? definition\.bundledPluginId \?\? null/);
});

test("WhatsApp sender pairing stays behind an explicit redacted CLI fallback", () => {
  const source = readFileSync(
    `${process.cwd()}/lib/openclaw/application/channel-connect-service.ts`,
    "utf8"
  );

  assert.match(source, /\["pairing", "approve", "whatsapp", code\]/);
  assert.match(source, /args\.push\("--notify"\)/);
  assert.match(source, /transport: "cli-fallback" as const/);
  assert.doesNotMatch(source, /stdout:/);
});
