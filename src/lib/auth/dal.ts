import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getDb } from "@/db";
import { SESSION_COOKIE, SESSION_TTL_MS, validateSession, type SessionUser } from "./session";

/** The signed-in user for this request, or null. Deduped per render. */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return validateSession(getDb(), token);
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** For adult-only pages. Kids are sent home rather than shown an error. */
export async function requireAdultPage(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "adult") redirect("/");
  return user;
}

export async function setSessionCookie(token: string) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE !== "false" && process.env.NODE_ENV === "production",
    path: "/",
    // The DB row holds the real (rolling) expiry; the cookie just needs to outlive it.
    maxAge: Math.floor(SESSION_TTL_MS / 1000) * 2,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}
