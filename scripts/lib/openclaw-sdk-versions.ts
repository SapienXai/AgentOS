import { readFileSync } from "node:fs";
import path from "node:path";

/** Read the installed SDKs used by the evidence process, independently of the runtime under test. */
export function readInstalledOpenClawSdkVersions() {
  const readVersion = (name: string) => {
    const manifest = path.resolve("node_modules", "@openclaw", name, "package.json");
    const { version } = JSON.parse(readFileSync(manifest, "utf8")) as { version?: string };
    if (!version) throw new Error(`The installed @openclaw/${name} version could not be verified.`);
    return version;
  };

  return {
    gatewayClient: readVersion("gateway-client"),
    gatewayProtocolPackage: readVersion("gateway-protocol")
  };
}
