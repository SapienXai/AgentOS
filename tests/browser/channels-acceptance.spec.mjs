import { expect, test } from "@playwright/test";

import {
  CHANNEL_FIXTURE_IDS,
  CHANNEL_FIXTURE_TOKEN,
  ChannelAcceptanceFixture
} from "./channel-fixture.mjs";

const ids = CHANNEL_FIXTURE_IDS;

async function openMissionControl(page, fixture) {
  await fixture.install(page);
  await page.goto("/mission-control");
  await expect(page.getByText("Key 2 Lead", { exact: true }).first()).toBeVisible({ timeout: 45_000 });
}

async function openAgentConnections(page, provider = null) {
  await page.getByRole("button", { name: "Open connection menu for Key 2 Lead" }).click();
  await page.getByRole("menuitem", { name: /^Channels/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Key 2 Lead connections");
  if (provider) {
    if (await dialog.locator("select").count() === 0) {
      await dialog.getByRole("button", { name: "Connect channel", exact: true }).click();
    }
    await dialog.locator("select").first().selectOption(provider);
  }
  return dialog;
}

async function selectAccount(dialog, accountId) {
  await dialog.locator("select").nth(1).selectOption(accountId);
}

async function closeDialog(page) {
  const dialog = page.getByRole("dialog");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
}

test("Telegram online human acceptance completes all 26 steps", async ({ page }) => {
  const fixture = new ChannelAcceptanceFixture({ scenario: "telegram-online" });
  await openMissionControl(page, fixture);
  const passed = [];
  const step = async (number, assertion) => {
    await assertion();
    passed.push(number);
    console.log(`PASS Telegram acceptance step ${number}`);
  };

  await step(1, async () => expect(page.getByText("Key 2 Lab", { exact: true }).first()).toBeVisible());
  await step(2, async () => expect(page.getByText("Key 2 Lead", { exact: true }).first()).toBeVisible());
  await step(3, async () => expect(page.getByRole("button", { name: "Open connection menu for Key 2 Lead" })).toBeVisible());
  await step(4, async () => {
    await page.getByRole("button", { name: "Open connection menu for Key 2 Lead" }).click();
    await expect(page.getByRole("menuitem", { name: /^Channels/ })).toBeVisible();
  });
  await step(5, async () => {
    await page.getByRole("menuitem", { name: /^Channels/ }).click();
    await expect(page.getByRole("dialog")).toContainText("Key 2 Lead connections");
  });
  const dialog = page.getByRole("dialog");
  await step(6, async () => expect(dialog.getByRole("button", { name: "Connect channel", exact: true })).toBeVisible());
  await step(7, async () => {
    await dialog.getByRole("button", { name: "Connect channel", exact: true }).click();
    await expect(dialog.locator("select").first()).toHaveValue("telegram");
  });
  await step(8, async () => await selectAccount(dialog, ids.telegramAccountId));
  await step(9, async () => expect(dialog).toContainText("Online"));
  await step(10, async () => expect(dialog.getByText("Support Group", { exact: true })).toBeVisible());
  await step(11, async () => expect(dialog.getByText("Reservations Group", { exact: true })).toBeVisible());
  await step(12, async () => expect(dialog.getByRole("button", { name: /Connect to Key 2 Lead/ }).first()).toBeVisible());
  await step(13, async () => await dialog.getByRole("button", { name: "Connect to Key 2 Lead" }).first().click());
  await step(14, async () => await expect.poll(() => fixture.routeMutations.length).toBe(1));
  await step(15, async () => expect(page.getByText("OpenClaw confirmed the native route for this agent.", { exact: true })).toBeVisible());
  await step(16, async () => expect(dialog).toContainText("Connected"));
  await step(17, async () => await closeDialog(page));
  await step(18, async () => expect(page.getByRole("button", { name: "Open Telegram connections for Key 2 Lead" })).toBeVisible());
  await step(19, async () => await page.getByRole("button", { name: "Open Telegram connections for Key 2 Lead" }).click());
  await step(20, async () => {
    const reopened = page.getByRole("dialog");
    await expect(reopened).toContainText("Support Group");
    await reopened.getByRole("button", { name: "Connect channel", exact: true }).click();
    await expect(reopened.locator("select").first()).toHaveValue("telegram");
  });
  await step(21, async () => expect(page.getByRole("dialog")).toContainText("Support Group"));
  await step(22, async () => {
    await page.getByRole("link", { name: "Open Channel Center" }).click();
    await expect(page).toHaveURL(/\/channels$/);
  });
  await step(23, async () => {
    await expect(page.getByRole("heading", { name: "Channels", exact: true })).toBeVisible();
    await expect(page.getByText("Support Group", { exact: true }).first()).toBeVisible();
  });
  await step(24, async () => {
    await page.goto("/mission-control");
    await expect(page.getByText("Key 2 Lead", { exact: true }).first()).toBeVisible();
    const reopened = await openAgentConnections(page, "telegram");
    await selectAccount(reopened, ids.telegramAccountId);
    await expect(reopened).toContainText("Support Group");
  });
  await step(25, async () => {
    await page.getByRole("button", { name: "Remove override" }).first().click();
    await expect.poll(() => fixture.routeMutations.length).toBe(2);
  });
  await step(26, async () => {
    await closeDialog(page);
    await expect(page.getByRole("button", { name: "Open Telegram connections for Key 2 Lead" })).toHaveCount(0);
    expect(fixture.bindings.size).toBe(0);
    const state = await page.evaluate(async () => {
      const [directory, routes, snapshot] = await Promise.all([
        fetch("/api/openclaw/channels/directory?provider=telegram&accountId=telegram-support-bot&kind=groups").then((response) => response.json()),
        fetch("/api/openclaw/channels/agent-routes?agentId=agent-key-2-lead").then((response) => response.json()),
        fetch("/api/snapshot").then((response) => response.json())
      ]);
      return { directory, routes, snapshot };
    });
    expect(state.directory.entries.find((entry) => entry.routeId === ids.telegramSupportRouteId).agentId).toBeNull();
    expect(state.routes.routes).toHaveLength(0);
    expect(state.snapshot.nativeChannelRouteBadges?.[ids.agentId]).toBeUndefined();
  });

  expect(passed).toEqual(Array.from({ length: 26 }, (_, index) => index + 1));
});

test("Telegram STOPPED start is issued once and progresses to ONLINE", async ({ page }) => {
  const fixture = new ChannelAcceptanceFixture({ scenario: "telegram-stopped" });
  await openMissionControl(page, fixture);
  const dialog = await openAgentConnections(page, "telegram");
  await selectAccount(dialog, ids.telegramAccountId);
  await expect(dialog).toContainText("Stopped");
  await dialog.getByRole("button", { name: "Start and continue" }).click();
  await expect(dialog.getByText("Support Group", { exact: true })).toBeVisible({ timeout: 20_000 });
  expect(fixture.startRequests).toEqual([{ provider: "telegram", accountId: ids.telegramAccountId }]);
  expect(fixture.startSequences.get(`telegram:${ids.telegramAccountId}`).states).toEqual(["STOPPED", "STOPPED", "STARTING", "ONLINE"]);
});

test("Telegram token setup never projects the credential and continues to the directory", async ({ page }) => {
  const fixture = new ChannelAcceptanceFixture({ scenario: "telegram-setup" });
  const consoleMessages = [];
  const responseBodies = [];
  page.on("console", (message) => consoleMessages.push(message.text()));
  page.on("response", async (response) => {
    if (!response.url().includes("/api/")) return;
    try {
      const body = await response.text();
      if (body) responseBodies.push(body);
    } catch {
      // Response may already be disposed; the acceptance assertion does not need it.
    }
  });
  await openMissionControl(page, fixture);
  const dialog = await openAgentConnections(page, "telegram");
  await selectAccount(dialog, ids.telegramAccountId);
  await expect(dialog).toContainText("Needs setup");
  await dialog.getByLabel("Account name").fill("Support Bot");
  await dialog.getByLabel("Bot token").fill(CHANNEL_FIXTURE_TOKEN);
  await dialog.getByRole("button", { name: "Connect account" }).click();
  await expect(dialog.getByText("Support Group", { exact: true })).toBeVisible({ timeout: 20_000 });
  expect(fixture.accountCreates).toEqual([{ provider: "telegram", name: "Support Bot" }]);
  expect(fixture.startRequests).toHaveLength(1);
  expect(consoleMessages.join("\n")).not.toContain(CHANNEL_FIXTURE_TOKEN);
  expect(responseBodies.join("\n")).not.toContain(CHANNEL_FIXTURE_TOKEN);
  expect(await page.locator("body").innerText()).not.toContain(CHANNEL_FIXTURE_TOKEN);
  const snapshot = await page.evaluate(async () => (await fetch("/api/snapshot")).json());
  const routes = await page.evaluate(async () => (await fetch("/api/openclaw/channels/agent-routes?agentId=agent-key-2-lead")).json());
  expect(JSON.stringify(snapshot)).not.toContain(CHANNEL_FIXTURE_TOKEN);
  expect(JSON.stringify(routes)).not.toContain(CHANNEL_FIXTURE_TOKEN);
});

test("Discord hierarchy keeps thread routing inherited from #support", async ({ page }) => {
  const fixture = new ChannelAcceptanceFixture({ scenario: "discord" });
  await openMissionControl(page, fixture);
  const dialog = await openAgentConnections(page, "discord");
  await selectAccount(dialog, ids.discordAccountId);
  await expect(dialog.getByText("SapienX Server", { exact: true })).toBeVisible();
  await expect(dialog.getByText("#support", { exact: true })).toBeVisible();
  await expect(dialog.getByText("#sales", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Connect to Key 2 Lead" }).nth(1).click();
  await expect.poll(() => fixture.routeMutations.length).toBe(1);
  await expect(dialog).toContainText("Connected");
  await closeDialog(page);
  await expect(page.getByRole("button", { name: "Open Discord connections for Key 2 Lead" })).toBeVisible();

  await page.goto("/channels?provider=discord");
  await expect(page.getByText("SapienX Server", { exact: true }).first()).toBeVisible();
  await page.getByText("#support", { exact: true }).first().click();
  await expect(page.getByText("#support", { exact: true }).last()).toBeVisible();
  await expect(page.locator('select:has(option:checked[value="agent-key-2-lead"])')).toBeVisible();
  await expect(page.getByText("Support thread", { exact: true })).toBeVisible();
  await page.getByText("Support thread", { exact: true }).click();
  await expect(page.locator("body")).toContainText("Threads inherit their parent peer in this OpenClaw release.");
  expect(await page.locator('select:has(option[value="agent-key-2-lead"])').count()).toBe(0);
});

test("Agent badges show Telegram 2 and Discord 1 while default-only routes stay unbadged", async ({ page }) => {
  const fixture = new ChannelAcceptanceFixture({
    scenario: "discord",
    seedBindings: [
      { provider: "telegram", accountId: ids.telegramAccountId, kind: "group", routeId: ids.telegramSupportRouteId, parentRouteId: null, agentId: ids.agentId },
      { provider: "telegram", accountId: ids.telegramAccountId, kind: "group", routeId: ids.telegramReservationsRouteId, parentRouteId: null, agentId: ids.agentId },
      { provider: "discord", accountId: ids.discordAccountId, kind: "channel", routeId: ids.discordSupportRouteId, parentRouteId: ids.discordServerRouteId, agentId: ids.agentId },
      { provider: "telegram", accountId: ids.telegramAccountId, kind: "group", routeId: "telegram-default-only", parentRouteId: null, agentId: ids.defaultAgentId }
    ]
  });
  await openMissionControl(page, fixture);
  const telegramBadge = page.getByRole("button", { name: "Open Telegram connections for Key 2 Lead" });
  const discordBadge = page.getByRole("button", { name: "Open Discord connections for Key 2 Lead" });
  await expect(telegramBadge).toBeVisible();
  await expect(discordBadge).toBeVisible();
  await telegramBadge.hover();
  await expect(page.getByRole("tooltip")).toContainText("Telegram · 2 routes");
  await discordBadge.focus();
  await expect(page.getByRole("tooltip")).toContainText("Discord · 1 route");
  expect(await page.getByRole("button", { name: "Open Telegram connections for Main" }).count()).toBe(0);
});
