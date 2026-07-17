import "server-only";

import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { resolveAgentOsRuntimeDir } from "@/lib/agentos/runtime-auth";

export const OPERATOR_PROFILE_FILE = "operator-profile.json";
export const OPERATOR_PROFILE_AVATAR_MAX_CHARACTERS = 720_000;

export type OperatorProfile = {
  fullName: string;
  username: string;
  email: string;
  avatarDataUrl: string | null;
  updatedAt: string | null;
};

type StoredOperatorProfile = Partial<OperatorProfile> & { version?: unknown };

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
  let payload: StoredOperatorProfile;

  try {
    payload = JSON.parse(await readFile(resolveOperatorProfilePath(env), "utf8")) as StoredOperatorProfile;
  } catch (error) {
    if (isMissingFileError(error)) {
      return { ...emptyOperatorProfile };
    }

    throw new Error("Operator profile data is unavailable or invalid.");
  }

  return {
    fullName: readString(payload.fullName),
    username: readString(payload.username),
    email: readString(payload.email),
    avatarDataUrl: isSupportedAvatarDataUrl(payload.avatarDataUrl) ? payload.avatarDataUrl : null,
    updatedAt: readNullableString(payload.updatedAt)
  };
}

export async function saveOperatorProfile(
  input: Omit<OperatorProfile, "updatedAt">,
  env: NodeJS.ProcessEnv = process.env
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
  const profilePath = resolveOperatorProfilePath(env);
  const temporaryPath = `${profilePath}.${randomUUID()}.tmp`;

  await mkdir(path.dirname(profilePath), { recursive: true, mode: 0o700 });
  await writeFile(
    temporaryPath,
    `${JSON.stringify({ version: 1, ...profile }, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 }
  );
  await rename(temporaryPath, profilePath);
  await chmod(profilePath, 0o600);

  return profile;
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
