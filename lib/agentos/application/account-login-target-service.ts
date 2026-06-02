import "server-only";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  AccountLoginTargetView,
  AccountLoginTargetsResponse
} from "@/lib/agentos/account-login-target-types";
import { missionControlRootPath } from "@/lib/openclaw/state/paths";
import { redactSecretText } from "@/lib/security/redaction";

type AccountLoginTargetRegistry = {
  version: 1;
  targets: AccountLoginTargetView[];
};

const accountLoginTargetsPath = path.join(missionControlRootPath, "account-login-targets.json");

export async function listAccountLoginTargets(input: {
  workspaceId?: string | null;
} = {}): Promise<AccountLoginTargetsResponse> {
  const registry = await readAccountLoginTargetRegistry();
  const workspaceId = normalizeOptionalString(input.workspaceId);
  const targets = workspaceId
    ? registry.targets.filter((target) => target.workspaceId === workspaceId)
    : registry.targets;

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    source: "agentos.account-login-targets",
    targets: targets.sort(sortAccountLoginTargets)
  };
}

export async function upsertAccountLoginTarget(input: {
  workspaceId: string;
  workspaceName: string;
  workspacePath?: string | null;
  serviceId: string;
  serviceName: string;
  primaryDomain: string;
  loginUrl: string;
  browserProfileName: string;
}): Promise<AccountLoginTargetsResponse> {
  const now = new Date().toISOString();
  const workspaceId = requireSlug(input.workspaceId, "Workspace id");
  const serviceId = requireSlug(input.serviceId, "Service id");
  const browserProfileName = requireSlug(input.browserProfileName, "Browser profile");
  const primaryDomain = normalizeDomain(input.primaryDomain);
  const loginUrl = normalizeStorableLoginUrl(input.loginUrl);
  const id = buildLoginTargetId({ workspaceId, browserProfileName, primaryDomain });
  const registry = await readAccountLoginTargetRegistry();
  const existing = registry.targets.find((target) => target.id === id);
  const nextTarget: AccountLoginTargetView = {
    id,
    workspaceId,
    workspaceName: normalizeRequiredString(input.workspaceName, "Workspace name"),
    workspacePath: normalizeOptionalString(input.workspacePath),
    serviceId,
    serviceName: normalizeRequiredString(input.serviceName, "Service name"),
    primaryDomain,
    loginUrl,
    browserProfileName,
    status: "saved_in_browser_profile",
    statusLabel: "Saved in browser profile",
    statusTone: "success",
    source: "agentos.connect-account",
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    lastOpenedAt: now,
    openCount: (existing?.openCount ?? 0) + 1
  };

  const targets = [
    ...registry.targets.filter((target) => target.id !== id),
    nextTarget
  ].sort(sortAccountLoginTargets);

  await writeAccountLoginTargetRegistry({ version: 1, targets });
  return listAccountLoginTargets({ workspaceId });
}

export async function deleteAccountLoginTarget(input: {
  id: string;
  workspaceId?: string | null;
}): Promise<AccountLoginTargetsResponse> {
  const id = normalizeRequiredString(input.id, "Login target id");
  const registry = await readAccountLoginTargetRegistry();
  const nextTargets = registry.targets.filter((target) => target.id !== id);

  await writeAccountLoginTargetRegistry({ version: 1, targets: nextTargets });
  return listAccountLoginTargets({ workspaceId: input.workspaceId });
}

async function readAccountLoginTargetRegistry(): Promise<AccountLoginTargetRegistry> {
  try {
    const content = await readFile(accountLoginTargetsPath, "utf8");
    const parsed = JSON.parse(content) as Partial<AccountLoginTargetRegistry>;
    const targets = Array.isArray(parsed.targets)
      ? parsed.targets.map(normalizeAccountLoginTarget).filter(isAccountLoginTargetView)
      : [];

    return {
      version: 1,
      targets
    };
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? error.code : undefined;

    if (code === "ENOENT") {
      return { version: 1, targets: [] };
    }

    throw error;
  }
}

async function writeAccountLoginTargetRegistry(registry: AccountLoginTargetRegistry) {
  await mkdir(path.dirname(accountLoginTargetsPath), { recursive: true });
  await writeFile(accountLoginTargetsPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
}

function normalizeAccountLoginTarget(value: unknown): AccountLoginTargetView | null {
  if (!isRecord(value)) {
    return null;
  }

  const workspaceId = normalizeOptionalString(value.workspaceId);
  const serviceId = normalizeOptionalString(value.serviceId);
  const serviceName = normalizeOptionalString(value.serviceName);
  const primaryDomain = normalizeOptionalString(value.primaryDomain);
  const browserProfileName = normalizeOptionalString(value.browserProfileName);
  const lastOpenedAt = normalizeIsoDate(value.lastOpenedAt);
  const createdAt = normalizeIsoDate(value.createdAt) ?? lastOpenedAt;
  const updatedAt = normalizeIsoDate(value.updatedAt) ?? lastOpenedAt;

  if (!workspaceId || !serviceId || !serviceName || !primaryDomain || !browserProfileName || !lastOpenedAt) {
    return null;
  }

  return {
    id: normalizeOptionalString(value.id) ?? buildLoginTargetId({ workspaceId, browserProfileName, primaryDomain }),
    workspaceId,
    workspaceName: normalizeOptionalString(value.workspaceName) ?? workspaceId,
    workspacePath: normalizeOptionalString(value.workspacePath),
    serviceId,
    serviceName,
    primaryDomain,
    loginUrl: normalizeOptionalString(value.loginUrl) ?? `https://${primaryDomain}`,
    browserProfileName,
    status: "saved_in_browser_profile",
    statusLabel: "Saved in browser profile",
    statusTone: "success",
    source: "agentos.connect-account",
    createdAt: createdAt ?? lastOpenedAt,
    updatedAt: updatedAt ?? lastOpenedAt,
    lastOpenedAt,
    openCount: readPositiveInteger(value.openCount) ?? 1
  };
}

function isAccountLoginTargetView(value: AccountLoginTargetView | null): value is AccountLoginTargetView {
  return value !== null;
}

function buildLoginTargetId(input: {
  workspaceId: string;
  browserProfileName: string;
  primaryDomain: string;
}) {
  return `${input.workspaceId}:${input.browserProfileName}:${input.primaryDomain}`;
}

function sortAccountLoginTargets(left: AccountLoginTargetView, right: AccountLoginTargetView) {
  return Date.parse(right.lastOpenedAt) - Date.parse(left.lastOpenedAt) ||
    left.serviceName.localeCompare(right.serviceName);
}

function normalizeStorableLoginUrl(value: string) {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("Login URL must use http or https.");
    }

    url.search = "";
    url.hash = "";
    return redactSecretText(url.toString());
  } catch {
    throw new Error("A valid Login URL is required.");
  }
}

function normalizeDomain(value: string) {
  const domain = value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
    throw new Error("Primary domain is required.");
  }

  return domain;
}

function requireSlug(value: string, label: string) {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-_.:]{0,126}[a-z0-9])?$/.test(normalized)) {
    throw new Error(`${label} is invalid.`);
  }

  return normalized;
}

function normalizeRequiredString(value: string, label: string) {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} is required.`);
  }

  return normalized.slice(0, 120);
}

function normalizeOptionalString(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeIsoDate(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

function readPositiveInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
