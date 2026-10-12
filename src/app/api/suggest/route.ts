import { ZodError } from "zod";
import { getDb } from "@/db";
import { getCurrentUser } from "@/lib/auth/dal";
import { ServiceError } from "@/lib/errors";
import { isSameOrigin } from "@/lib/http";
import { suggestDishes } from "@/lib/services/suggest";

/**
 * One row of the suggest flow (SPEC §4.3). Proxies Spoonacular so the API
 * key stays on the server.
 */
export async function POST(req: Request) {
  if (!isSameOrigin(req)) return Response.json({ error: "Cross-origin request refused." }, { status: 403 });
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Sign in again." }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  try {
    return Response.json(await suggestDishes(getDb(), user, body as never));
  } catch (e) {
    if (e instanceof ServiceError) {
      return Response.json({ error: e.message }, { status: e.code === "forbidden" ? 403 : 400 });
    }
    if (e instanceof ZodError) {
      return Response.json({ error: e.issues[0]?.message ?? "Invalid request." }, { status: 400 });
    }
    throw e;
  }
}
