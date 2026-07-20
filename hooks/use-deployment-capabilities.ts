"use client";

import { useEffect, useState } from "react";

import {
  unknownDeploymentCapabilities,
  type AgentOsDeploymentCapabilities
} from "@/lib/agentos/deployment-capabilities";

let cachedCapabilities: AgentOsDeploymentCapabilities | null = null;
let pendingCapabilities: Promise<AgentOsDeploymentCapabilities> | null = null;

export function useDeploymentCapabilities() {
  const [capabilities, setCapabilities] = useState<AgentOsDeploymentCapabilities>(
    cachedCapabilities ?? unknownDeploymentCapabilities
  );

  useEffect(() => {
    let active = true;

    void loadDeploymentCapabilities().then((nextCapabilities) => {
      if (active) {
        setCapabilities(nextCapabilities);
      }
    });

    return () => {
      active = false;
    };
  }, []);

  return capabilities;
}

function loadDeploymentCapabilities() {
  if (cachedCapabilities) {
    return Promise.resolve(cachedCapabilities);
  }

  pendingCapabilities ??= fetch("/api/runtime/capabilities", { cache: "no-store" })
    .then(async (response) => {
      const payload = await response.json().catch(() => null) as AgentOsDeploymentCapabilities | null;
      if (!response.ok || !payload) {
        throw new Error("Deployment capabilities are unavailable.");
      }

      cachedCapabilities = payload;
      return payload;
    })
    .catch(() => unknownDeploymentCapabilities)
    .finally(() => {
      pendingCapabilities = null;
    });

  return pendingCapabilities;
}
