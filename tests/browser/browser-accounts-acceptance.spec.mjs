import { expect, test } from "@playwright/test";

import {
  BROWSER_ACCOUNT_FIXTURE_IDS,
  BrowserAccountAcceptanceFixture
} from "./browser-account-fixture.mjs";

async function openAccounts(page, fixture) {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await fixture.install(page);
  await page.goto("/accounts");
  await expect(page.getByRole("heading", { name: "Accounts", exact: true })).toBeVisible({ timeout: 45_000 });
  await expect(page.getByRole("heading", { name: "Secure Browser Accounts", exact: true })).toBeVisible();
}

test("X Browser Account human acceptance completes all 28 steps", async ({ page }) => {
  const fixture = new BrowserAccountAcceptanceFixture();
  await openAccounts(page, fixture);
  const passed = [];
  const step = async (number, assertion) => {
    await assertion();
    passed.push(number);
    console.log(`PASS Browser Account acceptance step ${number}`);
  };

  await step(1, async () => expect(page).toHaveURL(/\/accounts$/));
  await step(2, async () => expect(page.getByRole("heading", { name: "Secure Browser Accounts", exact: true })).toBeVisible());
  await step(3, async () => expect(page.getByText("No Secure Browser Accounts", { exact: true })).toBeVisible());
  await step(4, async () => {
    await page.getByRole("button", { name: "Connect Browser Account", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("Connect Browser Account");
  });
  const connectDialog = page.getByRole("dialog");
  await step(5, async () => {
    await expect(connectDialog.getByLabel(/password|otp|cookie|session credential/i)).toHaveCount(0);
  });
  await step(6, async () => {
    await connectDialog.getByRole("button", { name: "X / Twitter", exact: true }).click();
    await expect(connectDialog.getByLabel("Website")).toHaveValue("https://x.com/login");
  });
  await step(7, async () => {
    await connectDialog.getByLabel("Account label").fill("@SapienX");
    await expect(connectDialog.getByLabel("Account label")).toHaveValue("@SapienX");
  });
  await step(8, async () => {
    const agentCheckbox = connectDialog.locator("label").filter({ hasText: "Key 2 Lead" }).locator("input[type=checkbox]");
    await expect(agentCheckbox).toHaveCount(1);
    await agentCheckbox.check();
  });
  await step(9, async () => expect(connectDialog).toContainText("Dedicated and persistent"));

  const popupPromise = page.waitForEvent("popup");
  let popup;
  await step(10, async () => {
    await connectDialog.getByRole("button", { name: "Start Secure Browser", exact: true }).click({ force: true });
    popup = await popupPromise;
    await popup.waitForLoadState("domcontentloaded");
    await popup.waitForURL(/\/accounts\/browser-live/);
  });
  await step(11, async () => {
    const createRequest = fixture.requests.find((entry) => entry.body.action === "create");
    expect(createRequest).toMatchObject({
      body: {
        action: "create",
        provider: "self-hosted-openclaw",
        identityLabel: "@SapienX",
        primaryDomain: "x.com",
        allowedAgentIds: [BROWSER_ACCOUNT_FIXTURE_IDS.agentId]
      }
    });
    expect(JSON.stringify(createRequest.body)).not.toMatch(/password|otp|cookie|session.?token/i);
  });
  await step(12, async () => expect(popup.getByRole("heading", { name: "Secure Browser", exact: true })).toBeVisible());
  await step(13, async () => expect(popup.getByText("Passwords and verification codes stay inside this browser.", { exact: true })).toBeVisible());
  await step(14, async () => {
    expect(fixture.liveViewExchanges).toHaveLength(1);
    expect(fixture.responseBodies.join("\n")).not.toMatch(/cdpUrl|cdp:\/\//i);
  });
  await step(15, async () => {
    await popup.getByRole("button", { name: /signed in/i }).click();
    await expect(popup.getByText("provider-specific login marker was verified", { exact: false })).toBeVisible();
  });
  await step(16, async () => {
    expect(fixture.requests.some((entry) => entry.body.action === "confirm-login")).toBe(true);
    expect(fixture.browserAccount).toMatchObject({ connectionStatus: "connected", verificationSource: "provider_verified" });
  });
  await step(17, async () => {
    expect(fixture.requests.some((entry) => entry.body.action === "stop-live-view")).toBe(true);
    await expect(popup.getByText("persistent profile was saved", { exact: false })).toBeVisible();
  });
  await step(18, async () => {
    await Promise.all([
      popup.waitForEvent("close"),
      popup.getByRole("button", { name: "Close window", exact: true }).click()
    ]);
    await page.reload();
    await expect(page.getByText("@SapienX", { exact: true })).toBeVisible({ timeout: 20_000 });
  });
  await step(19, async () => {
    const accountCard = page.getByText("@SapienX", { exact: true }).locator("..").locator("..").locator("..");
    await expect(accountCard).toContainText("X / Twitter");
    await expect(accountCard).toContainText("Connected");
  });
  await step(20, async () => {
    await expect(page.getByText("Self-hosted fallback · cloud", { exact: true })).toBeVisible();
    await expect(page.getByText("Read", { exact: true }).first()).toBeVisible();
  });
  await step(21, async () => {
    await page.getByRole("button", { name: "Manage access", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("Manage Secure Browser Access");
  });
  const manageDialog = page.getByRole("dialog");
  await step(22, async () => {
    await expect(manageDialog.getByRole("checkbox", { name: "Read", exact: true })).toBeChecked();
    await manageDialog.getByRole("checkbox", { name: "Interact", exact: true }).first().check();
    await manageDialog.getByRole("checkbox", { name: "Publish", exact: true }).first().check();
  });
  await step(23, async () => {
    await manageDialog.getByRole("checkbox", { name: "Interact", exact: true }).nth(1).check();
    await manageDialog.getByRole("checkbox", { name: "Publish", exact: true }).nth(1).check();
    await expect(manageDialog).toContainText("Key 2 Lead");
  });
  await step(24, async () => {
    await manageDialog.getByRole("button", { name: "Save access", exact: true }).click();
    await expect(page.getByText("Browser account access updated.", { exact: true })).toBeVisible();
    await expect(page.getByText("Read · Interact · Publish", { exact: true })).toBeVisible();
  });
  await step(25, async () => {
    await page.getByRole("button", { name: "Run Task", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("Run Task With Secure Browser");
  });
  const taskDialog = page.getByRole("dialog");
  await step(26, async () => {
    await expect(taskDialog).toContainText("X / Twitter · @SapienX");
    await expect(taskDialog).toContainText("Read · Interact · Publish");
    await expect(taskDialog.getByLabel("Agent")).toHaveValue(BROWSER_ACCOUNT_FIXTURE_IDS.agentId);
  });
  await step(27, async () => {
    await taskDialog.getByPlaceholder(/Describe what the agent should do on x\.com/i).fill("Open the account and check recent notifications.");
    await taskDialog.getByRole("button", { name: "Submit task", exact: true }).click();
    await expect(page.getByText("Secure browser task submitted.", { exact: true })).toBeVisible();
    expect(fixture.taskDispatches).toEqual([{
      mission: "Open the account and check recent notifications.",
      agentId: BROWSER_ACCOUNT_FIXTURE_IDS.agentId,
      workspaceId: BROWSER_ACCOUNT_FIXTURE_IDS.workspaceId,
      browserAccountId: BROWSER_ACCOUNT_FIXTURE_IDS.accountId
    }]);
  });
  await step(28, async () => {
    await page.getByRole("button", { name: "Revoke", exact: true }).click();
    await expect(page.getByText("Browser account revoked.", { exact: true })).toBeVisible();
    await expect(page.getByText("Revoked", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Run Task", exact: true })).toBeDisabled();
  });

  expect(passed).toEqual(Array.from({ length: 28 }, (_, index) => index + 1));
  expect(JSON.stringify(fixture.responseBodies)).not.toMatch(/cdpUrl|password|otp|cookie|session.?token/i);
});
