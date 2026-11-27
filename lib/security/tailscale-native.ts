import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { request } from "node:http";
import { delimiter, isAbsolute, join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const maximumResponseSize = 1024 * 1024;
const serveConfigPath = "/localapi/v0/serve-config";
export type JsonMap = Record<string, unknown>;

export function jsonMap(value: unknown): JsonMap | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonMap : null;
}

export const isTailscaleName = (name: string) =>
  name.length <= 253 && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.){2,}ts\.net$/.test(name);

export type NativeTailscale = {
  inspect: () => Promise<unknown>;
  readServe: () => Promise<unknown>;
  readConfig: () => Promise<{ config: JsonMap; etag: string }>;
  writeConfig: (config: JsonMap, etag: string) => Promise<void>;
};

export class TailscaleConfigChanged extends Error {}

export function tailscaleInstallUrl(platform = process.platform) {
  if (platform === "darwin") return "https://tailscale.com/download/mac";
  if (platform === "win32") return "https://tailscale.com/download/windows";
  if (platform === "linux") return "https://tailscale.com/download/linux";
  return "https://tailscale.com/download";
}

export async function discoverTailscale(env = process.env): Promise<NativeTailscale | null> {
  const windows = process.platform === "win32";
  const mac = process.platform === "darwin";
  const pathEntries = (env.PATH ?? env.Path ?? "").split(delimiter).filter(isAbsolute);
  const candidates = pathEntries.map((directory) => join(directory, windows ? "tailscale.exe" : "tailscale"));
  if (mac) candidates.push("/opt/homebrew/bin/tailscale", "/usr/local/bin/tailscale", "/Applications/Tailscale.app/Contents/MacOS/Tailscale");
  if (windows && env.ProgramFiles && isAbsolute(env.ProgramFiles)) {
    candidates.push(join(env.ProgramFiles, "Tailscale", "tailscale.exe"));
  }

  let binary: string | undefined;
  for (const candidate of new Set(candidates)) {
    try {
      await access(candidate, windows ? constants.F_OK : constants.X_OK);
      if (!(await stat(candidate)).isFile()) continue;
      binary = candidate;
      break;
    } catch {
      // This standard install location is absent.
    }
  }
  if (!binary) return null;

  const defaultSocket = windows ? "\\\\.\\pipe\\ProtectedPrefix\\Administrators\\Tailscale\\tailscaled"
    : mac ? "/var/run/tailscaled.socket" : "/var/run/tailscale/tailscaled.sock";
  const socketCandidate = env.AGENTOS_TAILSCALE_SOCKET || defaultSocket;
  const socket = windows ? (socketCandidate === defaultSocket ? defaultSocket : null)
    : isAbsolute(socketCandidate) && await stat(socketCandidate).then((info) => info.isSocket(), () => false)
      ? socketCandidate : null;
  const executable = binary;
  async function cli(args: readonly string[]) {
    const { stdout } = await run(executable, [...(socket ? ["--socket", socket] : []), ...args], {
      timeout: 3_500, maxBuffer: maximumResponseSize, windowsHide: true, shell: false,
      env: { ...env, ...(mac ? { TAILSCALE_BE_CLI: "1" } : {}) }
    });
    return JSON.parse(stdout) as unknown;
  }

  return {
    inspect: () => cli(["status", "--json", "--peers=false"]),
    readServe: () => cli(["serve", "status", "--json"]),
    async readConfig() {
      if (!socket) throw new Error("Tailscale daemon socket unavailable");
      const { body, etag } = await configureServe(socket);
      const payload: unknown = JSON.parse(body);
      const config = payload === null ? {} : jsonMap(payload);
      if (!etag || !config) throw new Error("Serve configuration does not expose a revision");
      return { config, etag };
    },
    async writeConfig(config, etag) {
      if (!socket || !etag) throw new Error("Serve configuration does not expose a revision");
      await configureServe(socket, { config, etag });
    }
  };
}

function configureServe(socketPath: string, change?: { config: JsonMap; etag: string }) {
  const body = change ? JSON.stringify(change.config) : undefined;
  return new Promise<{ body: string; etag?: string }>((resolve, reject) => {
    const operation = request({
      socketPath, path: serveConfigPath, method: change ? "POST" : "GET",
      signal: AbortSignal.timeout(3_500),
      headers: {
        Host: "local-tailscaled.sock",
        "Sec-Tailscale": "localapi",
        ...(change && body ? {
          "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), "If-Match": change.etag
        } : {})
      }
    }, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(response.statusCode === 412 ? new TailscaleConfigChanged() : new Error("Tailscale daemon denied Serve configuration access"));
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > maximumResponseSize) operation.destroy(new Error("Serve configuration response is too large"));
        else chunks.push(chunk);
      });
      response.once("end", () => resolve({ body: Buffer.concat(chunks).toString("utf8"), etag: response.headers.etag }));
      response.once("error", reject);
    });
    operation.once("error", reject);
    operation.end(body);
  });
}
