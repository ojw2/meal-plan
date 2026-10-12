import { ZodError } from "zod";
import { ServiceError } from "@/lib/errors";

export type FormState = { error?: string; success?: string } | undefined;

/**
 * Runs a server-action body, turning expected failures into a message for the
 * form. Anything else (including Next's redirect signal) is rethrown.
 */
export async function toFormState(
  fn: () => Promise<string | void>,
): Promise<FormState> {
  try {
    const success = await fn();
    return { success: success ?? undefined };
  } catch (e) {
    if (e instanceof ServiceError) return { error: e.message };
    if (e instanceof ZodError) return { error: e.issues[0]?.message ?? "Invalid input." };
    throw e;
  }
}

export function formString(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v : "";
}
