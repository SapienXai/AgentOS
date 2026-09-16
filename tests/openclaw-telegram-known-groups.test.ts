import assert from "node:assert/strict";
import { test } from "node:test";

import {
  mergeTelegramKnownGroups,
  parseTelegramSessionGroup,
  type TelegramKnownGroupCandidate
} from "@/lib/openclaw/application/telegram-known-groups-service";

test("Telegram known groups deduplicate by account and chat identity", () => {
  const groups = mergeTelegramKnownGroups([
    {
      accountId: "default",
      chatId: "-1001234567890",
      title: "Stored route title",
      titlePriority: 2,
      titleSource: "stored",
      configured: true,
      source: "openclaw-config"
    },
    {
      accountId: "default",
      chatId: "-1001234567890",
      title: "Felix Management",
      titlePriority: 3,
      titleSource: "observed",
      source: "openclaw-session",
      lastObservedAt: "2026-09-16T06:00:00.000Z"
    },
    {
      accountId: "other-account",
      chatId: "-1001234567890",
      title: "Felix Management",
      titlePriority: 3,
      titleSource: "observed",
      source: "openclaw-session"
    }
  ]);

  assert.equal(groups.length, 2);
  const defaultGroup = groups.find((group) => group.accountId === "default");
  assert.ok(defaultGroup);
  assert.equal(defaultGroup.chatId, "-1001234567890");
  assert.equal(defaultGroup.title, "Felix Management");
  assert.equal(defaultGroup.titleSource, "observed");
  assert.equal(defaultGroup.configured, true);
  assert.deepEqual(defaultGroup.sources, ["openclaw-config", "openclaw-session"]);
  assert.equal(defaultGroup.lastObservedAt, "2026-09-16T06:00:00.000Z");
});

test("historical registry groups remain connectable without being presented as configured", () => {
  const groups = mergeTelegramKnownGroups([
    {
      accountId: "default",
      chatId: "-1009988776655",
      title: "Previously used team",
      titlePriority: 2,
      titleSource: "stored",
      source: "agentos-registry",
      historicalAgentId: "agent-legacy"
    }
  ]);

  assert.deepEqual(groups, [{
    accountId: "default",
    chatId: "-1009988776655",
    title: "Previously used team",
    titleSource: "stored",
    configured: false,
    connectedAgentId: null,
    historicalAgentId: "agent-legacy",
    source: "agentos-registry",
    sources: ["agentos-registry"],
    connectable: true,
    historical: true,
    bindingConflict: false,
    lastObservedAt: null
  }]);
});

test("multiple native bindings for one Telegram group become a conflict", () => {
  const candidates: TelegramKnownGroupCandidate[] = [
    {
      accountId: "default",
      chatId: "-1001112223334",
      source: "openclaw-binding",
      connectedAgentId: "agent-a"
    },
    {
      accountId: "default",
      chatId: "-1001112223334",
      source: "openclaw-binding",
      connectedAgentId: "agent-b"
    }
  ];

  const [group] = mergeTelegramKnownGroups(candidates);
  assert.ok(group);
  assert.equal(group.connectedAgentId, "agent-a");
  assert.equal(group.bindingConflict, true);
  assert.equal(group.connectable, false);
});

test("Telegram session discovery reads structured OpenClaw identity and metadata only", () => {
  const parsed = parseTelegramSessionGroup({
    key: "agent:main:telegram:group:-1001980472460",
    kind: "group",
    peerKind: "group",
    channel: "telegram",
    subject: "Avatars",
    origin: {
      provider: "telegram",
      surface: "telegram",
      chatType: "group",
      from: "telegram:group:-1001980472460",
      to: "telegram:-1001980472460",
      accountId: "default"
    },
    updatedAt: 1789545586466,
    message: "This transcript text must not be used as a group title"
  });

  assert.deepEqual(parsed, {
    accountId: "default",
    chatId: "-1001980472460",
    title: "Avatars",
    lastObservedAt: new Date(1789545586466).toISOString()
  });

  assert.equal(
    parseTelegramSessionGroup({
      key: "agent:main:telegram:direct:123",
      channel: "telegram",
      message: "-1009988776655 Marketing"
    }),
    null
  );
});
