export function isRailwayManagedRuntime(
  env: Readonly<Record<string, string | undefined>> = process.env
) {
  return env.AGENTOS_DEPLOYMENT_PLATFORM?.trim().toLowerCase() === "railway";
}
