import assert from "node:assert/strict";
import { test } from "node:test";

import {
  resolveAgentOsApplicationUpdateOwner,
  resolveAgentOsDesktopBundle
} from "@/lib/agentos/deployment-capabilities";

test("explicit CLI installation ownership wins over the generic launcher process marker", () => {
  const base = {
    AGENTOS_PACKAGE_RUNTIME: "1",
    AGENTOS_LAUNCHER_PID: "1234"
  };

  assert.equal(resolveAgentOsApplicationUpdateOwner({ ...base, AGENTOS_INSTALLATION_OWNER: "package-manager" }, "darwin"), "package-manager");
  assert.equal(resolveAgentOsApplicationUpdateOwner({ ...base, AGENTOS_INSTALLATION_OWNER: "release-launcher" }, "darwin"), "release-launcher");
});

test("Railway and the native Desktop launch context take precedence over package layout", () => {
  assert.equal(resolveAgentOsApplicationUpdateOwner({
    AGENTOS_DEPLOYMENT_PLATFORM: "railway",
    AGENTOS_DESKTOP: "1",
    AGENTOS_PACKAGE_RUNTIME: "1"
  }, "darwin"), "deployment");

  assert.equal(resolveAgentOsApplicationUpdateOwner({
    AGENTOS_DESKTOP: "1",
    AGENTOS_PACKAGE_RUNTIME: "1",
    AGENTOS_LAUNCHER_PID: "1234"
  }, "darwin"), "desktop");
});

test("Desktop bundle detection requires native launch context and reports unsupported Linux packages", () => {
  assert.equal(resolveAgentOsDesktopBundle({ AGENTOS_DESKTOP: "1" }, "linux"), "unknown");
  assert.equal(resolveAgentOsDesktopBundle({ AGENTOS_DESKTOP: "1", AGENTOS_DESKTOP_BUNDLE: "linux-package" }, "linux"), "linux-package");
  assert.equal(resolveAgentOsDesktopBundle({ AGENTOS_DESKTOP: "1", AGENTOS_DESKTOP_BUNDLE: "linux-appimage" }, "linux"), "linux-appimage");
  assert.equal(resolveAgentOsDesktopBundle({ AGENTOS_DESKTOP_BUNDLE: "linux-appimage" }, "linux"), "unknown");
});

test("npm and pnpm discovery ownership is inferred only from package-manager context", () => {
  assert.equal(resolveAgentOsApplicationUpdateOwner({ npm_config_user_agent: "pnpm/10.30.3 npm/? node/v24" }, "linux"), "package-manager");
  assert.equal(resolveAgentOsApplicationUpdateOwner({ npm_execpath: "/usr/lib/node_modules/npm/bin/npm-cli.js" }, "linux"), "package-manager");
  assert.equal(resolveAgentOsApplicationUpdateOwner({ NODE_ENV: "development" }, "linux"), "source");
  assert.equal(resolveAgentOsApplicationUpdateOwner({}, "linux"), "unknown");
});
