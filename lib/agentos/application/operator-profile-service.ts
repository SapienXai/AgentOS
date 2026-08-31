import "server-only";

import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { resolveAgentOsRuntimeDir } from "@/lib/agentos/runtime-auth";
import { readInstanceProtectionState } from "@/lib/security/instance-protection";
import { getAgentOsUserByActorId, readAgentOsUserStore, writeAgentOsUserStore } from "@/lib/security/agentos-user-store";

export const OPERATOR_PROFILE_FILE = "operator-profile.json";
export const OPERATOR_PROFILE_AVATAR_MAX_CHARACTERS = 720_000;

export type OperatorProfile = {
  fullName: string;
  username: string;
  email: string;
  avatarDataUrl: string | null;
  updatedAt: string | null;
};

type StoredOperatorProfile = Partial<OperatorProfile> & {
  version?: unknown;
  actorId?: unknown;
};

const emptyOperatorProfile: OperatorProfile = {
  fullName: "",
  username: "",
  email: "",
  avatarDataUrl: null,
  updatedAt: null
};

export function resolveOperatorProfilePath(env: NodeJS.ProcessEnv = process.env) {
  return path.join(resolveAgentOsRuntimeDir(env), OPERATOR_PROFILE_FILE);
}

export async function readOperatorProfile(env: NodeJS.ProcessEnv = process.env): Promise<OperatorProfile> {
  return (await readOperatorProfileRecord(env)).profile;
}

export async function saveOperatorProfile(
  input: Omit<OperatorProfile, "updatedAt">,
  env: NodeJS.ProcessEnv = process.env,
  actorId?: string | null
): Promise<OperatorProfile> {
  if (input.avatarDataUrl !== null && !isSupportedAvatarDataUrl(input.avatarDataUrl)) {
    throw new Error("Operator profile avatar is invalid or too large.");
  }

  const profile: OperatorProfile = {
    fullName: input.fullName.trim(),
    username: input.username.trim().toLowerCase(),
    email: input.email.trim().toLowerCase(),
    avatarDataUrl: input.avatarDataUrl,
    updatedAt: new Date().toISOString()
  };
  const current = await readOperatorProfileRecord(env);
  const linkedActorId = actorId === undefined ? current.actorId : actorId;
  if (linkedActorId !== null && !isStableActorId(linkedActorId)) {
    throw new Error("Operator profile actor linkage is invalid.");
  }
  const profilePath = resolveOperatorProfilePath(env);
  const temporaryPath = `${profilePath}.${randomUUID()}.tmp`;

  await mkdir(path.dirname(profilePath), { recursive: true, mode: 0o700 });
  await writeFile(
    temporaryPath,
    `${JSON.stringify({ version: 2, actorId: linkedActorId, ...profile }, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 }
  );
  await rename(temporaryPath, profilePath);
  await chmod(profilePath, 0o600);

  if (linkedActorId) {
    const userStore = await readAgentOsUserStore(env);
    const user = await getAgentOsUserByActorId(linkedActorId, env);
    if (userStore && user) {
      user.profile = {
        displayName: profile.fullName,
        email: profile.email,
        avatarDataUrl: profile.avatarDataUrl
      };
      user.updatedAt = profile.updatedAt ?? new Date().toISOString();
      await writeAgentOsUserStore(userStore, env);
    }
  }

  return profile;
}

export async function readOperatorProfileRecord(env: NodeJS.ProcessEnv = process.env): Promise<{
  profile: OperatorProfile;
  actorId: string | null;
}> {
  let payload: StoredOperatorProfile;

  try {
    payload = JSON.parse(await readFile(resolveOperatorProfilePath(env), "utf8")) as StoredOperatorProfile;
  } catch (error) {
    if (isMissingFileError(error)) {
      return { profile: { ...emptyOperatorProfile }, actorId: null };
    }

    throw new Error("Operator profile data is unavailable or invalid.");
  }

  const profile = {
    fullName: readString(payload.fullName),
    username: readString(payload.username),
    email: readString(payload.email),
    avatarDataUrl: isSupportedAvatarDataUrl(payload.avatarDataUrl) ? payload.avatarDataUrl : null,
    updatedAt: readNullableString(payload.updatedAt)
  } satisfies OperatorProfile;
  const actorId = isStableActorId(payload.actorId) ? payload.actorId : null;

  let linkedActorId = actorId;
  if (payload.version !== 2) {
    const protectionState = await readInstanceProtectionState(env);
    linkedActorId = protectionState?.actorId ?? actorId;
    await writeOperatorProfileRecord(profile, linkedActorId, env);
  }

  return { profile, actorId: linkedActorId };
}

export function isSupportedAvatarDataUrl(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= OPERATOR_PROFILE_AVATAR_MAX_CHARACTERS &&
    /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(value)
  );
}

function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function readNullableString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function isMissingFileError(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function writeOperatorProfileRecord(
  profile: OperatorProfile,
  actorId: string | null,
  env: NodeJS.ProcessEnv
) {
  const profilePath = resolveOperatorProfilePath(env);
  const temporaryPath = `${profilePath}.${randomUUID()}.tmp`;
  await mkdir(path.dirname(profilePath), { recursive: true, mode: 0o700 });
  await writeFile(
    temporaryPath,
    `${JSON.stringify({ version: 2, actorId, ...profile }, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 }
  );
  await rename(temporaryPath, profilePath);
  await chmod(profilePath, 0o600);
}

function isStableActorId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
