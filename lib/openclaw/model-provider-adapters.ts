"use client";

import {
  getModelProviderDescriptor,
  type ModelProviderDescriptor
} from "@/lib/openclaw/model-provider-registry";
import type {
  AddModelsProviderActionRequest,
  AddModelsProviderActionResult,
  AddModelsProviderId
} from "@/lib/openclaw/types";

export type ModelProviderAdapter = {
  id: AddModelsProviderId;
  descriptor: ModelProviderDescriptor;
  getConnectionStatus: () => Promise<AddModelsProviderActionResult>;
  connect: (input?: { apiKey?: string; endpoint?: string; providerName?: string; modelId?: string; force?: boolean }) => Promise<AddModelsProviderActionResult>;
  switchAccount: () => Promise<AddModelsProviderActionResult>;
  discoverModels: () => Promise<AddModelsProviderActionResult>;
  addModels: (modelIds: string[]) => Promise<AddModelsProviderActionResult>;
};

export class ModelProviderActionError extends Error {
  constructor(
    message: string,
    readonly result: AddModelsProviderActionResult | null
  ) {
    super(message);
    this.name = "ModelProviderActionError";
  }
}

const MODEL_PROVIDER_REQUEST_TIMEOUT_MS = 30_000;

async function runProviderAction(
  request: AddModelsProviderActionRequest
): Promise<AddModelsProviderActionResult> {
  let response: Response;

  try {
    response = await fetch("/api/models/providers", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(MODEL_PROVIDER_REQUEST_TIMEOUT_MS)
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new Error("Model provider request timed out. Check OpenClaw Gateway status and try again.");
    }

    throw error;
  }

  const result = (await response.json().catch(() => null)) as
    | (AddModelsProviderActionResult & { error?: string })
    | null;

  if (!response.ok || !result) {
    throw new Error(result?.error || result?.message || "Model provider request failed.");
  }

  if (!result.ok && result.message) {
    throw new ModelProviderActionError(result.message, result);
  }

  return result;
}

function createModelProviderAdapter(providerId: AddModelsProviderId): ModelProviderAdapter {
  return {
    id: providerId,
    descriptor: getModelProviderDescriptor(providerId),
    getConnectionStatus: () =>
      runProviderAction({
        action: "status",
        provider: providerId
      }),
    connect: (input) =>
      runProviderAction({
        action: "connect",
        provider: providerId,
        providerName: input?.providerName?.trim() ? input.providerName.trim() : undefined,
        apiKey: input?.apiKey?.trim() ? input.apiKey.trim() : undefined,
        endpoint: input?.endpoint?.trim() ? input.endpoint.trim() : undefined,
        modelId: input?.modelId?.trim() ? input.modelId.trim() : undefined,
        force: input?.force === true ? true : undefined
      }),
    switchAccount: () =>
      runProviderAction({
        action: "switch-account",
        provider: providerId
      }),
    discoverModels: () =>
      runProviderAction({
        action: "discover",
        provider: providerId
      }),
    addModels: (modelIds) =>
      runProviderAction({
        action: "add-models",
        provider: providerId,
        modelIds
      })
  };
}

const modelProviderAdapters = new Map<string, ModelProviderAdapter>();

export function getModelProviderAdapter(providerId: AddModelsProviderId) {
  const cached = modelProviderAdapters.get(providerId);

  if (cached) {
    return cached;
  }

  const adapter = createModelProviderAdapter(providerId);
  modelProviderAdapters.set(providerId, adapter);
  return adapter;
}
