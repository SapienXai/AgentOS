import "server-only";

import { getOpenClawLifecycleService } from "@/lib/openclaw/lifecycle/service";

export async function restartManagedRailwayGateway() {
  const result = await getOpenClawLifecycleService().restart();
  return {
    message: result.message,
    descriptor: result.descriptor
  };
}
