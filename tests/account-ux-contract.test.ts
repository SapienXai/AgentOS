import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const rootDir = process.cwd();

test("account menu keeps lock and sign out as separate compact actions", async () => {
  const source = await readFile(path.join(rootDir, "components/mission-control/sidebar.tsx"), "utf8");
  const menu = source.match(/function SidebarUserMenu\([\s\S]*?\n}\n\nfunction UserAvatar/)?.[0] ?? "";

  assert.match(menu, /label="Profile"/);
  assert.match(menu, /label="Team"/);
  assert.match(menu, /label="Settings"/);
  assert.match(menu, /label="Lock AgentOS"/);
  assert.match(menu, /label="Sign out"/);
  assert.doesNotMatch(menu, /Login & Protection|Appearance|Help center|label="Connect"/);
});

test("profile remains a human identity surface", async () => {
  const source = await readFile(path.join(rootDir, "components/mission-control/user-profile-dialog.tsx"), "utf8");

  assert.match(source, /Manage the human identity/);
  assert.match(source, /Username.*Managed in Settings/);
  assert.doesNotMatch(source, /USER\.md|OperationsSnapshot|Managed Agents|Active Tasks|Live Operations|Textarea/);
});

test("security is a first-class settings section and lock uses a distinct route", async () => {
  const navigation = await readFile(path.join(rootDir, "components/settings/settings-navigation.tsx"), "utf8");
  const settings = await readFile(path.join(rootDir, "components/settings/security-settings.tsx"), "utf8");
  const provider = await readFile(path.join(rootDir, "components/auth/instance-protection-provider.tsx"), "utf8");

  assert.match(navigation, /id: "security", label: "Security"/);
  assert.match(settings, /AgentOS account security/);
  assert.match(provider, /fetch\("\/api\/auth\/lock"/);
  assert.match(provider, /fetch\("\/api\/auth\/logout"/);
});

test("destructive reset surfaces keep impact visible and technical detail collapsed", async () => {
  const dialog = await readFile(path.join(rootDir, "components/mission-control/reset-dialog.tsx"), "utf8");
  const shell = await readFile(path.join(rootDir, "components/mission-control/mission-control-shell.tsx"), "utf8");

  assert.match(dialog, /label="Will remove"/);
  assert.match(dialog, /label="Will preserve"/);
  assert.match(dialog, /<span>Review details<\/span>/);
  assert.match(dialog, /target === "full-uninstall" \? "UNINSTALL" : "RESET"/);
  assert.match(dialog, /Type \{expectedConfirmation\} to continue/);
  assert.match(dialog, /<details className="mt-3 rounded-xl border border-current\/10/);
  assert.match(dialog, /function ResetProgress/);
  assert.match(shell, /isExpectedRuntimeShutdownError/);
  assert.match(shell, /Uninstall finishing\. AgentOS is closing/);
  assert.match(shell, /OpenClaw could not be found\./);
  assert.match(shell, /A folder could not be safely verified and was preserved\./);
});
