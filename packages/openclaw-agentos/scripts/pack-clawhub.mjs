import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";

const packageRoot = path.resolve(import.meta.dirname, "..");
const destination = process.env.OPENCLAW_AGENTOS_PACK_DESTINATION
  ? path.resolve(process.env.OPENCLAW_AGENTOS_PACK_DESTINATION)
  : path.join(os.tmpdir(), "agentos-openclaw-artifacts");

mkdirSync(destination, { recursive: true });

const result = spawnSync("clawhub", ["package", "pack", packageRoot, "--pack-destination", destination, "--json"], {
  encoding: "utf8",
  stdio: ["inherit", "pipe", "inherit"]
});

process.stdout.write(result.stdout ?? "");
process.exitCode = result.status ?? 1;
