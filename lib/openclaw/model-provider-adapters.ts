"use client";

import {
  getModelProviderDescriptor,
  type ModelProviderDescriptor
} from "@/lib/openclaw/model-provider-registry";
import type {
  AddModelsProviderActionRequest,
  AddModelsProviderActionResult,
  AddModelsProviderId,
  ModelProviderAuthMethod
} from "@/lib/openclaw/types";

export type ModelProviderAdapter = {
  id: AddModelsProviderId;
  descriptor: ModelProviderDescriptor;
  getConnectionStatus: () => Promise<AddModelsProviderActionResult>;
  connect: (input?: { apiKey?: string; endpoint?: string; providerName?: string; modelId?: string; force?: boolean; authMethod?: ModelProviderAuthMethod }) => Promise<AddModelsProviderActionResult>;
  updateProvider: (input: { endpoint?: string | null; api?: string }) => Promise<AddModelsProviderActionResult>;
  replaceCredential: (apiKey: string) => Promise<AddModelsProviderActionResult>;
  switchAccount: () => Promise<AddModelsProviderActionResult>;
  discoverModels: () => Promise<AddModelsProviderActionResult>;
  addModels: (modelIds: string[]) => Promise<AddModelsProviderActionResult>;
  getDisconnectImpact: () => Promise<AddModelsProviderActionResult>;
  disconnect: () => Promise<AddModelsProviderActionResult>;
  getCredentialDisconnectImpact: () => Promise<AddModelsProviderActionResult>;
  disconnectCredential: () => Promise<AddModelsProviderActionResult>;
  getDeleteImpact: () => Promise<AddModelsProviderActionResult>;
  deleteProvider: () => Promise<AddModelsProviderActionResult>;
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
const CHATGPT_PROVIDER_REQUEST_TIMEOUT_MS = 13 * 60_000;

async function runProviderAction(
  request: AddModelsProviderActionRequest,
  options?: { allowNotOk?: boolean }
): Promise<AddModelsProviderActionResult> {
  let response: Response;

  try {
    response = await fetch("/api/models/providers", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(
        ((request.provider === "openai-codex" &&
          (request.action === "connect" || request.action === "switch-account")) ||
          (request.provider === "openai" &&
            request.action === "connect" &&
            request.authMethod === "chatgpt"))
          ? CHATGPT_PROVIDER_REQUEST_TIMEOUT_MS
          : MODEL_PROVIDER_REQUEST_TIMEOUT_MS
      )
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
    if (options?.allowNotOk && result) {
      return result;
    }
    throw new Error(result?.error || result?.message || "Model provider request failed.");
  }

  if (!result.ok && result.message && !options?.allowNotOk) {
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
        authMethod: input?.authMethod,
        providerName: input?.providerName?.trim() ? input.providerName.trim() : undefined,
        apiKey: input?.apiKey?.trim() ? input.apiKey.trim() : undefined,
        endpoint: input?.endpoint?.trim() ? input.endpoint.trim() : undefined,
        modelId: input?.modelId?.trim() ? input.modelId.trim() : undefined,
        force: input?.force === true ? true : undefined
      }),
    updateProvider: (input) =>
      runProviderAction({
        action: "update-provider",
        provider: providerId,
        endpoint: input.endpoint,
        api: input.api
      }),
    replaceCredential: (apiKey) =>
      runProviderAction({
        action: "replace-credential",
        provider: providerId,
        apiKey
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
      }),
    getDisconnectImpact: () =>
      runProviderAction({
        action: "disconnect-impact",
        provider: providerId
      }, { allowNotOk: true }),
    disconnect: () =>
      runProviderAction({
        action: "disconnect",
        provider: providerId,
        confirmed: true
      }),
    getCredentialDisconnectImpact: () =>
      runProviderAction({
        action: "disconnect-credential-impact",
        provider: providerId
      }, { allowNotOk: true }),
    disconnectCredential: () =>
      runProviderAction({
        action: "disconnect-credential",
        provider: providerId,
        confirmed: true
      }),
    getDeleteImpact: () =>
      runProviderAction({
        action: "delete-provider-impact",
        provider: providerId
      }, { allowNotOk: true }),
    deleteProvider: () =>
      runProviderAction({
        action: "delete-provider",
        provider: providerId,
        confirmed: true
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
