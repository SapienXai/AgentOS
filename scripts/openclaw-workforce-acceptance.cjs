const { mkdtempSync, rmSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = mkdtempSync(path.join(os.tmpdir(), "agentos-openclaw-workforce-"));
process.env.AGENTOS_WORKFORCE_TEST_ROOT = root;
process.env.AGENTOS_MISSION_CONTROL_ROOT = path.join(root, "mission-control");
process.env.AGENTOS_RUNTIME_DIR = path.join(root, "agentos");
process.env.OPENCLAW_STATE_DIR = path.join(root, "state");

// Application modules capture these roots during import.
process.once("exit", () => rmSync(root, { recursive: true, force: true }));
require("./openclaw-workforce-acceptance.ts");
