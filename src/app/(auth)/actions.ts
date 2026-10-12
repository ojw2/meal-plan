"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { clearSessionCookie, setSessionCookie } from "@/lib/auth/dal";
import { authenticate } from "@/lib/auth/login";
import { SESSION_COOKIE, createSession, deleteSession } from "@/lib/auth/session";
import { formString, toFormState, type FormState } from "@/lib/form-state";
import { setupHousehold, setupSchema } from "@/lib/services/household";

export async function setupAction(_prev: FormState, formData: FormData): Promise<FormState> {
  let userId: string | undefined;
  const result = await toFormState(async () => {
    const input = setupSchema.parse({
      householdName: formString(formData, "householdName"),
      timezone: formString(formData, "timezone"),
      displayName: formString(formData, "displayName"),
      username: formString(formData, "username"),
      password: formString(formData, "password"),
    });
    userId = await setupHousehold(getDb(), input);
  });
  if (!userId) return result;
  await setSessionCookie(await createSession(getDb(), userId));
  redirect("/");
}

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const result = await authenticate(
    getDb(),
    formString(formData, "username"),
    formString(formData, "secret"),
  );
  if (!result.ok) {
    if (result.reason === "locked") {
      const minutes = Math.max(1, Math.ceil((result.until.getTime() - Date.now()) / 60_000));
      return { error: `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.` };
    }
    return { error: "Wrong username, password, or PIN." };
  }
  await setSessionCookie(await createSession(getDb(), result.userId));
  redirect("/");
}

export async function logoutAction() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) await deleteSession(getDb(), token);
  await clearSessionCookie();
  redirect("/login");
}
