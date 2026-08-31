import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const SCRYPT_KEY_LENGTH = 64;
const DUMMY_SALT = "3b95d51f07317118d2ef196c0e9c7ae6";
const DUMMY_HASH = "0".repeat(SCRYPT_KEY_LENGTH * 2);

export const PASSWORD_MIN_LENGTH = 8;

export function createPasswordSalt() {
  return randomBytes(16).toString("hex");
}

export async function hashPassword(password: string, salt: string) {
  return Buffer.from(await scrypt(password, salt, SCRYPT_KEY_LENGTH) as Buffer).toString("hex");
}

export async function verifyPassword(password: string, salt: string, expectedHash: string) {
  const actual = Buffer.from(await scrypt(password, salt, SCRYPT_KEY_LENGTH) as Buffer);
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function verifyPasswordOrDummy(
  password: string,
  salt: string | null | undefined,
  expectedHash: string | null | undefined
) {
  return verifyPassword(password, salt ?? DUMMY_SALT, expectedHash ?? DUMMY_HASH);
}

export function validatePassword(value: string) {
  if (value.length < PASSWORD_MIN_LENGTH) {
    throw new Error(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
  }
  if (value.length > 1024) throw new Error("Password is too long.");
}
