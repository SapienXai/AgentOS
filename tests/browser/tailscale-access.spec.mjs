import { expect, test } from "@playwright/test";

test("a local owner can review, share, and disable a private link at phone width", async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const headers = {
    Origin: baseURL,
    ...(process.env.AGENTOS_TAILSCALE_TEST_TOKEN ? { Authorization: `Bearer ${process.env.AGENTOS_TAILSCALE_TEST_TOKEN}` } : {})
  };
  const initial = await page.request.get("/api/auth/status");
  test.skip((await initial.json()).protectionEnabled, "Requires a disposable AgentOS instance without an owner");
  const password = "browser test passphrase";
  const setup = await page.request.post("/api/auth/protection", {
    headers, data: { action: "enable", username: "tailscale-browser-test", password }
  });
  expect(setup.ok()).toBe(true);

  try {
    // Fixture only. Native status, ownership and authorization have separate tests.
    let enabled = false;
    const origin = "https://fixture.agentos-test.ts.net:8443";
    await page.route("**/api/auth/access/tailscale", async (route) => {
      if (route.request().method() === "POST") enabled = route.request().postDataJSON().action === "enable";
      await route.fulfill({ json: {
        status: enabled ? "active" : "ready",
        message: enabled ? "HTTPS responded from this computer." : "Share AgentOS privately.",
        canEnable: !enabled, canDisable: enabled,
        ...(enabled ? { origin } : {}),
        installUrl: "https://tailscale.com/download"
      } });
    });

    await page.goto("/settings#access");
    await expect(page.getByRole("heading", { name: "Local Access", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Local Network", exact: true })).toBeVisible();
    const tailnet = page.getByRole("region", { name: "Remote Access — Tailscale" });
    await expect(tailnet.getByText("Ready to enable")).toBeVisible();
    await tailnet.getByRole("button", { name: "Enable remote access" }).click();
    await expect(tailnet.getByText("HTTPS verified")).toBeVisible();
    await expect(tailnet.getByRole("link", { name: `Open ${origin}` })).toHaveAttribute("href", origin);
    await expect(tailnet.getByRole("button", { name: "Copy link" })).toBeVisible();
    await tailnet.getByRole("button", { name: "QR code" }).click();
    await expect(tailnet.getByRole("img", { name: `QR code for ${origin}` })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    await page.reload();
    await expect(tailnet.getByText("HTTPS verified")).toBeVisible();
    await tailnet.getByRole("button", { name: "Disable remote access" }).click();
    await expect(tailnet.getByText("Ready to enable")).toBeVisible();
    await expect(tailnet.getByRole("link", { name: `Open ${origin}` })).toHaveCount(0);
  } finally {
    const cleanup = await page.request.post("/api/auth/protection", {
      headers, data: { action: "disable", currentPassword: password }
    });
    expect(cleanup.ok()).toBe(true);
  }
});
