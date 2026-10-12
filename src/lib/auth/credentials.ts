import { hash, verify } from "@node-rs/argon2";
import { z } from "zod";

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_.-]{2,32}$/, "Username must be 2–32 letters, numbers, or . _ -");

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, "Name is required")
  .max(40, "Name must be 40 characters or fewer");

export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password must be 128 characters or fewer");

export const pinSchema = z.string().regex(/^\d{4,6}$/, "PIN must be 4–6 digits");

export function hashSecret(secret: string): Promise<string> {
  // @node-rs/argon2 defaults to argon2id.
  return hash(secret);
}

export async function verifySecret(storedHash: string, secret: string): Promise<boolean> {
  try {
    return await verify(storedHash, secret);
  } catch {
    return false;
  }
}

// Verified against when the username doesn't exist, so response time
// doesn't reveal which usernames are real.
let dummyHash: Promise<string> | undefined;
export function getDummyHash(): Promise<string> {
  dummyHash ??= hash("not-a-real-password");
  return dummyHash;
}
